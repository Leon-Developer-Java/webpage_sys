import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const backend=resolve('../backend_wrf'),python=resolve('../backend_wrf/.venv/bin/python');
const call=(code,value={})=>JSON.parse(execFileSync(python,['-B','-c',code],{cwd:backend,input:JSON.stringify(value),encoding:'utf8'}));
const options=call('import json; from configuration_profile import definition; from namelist_config import catalog; c=catalog(); print(json.dumps({"configuration_profile":definition(),"namelist_capability":{k:c[k] for k in ("schema_version","source_hash","capability_id")}}))');
const resolveConfig=body=>call('import json,sys; from namelist_config import resolve; print(json.dumps(resolve(json.load(sys.stdin),strict=False)))',body);
const baseRequest=call('import json; from test_namelist_config import request; print(json.dumps({**request(),"configuration_profile":"wrf-ordinary-ui-2"}))');
async function setup(page,{initial=null,intercept=null}={}){
 const writes=[],checks=[],submits=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 if(initial)await page.addInitScript(value=>{window.__wrfInitialRequest=value;},initial);
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname;
  if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort();
  const reply=data=>route.fulfill({json:{code:0,data}});
  if(p==='/__fixture__/options')return route.fulfill({json:options});
  if(p==='/api/wrf/options')return reply({...options,workbench_management:{id:'wrf-workbench-management-1',direct_deletion:true,forcing_refresh:true,forcing_cycle_deletion:true}});
  if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});
  if(p==='/api/wrf/workbench/tasks')return reply({items:[],total:0,active_items:[]});
  if(p==='/api/wrf/data-status')return reply({pool_items:[]});
  if(p==='/api/wrf/forcing/refresh'&&request.method()==='GET')return reply({status:'idle'});
  if(p.endsWith('/domains/preview'))return reply(call('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',request.postDataJSON()));
  if(p.endsWith('/namelist/resolve')){const body=request.postDataJSON();checks.push(body);if(intercept&&await intercept(route,body,reply))return;try{return await reply(resolveConfig(body));}catch(e){return route.fulfill({status:422,json:{detail:String(e)}});}}
  if(p.endsWith('/tasks/validate')){const body=request.postDataJSON();submits.push(body);const result=resolveConfig(body);if(result.errors.length)return route.fulfill({status:422,json:{detail:result.errors.join('；')}});return reply({request:body,rules:result.rules});}
  if(p.startsWith('/api/')){writes.push(p);return route.abort();}
  return route.continue();
 });
 await page.goto('/tests/browser/wrf-shared.html');
 return {writes,checks,submits,errors};
}
const panel=page=>page.getByRole('region',{name:'参数组合校验'});
const levels=page=>page.getByLabel('垂直层数',{exact:true});
const start=page=>page.getByRole('button',{name:'开始模拟',exact:true});

test('known failing levels block execution with specific guidance and preserve input',async({page})=>{
 const state=await setup(page,{initial:{...baseRequest,vertical_levels:20}});
 await expect(panel(page)).toContainText('not enough eta levels');await expect(panel(page)).toContainText('至少设为 33');
 await expect(start(page)).toBeDisabled();await expect(levels(page)).toHaveValue('20');
 expect(state.submits).toHaveLength(0);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
 await page.screenshot({path:test.info().outputPath('twenty-layers-blocked.png')});
});
test('corrected combination shows pending input checks and submits exactly the entered values',async({page})=>{
 const state=await setup(page,{initial:{...baseRequest,vertical_levels:20}});
 await expect(panel(page)).toContainText('not enough eta levels');await levels(page).fill('33');
 await expect(panel(page)).toContainText('实际驱动资料最高层气压');await expect(panel(page).getByRole('alert')).toHaveCount(0);
 await start(page).click();await expect.poll(()=>state.submits.length).toBe(1);
 const submitted=await page.evaluate(()=>window.__wrfSubmission);expect(submitted.vertical_levels).toBe(33);expect(submitted.domains).toMatchObject(baseRequest.domains);expect(submitted.domains).toEqual(state.checks[0].domains);
 expect(submitted.namelist.input.domains?.p_top_requested).toBeUndefined();expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test('twenty explicit eta levels remain legal and are not rewritten',async({page})=>{
 const eta=Array.from({length:20},(_,i)=>1-i/19),initial={...baseRequest,vertical_levels:20,namelist:{...options.namelist_capability,wps:{},input:{domains:{eta_levels:eta}}}};
 const state=await setup(page,{initial});await expect.poll(()=>state.checks.length).toBeGreaterThan(0);await expect(panel(page)).toHaveAttribute('aria-busy','false');
 await expect(panel(page).getByRole('alert')).toHaveCount(0);await start(page).click();await expect.poll(()=>state.submits.length).toBe(1);
 const submitted=await page.evaluate(()=>window.__wrfSubmission);expect(submitted.namelist.input.domains.eta_levels).toEqual(eta);expect(submitted.vertical_levels).toBe(20);expect(state.writes).toEqual([]);
});
test('late invalid assessment cannot overwrite a newer valid configuration',async({page})=>{
 let release;const gate=new Promise(r=>release=r);let delayed=false;
 const state=await setup(page,{initial:baseRequest,intercept:async(route,body,reply)=>{if(body.vertical_levels===20){delayed=true;await gate;try{await reply(resolveConfig(body));}catch{}return true;}return false;}});
 await expect(panel(page)).toHaveAttribute('aria-busy','false');await levels(page).fill('20');await expect.poll(()=>delayed).toBe(true);
 await levels(page).fill('55');await expect.poll(()=>state.checks.some(c=>c.vertical_levels===55)).toBe(true);await expect(panel(page)).toHaveAttribute('aria-busy','false');release();
 await expect(panel(page).getByRole('alert')).toHaveCount(0);await expect(levels(page)).toHaveValue('55');await start(page).click();await expect.poll(()=>state.submits.length).toBe(1);expect(state.submits[0].vertical_levels).toBe(55);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test('assessment failure can be retried without changing configuration or creating a task',async({page})=>{
 let fail=true;const state=await setup(page,{initial:baseRequest,intercept:async(route)=>{if(fail){await route.fulfill({status:503,json:{detail:'隔离连接失败'}});return true;}return false;}});
 await expect(panel(page)).toContainText('参数组合尚未核验');await expect(levels(page)).toHaveValue('88');fail=false;await panel(page).getByRole('button',{name:'重新校验'}).click();
 await expect(panel(page)).toContainText('实际驱动资料最高层气压');await expect(panel(page).getByRole('alert')).toHaveCount(0);expect(state.submits).toHaveLength(0);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

test('server schema conflicts are blocked rather than labelled as a connection wait',async({page})=>{
 const state=await setup(page,{initial:baseRequest,intercept:async(route)=>{await route.fulfill({status:422,json:{detail:'边界层 2 不能配近地层 1；请选择近地层 2'}});return true;}});
 await expect(panel(page)).toContainText('边界层 2 不能配近地层 1');await expect(start(page)).toBeDisabled();await expect(panel(page)).not.toContainText('参数组合尚未核验');await expect(levels(page)).toHaveValue('88');expect(state.submits).toHaveLength(0);expect(state.writes).toEqual([]);
});

test('actual studio keeps conflict guidance and disabled submit visible at desktop and small viewport',async({page})=>{
 const state=await setup(page);await page.addInitScript(()=>{localStorage.setItem('token','isolated-validation-fixture');localStorage.setItem('user',JSON.stringify({uuid:'validation-fixture',username:'fixture',role:2}));});await page.goto('/wrf');await page.getByRole('button',{name:'按坐标创建 D01',exact:true}).click();await levels(page).fill('20');
 await expect(panel(page)).toContainText('not enough eta levels');
 for(const [width,height] of [[1366,768],[390,844]]){
  await page.setViewportSize({width,height});await expect(panel(page)).toBeVisible();await expect(start(page)).toBeVisible();await expect(start(page)).toBeDisabled();
  for(const target of [panel(page),start(page)]){const b=await target.boundingBox();expect(b.y).toBeGreaterThanOrEqual(0);expect(b.y+b.height).toBeLessThanOrEqual(height);}
 }
 await page.setViewportSize({width:1366,height:768});await page.screenshot({path:test.info().outputPath('actual-studio-conflict.png'),fullPage:true});expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';

// Geometry/result fixtures keep their existing mocked server contract. The
// dedicated configuration-validation suite exercises real combination rules.
async function fixtureConfigurationPreview(route){
 if(new URL(route.request().url()).pathname!=='/api/wrf/namelist/resolve')return false;
 await route.fulfill({json:{code:0,data:{errors:[],rules:[]}}});return true;
}
test('pool has one refresh action for both sources without cleanup dialogs',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture-not-a-real-token');localStorage.setItem('user',JSON.stringify({uuid:'pool-owner',username:'fixture',role:2}));});
 const writes=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});
 if(p==='/api/wrf/forcing/refresh'&&r.method()==='GET')return reply({status:'idle'});if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/workbench/tasks')return reply({items:[]});
 if(p==='/api/wrf/data-status')return reply({status:'partial',pool_items:['gfs','ecmwf'].map(provider=>({provider,label:provider.toUpperCase(),status:'partial',cycles:[{cycle:'2026100900',completed_files:2,total_files:provider==='gfs'?73:25,size_bytes:1e9,status:'partial'}]}))});
 if(p==='/api/wrf/forcing/refresh'&&r.method()==='POST'){writes.push(p);return reply({id:'refresh-fixture',status:'accepted'});}
 if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf');await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.getByRole('heading',{name:'预报数据池',exact:true})).toBeVisible();
 await expect(page.locator('.pool-provider')).toHaveCount(2);await expect(page.locator('.pool-provider').first()).toContainText('2/73');await expect(page.locator('.pool-provider').last()).toContainText('2/25');
 await expect(page.locator('.data-pool .side-action')).toHaveCount(1);await expect(page.getByRole('button',{name:'下载与补缺',exact:true})).toHaveCount(0);await page.locator('.data-pool').getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes).toEqual(['/api/wrf/forcing/refresh']);await expect(page.getByRole('dialog')).toHaveCount(0);
});
const python=process.env.WRF_TEST_PYTHON||'python3',backend=resolve(process.env.WRF_BACKEND_DIR||'../backend_wrf');
function backendCall(code,value={}){return JSON.parse(execFileSync(python,['-B','-c',code],{cwd:backend,input:JSON.stringify(value),encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));}
const options={configuration_profile:backendCall('import json; from configuration_profile import definition; print(json.dumps(definition()))'),workbench_management:{id:'wrf-workbench-management-1',direct_deletion:true,forcing_refresh:true,forcing_cycle_deletion:true},namelist_capability:{schema_version:'fixture',source_hash:'fixture'}};
const browserErrors=new WeakMap();
test.beforeEach(({page})=>{const errors=[];browserErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));});
test.afterEach(async({page},info)=>{if(info.status!==info.expectedStatus){await page.screenshot({path:info.outputPath('failure.png'),fullPage:true});console.log('WRF UI alerts:',await page.getByRole('alert').allTextContents(),'submit:',await page.locator('.wrf-submit-status').allTextContents());}expect(browserErrors.get(page)).toEqual([]);});
test('shared workbench creates an empty-map tree, edits runtime fields and submits without plan/checkboxes',async({page})=>{
 const requests=[],validations=[];await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});if(u.pathname==='/__fixture__/options')return reply(options);if(u.pathname.endsWith('/domains/preview')){const body=r.postDataJSON();requests.push(body);try{return reply({code:0,data:backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',body)});}catch(e){return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({code:1,detail:String(e.stderr||e.message).trim().split('\n').at(-1)})});}}if(u.pathname.endsWith('/tasks/validate')){validations.push(r.postDataJSON());return reply({code:0,data:{request:r.postDataJSON(),warnings:[]}});}if(u.pathname.startsWith('/api/'))throw new Error(`Unexpected live API: ${u.pathname}`);return route.continue();});
 await page.goto('/tests/browser/wrf-shared.html');await expect(page.locator('.wrf-domain-row')).toHaveCount(0);await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeDisabled();await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(page.getByText('根据区域推荐')).toHaveCount(0);
 await page.getByRole('button',{name:'框选 D01',exact:true}).click();const map=await page.locator('.wrf-map').boundingBox();await page.mouse.move(map.x+map.width*.25,map.y+map.height*.3);await page.mouse.down();await page.mouse.move(map.x+map.width*.75,map.y+map.height*.7,{steps:6});await page.mouse.up();await expect(page.locator('.wrf-domain-row')).toHaveCount(1);await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'为d01增加子域',exact:true}).click();await expect(page.locator('.wrf-domain-row')).toHaveCount(2);await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'为d01增加子域',exact:true}).click();await expect(page.locator('.wrf-domain-row')).toHaveCount(3);await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'为d02增加子域',exact:true}).click();await expect(page.locator('.wrf-domain-row')).toHaveCount(4);await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();expect(requests.at(-1).domains.map(d=>d.parent_id)).toEqual([0,1,2,1]);
 await page.getByRole('button',{name:'移动 / 缩放域',exact:true}).click();const moveTarget=await page.locator('.wrf-domain-overlay path.editable').nth(2).boundingBox();await page.mouse.move(moveTarget.x+moveTarget.width/2,moveTarget.y+moveTarget.height/2);await page.mouse.down();await page.mouse.move(moveTarget.x+moveTarget.width/2+15,moveTarget.y+moveTarget.height/2-10,{steps:4});await page.mouse.up();await expect.poll(()=>requests.at(-1).edit?.operation).toBe('move');await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();await page.locator('.wrf-domain-title').filter({hasText:/^D02 /}).click();const corner=page.locator('circle.wrf-domain-handle').first();const handle=await corner.boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2-15,handle.y+handle.height/2-15,{steps:4});await page.mouse.up();await expect.poll(()=>requests.at(-1).edit?.operation).toBe('resize');await expect(page.getByRole('alert')).toContainText('缩放会越过子域');await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeDisabled();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'删除d02及子域',exact:true}).click();await expect(page.locator('.wrf-domain-row')).toHaveCount(2);await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('.wrf-domain-row')).toHaveCount(4);await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();
 await page.getByLabel('Spin-up（小时）',{exact:true}).fill('0');await page.getByLabel('垂直层数',{exact:true}).fill('65');await page.getByLabel(/^开始时间（UTC）/).fill('2026-10-08T00:00');await page.getByLabel(/^结束时间（UTC）/).fill('2026-10-08T12:00');await page.getByRole('button',{name:'开始模拟',exact:true}).click();await expect.poll(()=>validations.length).toBe(1);await expect.poll(()=>page.evaluate(()=>window.__wrfSubmission?.vertical_levels)).toBe(65);expect(validations[0].spinup).toEqual({mode:'custom',hours:0});expect(validations[0].domains.every(d=>!('node_key'in d))).toBe(true);expect(validations[0].physics.cu_physics).toBeUndefined();await expect(page.getByText('运行计划 · 请审阅后确认创建')).toHaveCount(0);await page.screenshot({path:test.info().outputPath('workbench-shared.png'),fullPage:true});
});

for(const failure of ['transport','http503'])test(`actual studio reconciles ${failure} uncertain creation once, restores logs and authenticated result controls`,async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture-not-a-real-token');localStorage.setItem('user',JSON.stringify({uuid:'fixture-user',username:'fixture',role:2}));localStorage.setItem('zhihui-theme','light');});
 const creates=[],lookups=[],assets=[];let task=null;
 const webp=Buffer.from(backendCall("import io,json,base64; from PIL import Image; b=io.BytesIO(); Image.new('RGBA',(4,4),(20,140,230,180)).save(b,format='WEBP'); print(json.dumps(base64.b64encode(b.getvalue()).decode()))"),'base64');
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),path=u.pathname;if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(path==='/api/wrf/forcing/refresh'&&route.request().method()==='GET')return route.fulfill({status:404,json:{detail:'Not Found'}});if(path==='/api/wrf/forcing/downloads')return reply({items:[]});if(path==='/api/wrf/forcing/policy')return reply({version:0,enabled:false,auto_cleanup:false,held_cycles:{gfs:[],ecmwf:[]}});if(path==='/api/wrf/forcing/refresh'&&r.method()==='GET')return reply({status:'idle'});if(path==='/api/wrf/options')return reply(options);if(path==='/api/health')return reply({status:'online',hpc:{status:'ready',message:'fixture environment'}});if(path==='/api/wrf/domains/preview')return reply(backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',r.postDataJSON()));if(path==='/api/wrf/tasks/validate')return reply({request:r.postDataJSON(),warnings:[]});if((path==='/api/wrf/tasks'||path==='/api/wrf/workbench/tasks')&&r.method()==='POST'){creates.push({body:r.postDataJSON(),key:r.headers()['idempotency-key']});task={id:'fixture-task',status:'running',stage:'wrf',progress:68,runtime:{current_stage:'wrf',current_stage_status:'running',current_model_time:'2026-10-08T00:30:00Z',model_progress:20.4},attempt_no:1,request:r.postDataJSON()};return failure==='http503'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'fixture proxy unavailable after task accepted'})}):route.abort('failed');}if(path.startsWith('/api/wrf/submissions/')){lookups.push(path);return reply({task_id:task?.id,status:'accepted'});}if((path==='/api/wrf/tasks'||path==='/api/wrf/workbench/tasks'))return reply({items:task?[task]:[]});if(path==='/api/wrf/tasks/fixture-task')return reply(task);if(path==='/api/wrf/tasks/fixture-task/logs')return reply({text:'bounded fixture log',offset:19});if(path==='/api/wrf/display')return reply({meta_json:{default_domain:'d01',domains:[{id:'d01',dx:27000,extent:[100,30,110,40],geolocation:{status:'reprojected',target_crs:'EPSG:3857'},variables:[{name:'T2',label:'2 米温度',units:'K',palette:[[0,10,20],[250,240,230]],frames:[{time:'2026-10-08T00:00:00Z',url:'/data/WRF/runs/fixture-task/T2/0.webp',display_min:280,display_max:300},{time:'2026-10-08T01:00:00Z',url:'/data/WRF/runs/fixture-task/T2/1.webp',display_min:280,display_max:300}]}]}]}});if(path.startsWith('/data/WRF/')){assets.push({path,authorization:r.headers().authorization});return route.fulfill({contentType:'image/webp',body:webp});}if(path==='/api/wrf/data-status')return reply({status:'ready',pool_items:[]});if(path.startsWith('/api/'))throw new Error('Unexpected live API '+path);return route.continue();});
 await page.goto('/wrf');await expect(page.getByRole('heading',{name:'WRF 工作台',exact:true})).toBeVisible();await expect(page.locator('.wrf-domain-row')).toHaveCount(0);await page.getByRole('button',{name:'按坐标创建 D01',exact:true}).click();await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();await page.getByRole('button',{name:'开始模拟',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'提交响应不明确'})).toBeVisible();expect(creates).toHaveLength(1);const pending=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('wrf:pending:')).map(k=>JSON.parse(localStorage.getItem(k))));expect(pending).toHaveLength(1);expect(pending[0].key).toBe(creates[0].key);await page.getByRole('button',{name:'开始模拟',exact:true}).click();await expect(page.locator('.task-run')).toBeVisible();expect(creates).toHaveLength(1);expect(lookups).toHaveLength(1);expect(decodeURIComponent(lookups[0].split('/').at(-1))).toBe(creates[0].key);expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('wrf:pending:')))).toHaveLength(0);await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.right-sidebar .mini-status')).toHaveText('运行中 · 模拟进度 20.4%');task={...task,runtime:{current_stage:'wps',current_stage_status:'running'}};await page.getByRole('button',{name:/^任务与资料/}).click();await page.getByRole('button',{name:'刷新状态',exact:true}).click();await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.right-sidebar .mini-status')).toHaveText('运行中');task={...task,status:'waiting_restart',stage:'failed'};await page.getByRole('button',{name:/^任务与资料/}).click();await page.getByRole('button',{name:'刷新状态',exact:true}).click();await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.right-sidebar .mini-status')).toHaveText('失败·待处理');await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.terminal-card')).toBeVisible();await expect(page.getByText('恢复操作须在')).toHaveCount(0);await expect(page.locator('.terminal-card pre')).toContainText('bounded fixture log');task={...task,status:'succeeded',progress:100};await expect(page.getByRole('button',{name:'查看结果',exact:true})).toBeVisible({timeout:10000});await page.getByRole('button',{name:'查看结果',exact:true}).click();await expect(page.locator('.visual-map')).toBeVisible();await expect(page.getByRole('combobox',{name:'变量',exact:true})).toHaveValue('T2');await expect(page.locator('.proj-canvas[data-data-ready="true"]')).toBeVisible();await page.getByRole('button',{name:'下一帧',exact:true}).click();await expect.poll(()=>assets.length).toBe(2);expect(assets.every(a=>a.authorization==='Bearer fixture-not-a-real-token')).toBe(true);await expect(page.locator('.lc-bar')).toHaveCSS('background-image','linear-gradient(to right, rgb(0, 10, 20), rgb(250, 240, 230))');await page.getByRole('button',{name:'播放',exact:true}).click();await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('studio-result.png'),fullPage:true});await page.goto('/wrf/high-resolution');await expect(page.getByRole('heading',{name:'高分降尺度功能已退役'})).toBeVisible();expect(creates).toHaveLength(1);await page.goto('/tests/fixtures/highres-preview.html');await expect(page.getByRole('heading',{name:'高分配置测试入口已退役'})).toBeVisible();
});

test('actual studio reuses a reactive request and legacy namelist projection without creating a task',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture-not-a-real-token');localStorage.setItem('user',JSON.stringify({uuid:'fixture-user',username:'fixture',role:2}));});
 const request={configuration_profile:'wrf-ordinary-ui-2',data_source:'gfs',start_time:'2026-10-07T06:00:00Z',end_time:'2026-10-08T06:00:00Z',forecast_interval_hours:1,history_interval_minutes:60,spinup:{mode:'custom',hours:3},vertical_levels:60,assimilation_scheme:'fdda_weak',center:{lat:30,lon:116},physics:{...options.configuration_profile.physics_defaults,cu_physics_by_domain:[0,3,0,3]},domains:[{id:'d01',dx:27000,dy:27000,e_we:61,e_sn:61,parent_id:0,parent_grid_ratio:1,i_parent_start:1,j_parent_start:1},{id:'d02',dx:9000,dy:9000,e_we:31,e_sn:31,parent_id:1,parent_grid_ratio:3,i_parent_start:6,j_parent_start:6},{id:'d03',dx:3000,dy:3000,e_we:31,e_sn:31,parent_id:2,parent_grid_ratio:3,i_parent_start:6,j_parent_start:6},{id:'d04',dx:9000,dy:9000,e_we:31,e_sn:31,parent_id:1,parent_grid_ratio:3,i_parent_start:35,j_parent_start:6}],namelist:{schema_version:'fixture',source_hash:'fixture',wps:{geogrid:{map_proj:'lambert',truelat1:30,truelat2:30,stand_lon:116}},input:{}}};
 const original=structuredClone(request),task={id:'fixture-reuse',status:'succeeded',stage:'failed',attempt_no:1,request},previews=[],validations=[],posts=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),path=u.pathname;if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(path==='/api/wrf/forcing/downloads')return reply({items:[]});if(path==='/api/wrf/forcing/policy')return reply({version:0,enabled:false,auto_cleanup:false,held_cycles:{gfs:[],ecmwf:[]}});if(path==='/api/wrf/forcing/refresh'&&r.method()==='GET')return reply({status:'idle'});if(path==='/api/wrf/options')return reply(options);if(path==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if((path==='/api/wrf/tasks'||path==='/api/wrf/workbench/tasks')&&r.method()==='GET')return reply({items:[task]});if(path==='/api/wrf/tasks/fixture-reuse')return reply(task);if(path==='/api/wrf/tasks/fixture-reuse/logs')return reply({text:'',offset:0});if(path==='/api/wrf/domains/preview'){previews.push(r.postDataJSON());return reply(backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',r.postDataJSON()));}if(path==='/api/wrf/tasks/validate'){validations.push(r.postDataJSON());return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({detail:'Fixture stops after read-only validation; no task is created.'})});}if(r.method()==='POST'){posts.push(path);throw new Error('Reuse must not submit or recover '+path);}if(path==='/api/wrf/display')return reply({meta_json:{domains:[]}});if(path==='/api/wrf/data-status')return reply({status:'ready',pool_items:[]});if(path.startsWith('/api/'))throw new Error('Unexpected live API '+path);return route.continue();});
 await page.goto('/wrf?view=run&task_id=fixture-reuse');await page.getByRole('button',{name:'复制并新建',exact:true}).click();await expect(page.locator('.wrf-domain-row')).toHaveCount(4);await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();await expect.poll(()=>previews.length).toBe(1);
 const reused=await page.locator('wrf-config-editor').evaluate(el=>el.config);expect(reused.spinup).toEqual(original.spinup);expect(reused.vertical_levels).toBe(60);expect(reused.assimilation_scheme).toBe('fdda_weak');expect(reused.physics.cu_physics_by_domain).toEqual([0,3,0,3]);expect(reused.domains.map(({node_key,...domain})=>domain)).toEqual(original.domains);expect(reused.namelist).toEqual(original.namelist);expect(reused.projection).toMatchObject(original.namelist.wps.geogrid);expect(reused.start_time).toBe(original.start_time);expect(reused.end_time).toBe(original.end_time);
 await page.getByLabel('Spin-up（小时）',{exact:true}).fill('0');await page.getByLabel('垂直层数',{exact:true}).fill('65');expect((await page.locator('wrf-config-editor').evaluate(el=>el.config)).spinup.hours).toBe(0);expect(request).toEqual(original);expect(posts).toEqual([]);
 await page.getByRole('button',{name:/^任务与资料/}).click();await page.locator('.history-card .task-items article').click();await page.getByRole('button',{name:'运行过程',exact:true}).click();await page.getByRole('button',{name:'复制并新建',exact:true}).click();await expect(page.getByLabel('Spin-up（小时）',{exact:true})).toHaveValue('3');await expect(page.getByLabel('垂直层数',{exact:true})).toHaveValue('60');await expect(page.locator('.wrf-domain-row')).toHaveCount(4);await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();expect(posts).toEqual([]);
 await page.getByRole('button',{name:'开始模拟',exact:true}).click();await expect.poll(()=>validations.length).toBe(1);expect(validations[0].namelist.wps.geogrid).toMatchObject({map_proj:'lambert',truelat1:30,truelat2:30,stand_lon:116});expect(validations[0].domains).toEqual(original.domains);expect(validations[0].spinup).toEqual(original.spinup);expect(posts).toEqual([]);expect(request).toEqual(original);
});

test('an older ordinary backend keeps configuration editable without new management routes',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'legacy-owner',username:'fixture',role:2}));});
 const unexpected=[];const older={...options};delete older.workbench_management;
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const u=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();const p=u.pathname,reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(p==='/api/wrf/forcing/refresh'&&route.request().method()==='GET')return route.fulfill({status:404,json:{detail:'Not Found'}});if(p==='/api/wrf/options')return reply(older);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/workbench/tasks')return reply({items:[]});if(p==='/api/wrf/data-status')return reply({pool_items:[]});if(p.startsWith('/api/')){unexpected.push(p);return route.abort();}return route.continue();});
 await page.goto('/wrf');await page.getByLabel('Spin-up（小时）',{exact:true}).fill('0');await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.getByRole('heading',{name:'历史任务',exact:true})).toBeVisible();await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.getByLabel('Spin-up（小时）',{exact:true})).toHaveValue('0');expect(unexpected).toEqual([]);
});
test('loading and legacy capabilities keep the actual studio editable without allowing execution',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture-not-a-real-token');localStorage.setItem('user',JSON.stringify({uuid:'fixture-user',username:'fixture',role:2}));});
 let finishOptions;const gate=new Promise(resolve=>{finishOptions=resolve;});
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const path=new URL(route.request().url()).pathname;if(!['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(path==='/api/wrf/forcing/refresh'&&route.request().method()==='GET')return route.fulfill({status:404,json:{detail:'Not Found'}});if(path==='/api/wrf/forcing/downloads')return reply({items:[]});if(path==='/api/wrf/forcing/policy')return reply({version:0,enabled:false,auto_cleanup:false,held_cycles:{gfs:[],ecmwf:[]}});if(path==='/api/wrf/options'){await gate;return reply({configuration_profile:{id:'wrf-ordinary-ui-1'}});}if(path==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if((path==='/api/wrf/tasks'||path==='/api/wrf/workbench/tasks'))return reply({items:[]});if(path==='/api/wrf/data-status')return reply({status:'ready',pool_items:[]});if(path.startsWith('/api/'))throw new Error('Execution/API unexpectedly requested '+path);return route.continue();});
 await page.goto('/wrf');await expect(page.getByText('正在读取模拟配置，您可以先编辑参数。')).toBeVisible();await expect(page.getByLabel('垂直层数',{exact:true})).toBeEnabled();await page.getByLabel('Spin-up（小时）',{exact:true}).fill('0');await page.getByLabel('垂直层数',{exact:true}).fill('55');finishOptions();await expect(page.getByText('工作台服务能力尚未更新，参数可以继续编辑，暂不能开始模拟。')).toBeVisible();await expect(page.getByLabel('垂直层数',{exact:true})).toHaveValue('55');await expect(page.getByLabel('Spin-up（小时）',{exact:true})).toHaveValue('0');await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'按坐标创建 D01',exact:true})).toBeEnabled();await page.screenshot({path:test.info().outputPath('capabilities-preserved.png'),fullPage:true});
});

test('input-only geometry edits survive late root preview and submit without blur',async({page})=>{
 const previews=[],validations=[];let releaseRoot;
 const rootGate=new Promise(resolve=>{releaseRoot=resolve;});
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;
  const request=route.request(),url=new URL(request.url());if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort();
  const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});
  if(url.pathname==='/__fixture__/options')return route.fulfill({contentType:'application/json',body:JSON.stringify(options)});
  if(url.pathname.endsWith('/domains/preview')){const body=request.postDataJSON();previews.push(body);if(previews.length===1)await rootGate;const response=backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',body);try{return await reply(response);}catch{return;}}
  if(url.pathname.endsWith('/tasks/validate')){validations.push(request.postDataJSON());return reply({request:request.postDataJSON(),warnings:[]});}
  if(url.pathname==='/api/wrf/data-status')return reply({status:'ready',pool_items:[]});if(url.pathname.startsWith('/api/'))throw new Error('Unexpected live API '+url.pathname);return route.continue();
 });
 await page.goto('/tests/browser/wrf-shared.html');await page.getByRole('button',{name:'按坐标创建 D01',exact:true}).click();await expect.poll(()=>previews.length).toBe(1);
 await page.locator('.wrf-settings label').evaluateAll((labels,entries)=>{for(const [label,value]of entries){const input=labels.find(l=>l.firstChild.textContent.trim()===label).querySelector('input');input.value=value;input.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText'}));}},[['中心纬度','30'],['中心经度','116'],['truelat1','30'],['truelat2','30'],['stand_lon','116'],['东西网格数','41'],['南北网格数','41']]);
 releaseRoot();await page.getByRole('button',{name:'开始模拟',exact:true}).click();await expect.poll(()=>validations.length).toBe(1);
 expect(previews).toHaveLength(2);expect(previews[1].center).toMatchObject({lat:30,lon:116});
 expect(validations[0].center).toMatchObject({lat:30,lon:116});expect(validations[0].domains[0]).toMatchObject({e_we:41,e_sn:41});expect(validations[0].namelist.wps.geogrid).toMatchObject({truelat1:30,truelat2:30,stand_lon:116});
 await expect(page.getByLabel('中心纬度',{exact:true})).toHaveValue('30');await expect(page.getByLabel('南北网格数',{exact:true})).toHaveValue('41');
 await page.getByLabel('中心经度',{exact:true}).fill('117');await page.getByRole('button',{name:'开始模拟',exact:true}).click();await expect.poll(()=>validations.length).toBe(2);expect(validations[1].center.lon).toBe(117);
});

test('selected-domain cumulus preserves explicit siblings, follows spacing when reset and survives subtree undo',async({page})=>{
 const validations=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(u.pathname==='/__fixture__/options')return route.fulfill({contentType:'application/json',body:JSON.stringify(options)});if(u.pathname.endsWith('/domains/preview'))return reply(backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',r.postDataJSON()));if(u.pathname.endsWith('/tasks/validate')){validations.push(r.postDataJSON());return reply({request:r.postDataJSON(),warnings:[]});}if(u.pathname.startsWith('/api/'))throw new Error('Unexpected live API '+u.pathname);return route.continue();});
 await page.goto('/tests/browser/wrf-shared.html');const submit=page.getByRole('button',{name:'开始模拟',exact:true});await page.getByRole('button',{name:'按坐标创建 D01',exact:true}).click();await expect(submit).toBeEnabled();
 for(const parent of ['d01','d01','d02']){await page.getByRole('button',{name:`为${parent}增加子域`,exact:true}).click();await expect(submit).toBeEnabled();}
 await page.evaluate(()=>{const editor=document.querySelector('wrf-config-editor'),config=JSON.parse(JSON.stringify(editor.config));config.physics.cu_physics_by_domain=[3,1,0,2];editor.config=config;});
 const cu=page.getByRole('combobox',{name:'当前域积云对流',exact:true});await page.locator('.wrf-domain-title').filter({hasText:/^D02 /}).click();await expect(cu).toHaveValue('1');await cu.selectOption('auto');await submit.click();await expect.poll(()=>validations.length).toBe(1);expect(validations[0].physics.cu_physics_by_domain).toEqual([3,3,0,2]);expect(validations[0].ui_cumulus_overrides).toBeUndefined();
 await page.locator('.wrf-domain-title').filter({hasText:/^D01 /}).click();await page.getByLabel('网格距（m）',{exact:true}).fill('9000');await expect(submit).toBeEnabled();await page.locator('.wrf-domain-title').filter({hasText:/^D02 /}).click();await expect(cu).toHaveValue('auto');await expect(page.getByText(/当前采用.*（0）.*按网格距默认/)).toBeVisible();await submit.click();await expect.poll(()=>validations.length).toBe(2);expect(validations[1].physics.cu_physics_by_domain).toEqual([3,0,0,2]);
 await page.getByRole('button',{name:'删除d02及子域',exact:true}).click();await expect(page.locator('.wrf-domain-row')).toHaveCount(2);await expect(page.getByRole('status').filter({hasText:'已删除 D02、D03（含子域）'})).toBeVisible();await expect(submit).toBeEnabled();await page.locator('.wrf-domain-title').filter({hasText:/^D02 /}).click();await expect(cu).toHaveValue('2');await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('.wrf-domain-row')).toHaveCount(4);await expect(submit).toBeEnabled();await expect(page.getByRole('status').filter({hasText:'已撤销上次修改'})).toBeVisible();await page.locator('.wrf-domain-title').filter({hasText:/^D02 /}).click();await expect(cu).toHaveValue('auto');await submit.click();await expect.poll(()=>validations.length).toBe(3);expect(validations[2].physics.cu_physics_by_domain).toEqual([3,0,0,2]);await expect(submit).toBeEnabled();await cu.scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('domain-cumulus-undo.png'),fullPage:true});
});

test('failed projection can be retried without changing parameters and retains the last boundary',async({page})=>{
 const previews=[];let fail=true;
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();if(u.pathname==='/__fixture__/options')return route.fulfill({contentType:'application/json',body:JSON.stringify(options)});if(u.pathname.endsWith('/domains/preview')){const body=r.postDataJSON();previews.push(body);if(fail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'fixture projection unavailable'})});return route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data:backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',body)})});}if(u.pathname.startsWith('/api/'))throw new Error('Unexpected live API '+u.pathname);return route.continue();});
 await page.goto('/tests/browser/wrf-shared.html');const submit=page.getByRole('button',{name:'开始模拟',exact:true}),retry=page.getByRole('button',{name:'重新校验投影',exact:true});await page.getByRole('button',{name:'按坐标创建 D01',exact:true}).click();await expect(retry).toBeVisible();await expect(submit).toBeDisabled();fail=false;await retry.click();await expect(submit).toBeEnabled();expect(previews[1]).toEqual(previews[0]);const boundaries=page.locator('.wrf-domain-overlay path.editable');expect(await boundaries.count()).toBeGreaterThan(0);const previous=await boundaries.first().getAttribute('d');
 fail=true;await page.getByLabel('中心经度',{exact:true}).fill('116');await expect(retry).toBeVisible();await expect(boundaries.first()).toHaveAttribute('d',previous);await expect(submit).toBeDisabled();fail=false;await retry.click();await expect(submit).toBeEnabled();expect(previews[3]).toEqual(previews[2]);await expect(page.getByLabel('中心经度',{exact:true})).toHaveValue('116');
});

test('shared run view localizes recovery and failure while retaining unknown codes',async({page})=>{
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const url=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort();if(url.pathname==='/__fixture__/options')return route.fulfill({contentType:'application/json',body:JSON.stringify(options)});if(url.pathname==='/api/wrf/data-status')return reply({status:'ready',pool_items:[]});if(url.pathname.startsWith('/api/'))throw new Error('Unexpected live API '+url.pathname);return route.continue();});
 await page.goto('/tests/browser/wrf-shared.html');
 await page.evaluate(()=>{const viewer=document.createElement('wrf-run-viewer');viewer.id='run-label-fixture';viewer.task={id:'fixture-failed',status:'waiting_restart',stage:'failed',progress:4};document.body.append(viewer);});
 const viewer=page.locator('#run-label-fixture');await expect(viewer.getByText('失败·待处理',{exact:true})).toBeVisible();await expect(viewer.getByText('已失败',{exact:true})).toBeVisible();
 await page.evaluate(()=>document.querySelector('#run-label-fixture').task={id:'fixture-unknown',status:'new_status',stage:'new_stage',progress:4});
 await expect(viewer.getByText('未知状态（new_status）',{exact:true})).toBeVisible();await expect(viewer.getByText('未知阶段（new_stage）',{exact:true})).toBeVisible();
 await page.evaluate(()=>document.querySelector('#run-label-fixture').task={id:'fixture-wps',status:'running',stage:'running',progress:68,runtime:{current_stage:'wps',current_stage_status:'running'}});
 await expect(viewer.getByText('WPS 前处理',{exact:true})).toBeVisible();await expect(viewer.getByText('前处理运行中，暂无可测模拟进度',{exact:true})).toBeVisible();await expect(viewer.locator('progress')).toHaveCount(0);await expect(viewer.getByText('68%',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>document.querySelector('#run-label-fixture').task={id:'fixture-wrf',status:'running',stage:'running',progress:68,runtime:{current_stage:'wrf',current_stage_status:'running',current_model_time:'2026-10-06T00:30:00Z',model_progress:50}});
 await expect(viewer.getByText('WRF 模拟运行',{exact:true})).toBeVisible();await expect(viewer.getByText('2026-10-06 00:30:00 UTC',{exact:true})).toBeVisible();await expect(viewer.getByText('模拟进度 50%',{exact:true})).toBeVisible();await expect(viewer.locator('progress')).toHaveAttribute('value','50');
});

test('invalid numeric buffers block all workbench submit paths, preserve text and recover only after valid edits',async({page})=>{
 const validations=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(u.pathname==='/__fixture__/options')return route.fulfill({contentType:'application/json',body:JSON.stringify(options)});if(u.pathname.endsWith('/domains/preview'))return reply(backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',r.postDataJSON()));if(u.pathname.endsWith('/tasks/validate')){validations.push(r.postDataJSON());return reply({request:r.postDataJSON(),warnings:[]});}if(u.pathname.startsWith('/api/'))throw new Error('Unexpected live API '+u.pathname);return route.continue();});
 await page.goto('/tests/browser/wrf-shared.html');const submit=page.getByRole('button',{name:'开始模拟',exact:true});await page.getByRole('button',{name:'按坐标创建 D01',exact:true}).click();await expect(submit).toBeEnabled();await page.evaluate(()=>{window.__validationEvents=[];document.querySelector('wrf-config-editor').addEventListener('validation-change',e=>window.__validationEvents.push(e.detail));});
 const spinup=page.getByLabel('Spin-up（小时）',{exact:true});await spinup.fill('');await expect(submit).toBeDisabled();await expect(page.getByRole('alert').filter({hasText:'Spin-up（小时）不能为空'})).toBeVisible();await spinup.press('Enter');await page.evaluate(()=>document.querySelector('wrf-config-editor').dispatchEvent(new CustomEvent('action',{detail:{action:'submit'}})));expect(validations).toHaveLength(0);expect(await page.evaluate(()=>window.__validationEvents.at(-1).valid)).toBe(false);
 await page.getByLabel('垂直层数',{exact:true}).fill('55');await expect(spinup).toHaveValue('');await expect(submit).toBeDisabled();await spinup.fill('0');await expect(submit).toBeEnabled();
 for(const [label,invalid,valid] of [['Spin-up（小时）','-1','0'],['垂直层数','501','55'],['垂直层数','55.5','55'],['中心纬度','91','35'],['中心经度','181','104'],['truelat1','-91','35'],['truelat2','91','35'],['stand_lon','181','104'],['网格距（m）','999','27000'],['东西网格数','501','100'],['南北网格数','-1','79']]){
  const input=page.getByLabel(label,{exact:true});await input.fill(invalid);await expect(submit).toBeDisabled();await expect(input).toHaveValue(invalid);await page.evaluate(()=>document.querySelector('wrf-config-editor').dispatchEvent(new CustomEvent('action',{detail:{action:'submit'}})));expect(validations).toHaveLength(0);await input.fill(valid);await expect(submit).toBeEnabled();
 }
 await page.getByRole('button',{name:'为d01增加子域',exact:true}).click();await expect(submit).toBeEnabled();await page.getByLabel('父域起点 i',{exact:true}).fill('0');await expect(submit).toBeDisabled();await page.getByLabel('父域起点 i',{exact:true}).fill('2');await expect(submit).toBeEnabled();await page.getByLabel('东西网格数',{exact:true}).fill('');await page.locator('.wrf-domain-title').filter({hasText:/^D01 /}).click();await expect(submit).toBeDisabled();await page.getByRole('button',{name:'删除d02及子域',exact:true}).click();await expect(submit).toBeEnabled();
 await spinup.fill('');await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(spinup).toHaveValue('0');await expect(submit).toBeEnabled();await submit.click();await expect.poll(()=>validations.length).toBe(1);expect(validations[0].spinup.hours).toBe(0);expect(validations[0].vertical_levels).toBe(55);expect(JSON.stringify(validations[0])).not.toContain('invalidInputs');expect(await page.evaluate(()=>window.__validationEvents.at(-1).valid)).toBe(true);
});

test('same-draft props retain invalid buffers and changing editor identity clears them',async({page})=>{
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();if(u.pathname==='/__fixture__/options')return route.fulfill({contentType:'application/json',body:JSON.stringify(options)});if(u.pathname.startsWith('/api/'))throw new Error('Unexpected live API '+u.pathname);return route.continue();});
 await page.goto('/tests/browser/wrf-shared.html');await expect(page.locator('wrf-config-editor')).toBeVisible();await page.evaluate(options=>{const editor=document.createElement('wrf-config-editor');editor.id='numeric-buffer-fixture';editor.options=options;editor.config=JSON.parse(JSON.stringify(document.querySelector('wrf-config-editor').config));editor.editorKey='draft-a';editor.hideSubmit=true;window.__bufferStates=[];editor.addEventListener('validation-change',e=>window.__bufferStates.push(e.detail));document.body.append(editor);},options);
 const editor=page.locator('#numeric-buffer-fixture'),levels=editor.getByLabel('垂直层数',{exact:true});await levels.fill('');await expect(editor.getByRole('alert')).toContainText('垂直层数不能为空');await page.evaluate(()=>{const editor=document.querySelector('#numeric-buffer-fixture');editor.config={...JSON.parse(JSON.stringify(editor.config)),spinup:{mode:'custom',hours:0}};});await expect(levels).toHaveValue('');expect(await page.evaluate(()=>window.__bufferStates.at(-1).valid)).toBe(false);await page.evaluate(()=>{const editor=document.querySelector('#numeric-buffer-fixture');editor.editorKey='draft-b';editor.config={...JSON.parse(JSON.stringify(editor.config)),vertical_levels:60};});await expect(levels).toHaveValue('60');await expect(editor.getByRole('alert')).toHaveCount(0);expect(await page.evaluate(()=>window.__bufferStates.at(-1).valid)).toBe(true);
});

test('shared run errors show factual summaries and bounded redacted technical details',async({page})=>{
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();if(u.pathname==='/__fixture__/options')return route.fulfill({contentType:'application/json',body:JSON.stringify(options)});if(u.pathname.startsWith('/api/'))throw new Error('Unexpected live API '+u.pathname);return route.continue();});
 await page.goto('/tests/browser/wrf-shared.html');
 await page.evaluate(()=>{const viewer=document.createElement('wrf-run-viewer');viewer.id='run-error-fixture';viewer.hostMode='agent';viewer.task={id:'fixture-output-failure',status:'failed',stage:'failed',progress:100,failure:{failure_class:'output'},runtime:{remote_wrf_succeeded:true},error:'Traceback (most recent call last):\n  File "/private/remote/scripts/validate_outputs.py", line 67\nValueError: empty_output_schedule:d01\nAuthorization: Bearer fixture-bearer\npassword="fixture secret"\n'+ 'x'.repeat(13000)};document.body.append(viewer);});
 const viewer=page.locator('#run-error-fixture'),alert=viewer.getByRole('alert'),details=viewer.locator('.wrf-technical');
 await expect(alert).toHaveText('远端 WRF 计算已完成；输出校验失败，结果尚未通过完整性检查。');await expect(alert).not.toContainText('Traceback');await expect(alert).not.toContainText('/private');await expect(details).not.toHaveAttribute('open','');await expect(details.locator('pre')).not.toBeVisible();await details.locator('summary').click();await expect(details.locator('pre')).toContainText('empty_output_schedule:d01');await expect(details.locator('pre')).not.toContainText('fixture-bearer');await expect(details.locator('pre')).not.toContainText('fixture secret');await expect(details.locator('pre')).toContainText('技术详情已截断');expect((await details.locator('pre').textContent()).length).toBeLessThan(12100);
 await page.evaluate(()=>{document.querySelector('#run-error-fixture').task={id:'fixture-unknown',status:'failed',stage:'failed',progress:100,runtime:{current_stage:'done',model_progress:100},error:'Traceback\n/private/remote/unknown.py: unexpected failure',failure:{failure_class:'model'}};});await expect(alert).toHaveText('任务出现错误，具体原因尚未确认。');await expect(alert).not.toContainText('计算已完成');
 await page.evaluate(()=>{document.querySelector('#run-error-fixture').task={id:'fixture-config',status:'waiting_restart',stage:'failed',error:'remote exit 1',failure:{failure_class:'model',evidence:"FIO-F-228 namelist read: end of file reached without finding group '/private/namelist.wps'"}};});await expect(alert).toHaveText('运行配置文件读取失败，请核查生成的 namelist。');await expect(alert).not.toContainText('/private');
});

test('shared presentation switches host themes and all display projections without mutating the product',async({page},info)=>{
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();if(u.pathname.startsWith('/api/'))throw new Error('Presentation must never call the task API');return route.continue();});
 await page.goto('/tests/browser/wrf-presentation.html');const viewer=page.locator('wrf-result-viewer'),canvas=viewer.locator('.proj-canvas'),projection=page.getByRole('combobox',{name:'地图显示投影',exact:true});
 await expect(projection).toHaveValue('等经纬');await expect(canvas).toHaveAttribute('data-data-ready','true');await expect(viewer.locator('.wrf-legend')).toContainText('18.6');await expect(viewer.locator('.wrf-legend')).toContainText('27.5 °C');
 const original=await viewer.evaluate(el=>JSON.stringify(el.product));
 await page.getByRole('combobox',{name:'单位',exact:true}).selectOption({label:'原始单位'});await expect(viewer.locator('.wrf-legend')).toContainText('291.7');await expect(viewer.locator('.wrf-legend')).toContainText('300.7 K');await page.getByRole('combobox',{name:'单位',exact:true}).selectOption({label:'常用单位'});
 const light=await viewer.locator('.wrf-ui').evaluate(el=>getComputedStyle(el).backgroundColor);
 await page.evaluate(()=>document.documentElement.classList.add('dark'));await expect(viewer).toHaveAttribute('data-theme','dark');expect(await viewer.locator('.wrf-ui').evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(light);await expect(canvas).toHaveAttribute('data-data-ready','true');await page.screenshot({path:info.outputPath('dark-equirectangular.png')});
 for(const p of ['墨卡托','正弦','罗宾逊','兰博托','卫星正视','北极','南极','等经纬']){await projection.selectOption(p);await expect(canvas).toHaveAttribute('data-display-projection',p);await expect(canvas).toHaveAttribute('data-data-ready','true');}
 await page.getByRole('button',{name:'下一帧',exact:true}).click();await expect(viewer).toContainText('2026-10-09T01:00:00Z');await page.evaluate(()=>document.documentElement.classList.remove('dark'));await expect(viewer).toHaveAttribute('data-theme','light');await expect(viewer).toContainText('2026-10-09T01:00:00Z');await page.screenshot({path:info.outputPath('light-equirectangular.png')});expect(await viewer.evaluate(el=>JSON.stringify(el.product))).toBe(original);
});

test('host theme changes panels without recoloring framework base-map tiles',async({page})=>{
 let tileRequests=0;
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='tile.openstreetmap.org'){tileRequests++;return route.fulfill({contentType:'image/svg+xml',headers:{'Access-Control-Allow-Origin':'*'},body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="rgb(112,180,92)"/></svg>'});}if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();return route.continue();});
 await page.goto('/tests/browser/wrf-presentation.html');
 const viewer=page.locator('wrf-result-viewer'),canvas=viewer.locator('.proj-canvas');await expect(canvas).toHaveAttribute('data-data-ready','true');
 const bounds=await canvas.boundingBox();const clip={x:Math.floor(bounds.x+83),y:Math.floor(bounds.y+173),width:1,height:1};
 const pixel=async()=>JSON.parse(execFileSync(python,['-B','-c','import sys,io,json; from PIL import Image; print(json.dumps(Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB").getpixel((0,0))))'],{input:await page.screenshot({clip})}).toString());
 await expect.poll(()=>pixel()).toEqual([112,180,92]);expect(tileRequests).toBeGreaterThan(0);
 await page.evaluate(()=>document.documentElement.classList.add('dark'));await expect(viewer).toHaveAttribute('data-theme','dark');await expect.poll(()=>pixel()).toEqual([112,180,92]);
 await page.evaluate(()=>document.documentElement.classList.remove('dark'));await expect(viewer).toHaveAttribute('data-theme','light');await expect.poll(()=>pixel()).toEqual([112,180,92]);
});

test('workbench keeps the submit control reachable across required container and window sizes', async ({page}) => {
 await page.addInitScript(()=>{localStorage.setItem('token','fixture-not-a-real-token');localStorage.setItem('user',JSON.stringify({uuid:'viewport-user',username:'fixture',role:2}));});
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(url.pathname==='/api/wrf/forcing/refresh'&&route.request().method()==='GET')return reply({status:'idle'});if(url.pathname==='/api/wrf/forcing/downloads')return reply({items:[]});if(url.pathname==='/api/wrf/forcing/policy')return reply({version:0,enabled:false,auto_cleanup:false,held_cycles:{gfs:[],ecmwf:[]}});if(url.pathname==='/api/wrf/options')return reply(options);if(url.pathname==='/api/health')return reply({status:'online',hpc:{status:'ready',message:'fixture'}});if((url.pathname==='/api/wrf/tasks'||url.pathname==='/api/wrf/workbench/tasks'))return reply({items:[],total:0,next_cursor:null});if(url.pathname==='/api/wrf/data-status')return reply({status:'ready',pool_items:[]});if(url.pathname.startsWith('/api/'))throw new Error('Unexpected API '+url.pathname);return route.continue();});
 for(const [width,height] of [[1920,1080],[1366,768],[1280,720],[1024,768],[768,1024],[390,844],[360,640]]){
  await page.setViewportSize({width,height});await page.goto('/wrf');
  const submit=page.getByRole('button',{name:'开始模拟',exact:true});await expect(submit).toBeVisible();
  const box=await submit.boundingBox();expect(box).not.toBeNull();expect(box.y+box.height).toBeLessThanOrEqual(height);expect(box.x+box.width).toBeLessThanOrEqual(width);
  await expect(page.getByRole('status').filter({hasText:'请先创建计算域'})).toBeVisible();
  await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.right-sidebar')).toBeVisible();
  await expect(submit).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.right-sidebar')).not.toBeVisible();await expect(page.getByRole('button',{name:/^任务与资料/})).toBeFocused();
  if(width<=640){await page.getByRole('button',{name:'地图',exact:true}).click();await expect(page.locator('.wrf-map-column')).toBeVisible();await page.getByRole('button',{name:'参数',exact:true}).click();await expect(page.getByLabel('Spin-up（小时）',{exact:true})).toBeVisible();}
 }
});


test('loaded artifact, long task/resource panels and refresh preserve the real workbench controls',async({page})=>{
 test.setTimeout(120000);
 const release=JSON.parse(readFileSync(resolve('wrf-ui.lock.json'),'utf8'));
 await page.addInitScript(()=>{localStorage.setItem('token','fixture-not-a-real-token');localStorage.setItem('user',JSON.stringify({uuid:'management-viewport',username:'fixture',role:3}));});
 const tasks=Array.from({length:15},(_,i)=>({id:'fixture-history-'+i,status:'waiting_restart',stage:'failed',attempt_no:1,request:{data_source:'gfs',start_time:'2026-10-07T03:00:00Z',domains:[]}}));
 const unexpected=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),path=u.pathname;const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});
 if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();
 if(u.port==='8012'){unexpected.push('agent');return route.abort();}
 if(path==='/api/wrf/forcing/refresh'&&r.method()==='GET')return reply({status:'idle'});if(path==='/api/wrf/options')return reply(options);
 if(path==='/api/health')return reply({status:'online',hpc:{status:'ready',message:'环境可用'}});
 if((path==='/api/wrf/tasks'||path==='/api/wrf/workbench/tasks')&&r.method()==='GET')return reply({items:tasks,total:15});
 if(path.endsWith('/logs'))return reply({text:'',offset:0});
 if(path.startsWith('/api/wrf/tasks/fixture-history-')&&r.method()==='GET')return reply(tasks.find(t=>path.endsWith(t.id)));
 if(path.endsWith('/delete'))return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({detail:'Traceback FileNotFoundError /mnt/private/exit.code'})});
 if(path==='/api/wrf/forcing/policy')return reply({version:1,enabled:true,auto_cleanup:true,held_cycles:{gfs:[],ecmwf:[]}});
 if(path==='/api/wrf/forcing/downloads')return reply({items:[]});
 if(path==='/api/wrf/data-status')return reply({status:'partial',storage_free_gb:500,pool_items:[{provider:'gfs',label:'GFS',cycles:[{cycle:'2026100700',completed_files:42,total_files:73,size_bytes:1e9,status:'partial',task_reference_count:2,task_required:true,available_hours:Array.from({length:42},(_,i)=>i)}]}]});
 if(path==='/api/wrf/planning/assess')return reply({data_window:{source:'gfs',cycle:'2026100700',required_hours:[3,6],status:'ready'}});
 if(path==='/api/wrf/domains/preview')return reply(backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',r.postDataJSON()));
 if(path.startsWith('/api/')){unexpected.push(path);return route.abort();}return route.continue();});
 for(const theme of ['dark','light'])for(const [width,height] of [[1920,1080],[1366,768],[1280,720],[1024,768],[768,1024],[390,844],[360,640]]){
  await page.setViewportSize({width,height});await page.goto('/wrf');await page.evaluate(t=>{document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.classList.toggle('light',t==='light');},theme);
  const editor=page.locator('wrf-config-editor');await expect(editor).toHaveAttribute('data-wrf-version',release.version);await expect(editor).toHaveAttribute('data-wrf-source',release.source_sha256);
  const create=page.getByRole('button',{name:'按坐标创建 D01',exact:true});if(await create.count())await create.click();
  const submit=page.getByRole('button',{name:'开始模拟',exact:true});await expect(submit).toBeEnabled();const box=await submit.boundingBox(),workspace=await page.locator('.center-workspace').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(workspace.y+workspace.height);expect(box.y+box.height).toBeLessThanOrEqual(height);await submit.click({trial:true});
  await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.history-card .task-items article')).toHaveCount(15);
  await expect(page.locator('.data-pool')).toContainText('42/73');await page.getByRole('button',{name:/^任务与资料/}).click();await submit.click({trial:true});
  await page.getByLabel('垂直层数',{exact:true}).fill('60');await page.evaluate(()=>window.dispatchEvent(new Event('weather-auth-changed')));await expect(page.getByLabel('垂直层数',{exact:true})).toHaveValue('60');await page.getByLabel('truelat1',{exact:true}).fill('30');await page.getByLabel('truelat2',{exact:true}).fill('30');await page.getByLabel('stand_lon',{exact:true}).fill('116');await expect(submit).toBeEnabled();await page.reload();await expect(page.getByLabel('truelat1',{exact:true})).toHaveValue('30');await expect(page.getByLabel('stand_lon',{exact:true})).toHaveValue('116');await expect(page.getByLabel('垂直层数',{exact:true})).toHaveValue('60');await expect(submit).toBeEnabled();
 }
 await page.getByRole('button',{name:/^任务与资料/}).click();await page.locator('.history-card article').first().getByRole('button',{name:'删除任务'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.history-card')).toContainText('删除未完成：操作未完成，详细诊断已保留，请重新核验任务状态。');await page.getByRole('button',{name:'配置模拟',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);expect(unexpected).toEqual([]);
});

test('an old registered custom element blocks submission and requests a refresh',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture-not-a-real-token');localStorage.setItem('user',JSON.stringify({uuid:'old-version',role:3}));class OldEditor extends HTMLElement{};OldEditor.wrfVersion='2.1.1';OldEditor.wrfSource='old-source';customElements.define('wrf-config-editor',OldEditor);});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data:path.endsWith('/options')?options:path.endsWith('/health')?{status:'online',hpc:{status:'ready'}}:{items:[]}})});});
 await page.route('**/__fixture__/options',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(options)}));
 await page.goto('/tests/browser/wrf-shared.html');await expect(page.getByRole('alert')).toHaveText('WRF组件版本已更新，请保存配置并刷新页面后继续。');await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toHaveCount(0);
});

test('late manual plan cannot replace another task or leak its errors',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'late-owner',username:'fixture',role:3}));});
 const tasks=['a','b'].map(id=>({id:'fixture-'+id,status:'failed',stage:'failed',attempt_no:1,request:{data_source:'gfs',domains:[]},runtime:{remote_wrf_succeeded:true},operations:[{action:'retry_outputs',enabled:true}]}));let release,started=false;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(p==='/api/wrf/forcing/refresh'&&r.method()==='GET')return reply({status:'idle'});if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/workbench/tasks')return reply({items:tasks});if(p.endsWith('/logs'))return reply({text:'',offset:0});if(p.endsWith('/recovery-plans')){const id=p.split('/')[4];if(id==='fixture-a'){started=true;await gate;}return reply({id:'plan-'+id,task_id:id,action:'retry_outputs',purpose:'manual',status:'pending',expires_at:Date.now()/1000+600,impact:id==='fixture-a'?'STALE PLAN':'CURRENT PLAN'});}if(p.startsWith('/api/wrf/tasks/'))return reply(tasks.find(t=>p.endsWith(t.id)));if(p==='/api/wrf/data-status')return reply({pool_items:[]});if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf?view=run&task_id=fixture-a');await page.getByRole('button',{name:'重新生成结果',exact:true}).click();await expect.poll(()=>started).toBe(true);await page.getByRole('dialog').getByLabel('Close this dialog').click();await page.getByRole('button',{name:/^任务与资料/}).click();await page.locator('.history-card article[title="fixture-b"]').click();await expect(page.getByRole('heading',{name:'fixture-b',exact:true})).toBeVisible();release();await page.getByRole('button',{name:'重新生成结果',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('CURRENT PLAN');await expect(page.getByText('STALE PLAN',{exact:true})).toHaveCount(0);
});
for(const lostResponse of [false,true,'unknown'])test(`edited restart runs once without a dialog and history selects attempt logs lost=${lostResponse}`,async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture-not-a-real-token');localStorage.setItem('user',JSON.stringify({uuid:'fixture-user',username:'fixture',role:2}));});
 const task={id:'manual-fixture',status:'cancelled',stage:'cancelled',attempt_no:2,request:backendCall('import json; from test_guidance_recovery import request; print(json.dumps(request()))'),operations:[{action:'restart',enabled:true}],attempts:[{attempt_no:1,status:'failed',request:{vertical_levels:60}},{attempt_no:2,status:'cancelled',request:{vertical_levels:88}}]},plans=[],executions=[],logQueries=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});
 if(p==='/api/wrf/tasks/validate')return reply({request:r.postDataJSON(),warnings:[]});if(p==='/api/wrf/forcing/refresh'&&r.method()==='GET')return reply({status:'idle'});if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/forcing/downloads')return reply({items:[]});if(p==='/api/wrf/forcing/policy')return reply({version:0,enabled:false,held_cycles:{gfs:[],ecmwf:[]}});
 if((p==='/api/wrf/tasks'||p==='/api/wrf/workbench/tasks')&&r.method()==='GET')return reply({items:[task]});if(p==='/api/wrf/tasks/manual-fixture')return reply(task);
 if(p.endsWith('/logs')){logQueries.push(u.search);return reply({text:'history log',offset:11});}
 if(p.endsWith('/recovery-plans')&&r.method()==='POST'){plans.push(r.postDataJSON());return reply({id:'manual-plan',task_id:task.id,action:'restart',purpose:'manual',status:'pending',expires_at:Date.now()/1000+600,impact:'原参数重跑，旧尝试留档'});}
 if(p.includes('/recovery-plans/manual-plan/execute')){executions.push(p);task.attempt_no=3;task.status='queued';return lostResponse?route.abort():reply({status:'accepted'});}
 if(p.endsWith('/recovery-plans/manual-plan')&&r.method()==='GET')return reply({status:lostResponse==='unknown'?'unknown':'accepted'});
 if(p==='/api/wrf/domains/preview')return reply(backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',r.postDataJSON()));if(p==='/api/wrf/data-status')return reply({status:'ready',pool_items:[]});if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf?view=run&task_id=manual-fixture');await page.getByRole('button',{name:/^第 1 次 ·/}).click();await expect.poll(()=>logQueries.some(q=>q.includes('attempt_no=1'))).toBe(true);
 await page.getByRole('button',{name:'返回修改参数',exact:true}).click();await expect(page.getByLabel('垂直层数',{exact:true})).toBeVisible();await page.getByRole('button',{name:'修改后重跑',exact:true}).click();await expect.poll(()=>executions.length).toBe(1);await expect(page.getByRole('dialog')).toHaveCount(0);if(lostResponse){await expect(page.getByRole('alert')).toContainText('已保留原重跑编号');await page.reload();await page.getByRole('button',{name:'修改后重跑',exact:true}).click();}expect(executions).toHaveLength(1);expect(plans).toHaveLength(1);expect(plans[0]).toMatchObject({purpose:'manual',action:'restart',event_id:null});if(lostResponse==='unknown'){await expect(page.getByRole('alert')).toContainText('上次重跑结果尚未确认');return;}await expect(page).toHaveURL(/task_id=manual-fixture/);
});

for(const [action,label] of [['retry_outputs','重新生成结果'],['render_partial','部分渲染'],['resume','恢复连接并核验状态']])test(`manual ${action} uses the existing plan and never creates a simulation`,async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture-not-a-real-token');localStorage.setItem('user',JSON.stringify({uuid:'fixture-user',username:'fixture',role:2}));});
 const task={id:'operation-fixture',status:'failed',stage:'failed',attempt_no:1,request:{data_source:'gfs',domains:[]},runtime:{remote_wrf_succeeded:action==='retry_outputs'},operations:[{action,enabled:true}]},calls=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(p==='/api/wrf/forcing/refresh'&&r.method()==='GET')return reply({status:'idle'});if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/forcing/downloads')return reply({items:[]});if(p==='/api/wrf/forcing/policy')return reply({version:0,enabled:false,held_cycles:{gfs:[],ecmwf:[]}});if((p==='/api/wrf/tasks'||p==='/api/wrf/workbench/tasks')&&r.method()==='GET')return reply({items:[task]});if(p==='/api/wrf/tasks/operation-fixture')return reply(task);if(p.endsWith('/logs'))return reply({text:'',offset:0});if(p.endsWith('/recovery-plans')){calls.push(r.postDataJSON());return reply({id:'operation-plan',task_id:task.id,action,purpose:'manual',status:'pending',expires_at:Date.now()/1000+600,impact:'不重新计算 WRF'});}if(p.endsWith('/operation-plan/execute')){calls.push('execute');return reply({status:'accepted'});}if(p==='/api/wrf/data-status')return reply({status:'ready',pool_items:[]});if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf?view=run&task_id=operation-fixture');if(action!=='retry_outputs'){await expect(page.getByRole('button',{name:label,exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'返回修改参数',exact:true})).toBeVisible();expect(calls).toEqual([]);return;}await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByRole('dialog')).toContainText('不重新计算 WRF');expect(calls).toEqual([{event_id:null,action,purpose:'manual'}]);await page.getByRole('button',{name:'确认重试结果处理',exact:true}).click();await expect.poll(()=>calls.length).toBe(2);expect(calls[1]).toBe('execute');
});

test('restored publication uses the original service and archived history remains visible without metadata writes',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'management-owner',username:'fixture',role:3}));});
 const task={id:'publication-fixture',status:'succeeded',stage:'done',attempt_no:1,metadata:{version:0,archived:true},request:{data_source:'gfs',domains:[]},operations:[{action:'publish',enabled:true}]},writes=[],queries=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});
 if(p==='/api/wrf/forcing/refresh'&&r.method()==='GET')return reply({status:'idle'});if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/data-status')return reply({pool_items:[]});
 if(p==='/api/wrf/workbench/tasks'){queries.push(u.search);return reply({items:[task]});}
 if(p==='/api/wrf/tasks/'+task.id)return reply(task);if(p.endsWith('/logs'))return reply({text:'',offset:0});
 if(p.endsWith('/publish')){writes.push({action:'publish'});return reply(task);}
 if(p.endsWith('/metadata')){writes.push(r.postDataJSON());Object.assign(task.metadata,r.postDataJSON(),{version:task.metadata.version+1});return reply(task.metadata);}
 if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf?view=run&task_id=publication-fixture');await page.getByRole('button',{name:'重试发布',exact:true}).click();await expect(page.getByRole('dialog',{name:'重试发布'}).last()).toContainText('不重新下载、渲染或计算');await page.getByRole('button',{name:'确认重试发布',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);
 await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.history-card article')).toHaveCount(1);await expect(page.getByLabel('已归档',{exact:true})).toHaveCount(0);expect(queries.some(q=>q.includes('include_archived=true'))).toBe(true);expect(writes).toEqual([{action:'publish'}]);
});

test('restored cancel requires confirmation and retains cancel-pending until backend proves exit',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'cancel-owner',username:'fixture',role:2}));});
 const task={id:'cancel-fixture',status:'running',stage:'running',attempt_no:1,request:{data_source:'gfs',domains:[]},operations:[{action:'cancel',enabled:true}]},writes=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});
 if(p==='/api/wrf/forcing/refresh'&&r.method()==='GET')return reply({status:'idle'});if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/data-status')return reply({pool_items:[]});if(p==='/api/wrf/workbench/tasks')return reply({items:[task]});if(p==='/api/wrf/tasks/'+task.id)return reply(task);if(p.endsWith('/logs'))return reply({text:'',offset:0});if(p.endsWith('/cancel')){writes.push(p);task.status='cancel_pending';task.stage='cancel_pending';return reply(task);}if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf?view=run&task_id=cancel-fixture');await page.getByRole('button',{name:'取消任务',exact:true}).click();await page.getByRole('button',{name:'暂不取消',exact:true}).click();expect(writes).toEqual([]);await page.getByRole('button',{name:'取消任务',exact:true}).click();await page.getByRole('button',{name:'确认取消',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);await expect(page.locator('.run-head .status')).toHaveText('取消中');expect(task.status).toBe('cancel_pending');
});


test('slow forcing never blocks paginated archived history or asynchronous deletion',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'async-owner',username:'fixture',role:3}));});
 let releasePool;const poolGate=new Promise(resolve=>releasePool=resolve);let removed=false,executed=false,checks=0;const requests=[];
 const task={id:'delete-fixture',status:'failed',stage:'failed',attempt_no:1,metadata:{archived:true},request:{data_source:'gfs',domains:[]}};
 const plan={id:'delete-plan',task_id:task.id,created_at:Date.now()/1000,expires_at:Date.now()/1000+600,status:'checking',phase:'checking_state'};
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({code:0,data})});if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
 if(p==='/api/wrf/forcing/refresh'&&r.method()==='GET')return reply({status:'idle'});if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});
 if(p==='/api/wrf/workbench/tasks'){requests.push(u.search);return reply({items:removed?[]:[{...task,id:u.searchParams.has('cursor')?'second-task':task.id}],next_cursor:u.searchParams.has('cursor')?null:'next-page'});}
 if(p==='/api/wrf/data-status'){await poolGate;return reply({pool_items:[]});}
 if(p.endsWith('/delete')&&r.method()==='POST'){requests.push('delete');executed=true;return reply({...plan,delete_now:true},202);}
 
 if(p.endsWith('/delete-plan')){checks++;if(executed){removed=true;return reply({...plan,status:'complete',phase:'complete'});}return reply({...plan,status:'pending',phase:'preview',digest:'a'.repeat(64),summary:{files:1,bytes:10,published_assets:0,protected:['共享资料']},local:[],remote:[]});}
 if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf');await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.history-card article')).toHaveCount(1);
 expect(requests[0]).toContain('include_archived=true');await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.history-card article')).toHaveAttribute('title','second-task');await page.getByRole('button',{name:'上一页',exact:true}).click();await expect(page.locator('.history-card article')).toHaveAttribute('title',task.id);
 await page.locator('.history-card article').getByRole('button',{name:'删除任务',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.history-card article')).toHaveCount(0);expect(requests.filter(x=>x==='delete')).toHaveLength(1);expect(checks).toBeGreaterThan(0);releasePool();
});


test('refresh errors stay in the pool and never reopen verification dialogs',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'refresh-owner',username:'fixture',role:3}));});
 const writes=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
 if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/workbench/tasks')return reply({items:[]});if(p==='/api/wrf/data-status')return reply({pool_items:[]});
 if(p==='/api/wrf/forcing/refresh'){
  if(r.method()==='POST'){writes.push(p);return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'资料服务暂不可用'})});}
  return reply({status:'idle'});
 }
 if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf');await page.getByRole('button',{name:/^任务与资料/}).click();await page.locator('.data-pool').getByRole('button',{name:'刷新',exact:true}).click();await expect(page.locator('.data-pool')).toContainText('资料服务暂不可用');await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes).toHaveLength(1);
});

test('older service keeps pool inventory and blocks unsupported refresh and deletion',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'old-service-owner',username:'fixture',role:3}));});
 const writes=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
 if(r.method()!=='GET')writes.push(p);
 if(p==='/api/wrf/options')return reply({...options,workbench_management:{id:'wrf-workbench-management-1'}});
 if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});
 if(p==='/api/wrf/workbench/tasks')return reply({items:[{id:'old-task',status:'failed',request:{data_source:'gfs',domains:[]}}]});
 if(p==='/api/wrf/data-status')return reply({pool_items:[{provider:'gfs',label:'GFS',cycles:[{cycle:'2026101300',completed_files:2,total_files:73,size_bytes:100,status:'partial'}]}]});
 if(p==='/api/wrf/forcing/refresh')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({detail:'Not Found'})});
 if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf');await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.data-pool')).toContainText('2/73');await expect(page.locator('.data-pool')).toContainText('服务待更新');
 await page.locator('.data-pool').getByRole('button',{name:'刷新',exact:true}).click();await page.locator('.history-card article').getByRole('button',{name:'删除任务',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes).toEqual([]);
});

for(const requested of [true,false])test(`result reload resolves ${requested?'explicit task outside history page':'latest completed task across history pages'}`,async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'result-owner',username:'fixture',role:3}));});
 const task={id:'completed-result',status:'succeeded',request:{data_source:'ecmwf',domains:[]}},displayed=[];
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
 if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/data-status')return reply({pool_items:[]});if(p==='/api/wrf/forcing/refresh')return reply({status:'idle'});
 if(p==='/api/wrf/workbench/tasks'){await gate;return reply(u.searchParams.has('cursor')?{items:[task]}:{items:[{id:'failed-first-page',status:'failed',request:{domains:[]}}],next_cursor:'second-page'});}
 if(p==='/api/wrf/tasks/'+task.id){await gate;return reply(task);}
 if(p==='/api/wrf/display'){displayed.push(u.searchParams.get('task_id'));return reply({task_id:task.id,meta_json:{domains:[]}});}
 if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 const url='/wrf?view=result'+(requested?'&task_id='+task.id:'');await page.goto(url);await expect(page.getByText('正在加载可视化结果…',{exact:true})).toBeVisible();await expect(page.getByText('暂无 WRF 可视化结果',{exact:true})).toHaveCount(0);release();
 await expect(page.locator('.workspace-head small')).toHaveText(task.id);await expect(page.locator('.result-toolbar')).toContainText('ECMWF');await expect.poll(()=>displayed.length).toBeGreaterThan(0);
 await page.reload();await expect(page.locator('.workspace-head small')).toHaveText(task.id);expect(displayed.every(id=>id===task.id)).toBe(true);
 await page.getByRole('button',{name:/^任务与资料/}).click();await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.workspace-head small')).toHaveText(task.id);
});

test('unavailable requested result never substitutes a different successful task',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'result-error-owner',username:'fixture',role:3}));});
 let displays=0;
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
 if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/data-status')return reply({pool_items:[]});if(p==='/api/wrf/forcing/refresh')return reply({status:'idle'});if(p==='/api/wrf/workbench/tasks')return reply({items:[{id:'other-task',status:'succeeded',request:{domains:[]}}]});
 if(p==='/api/wrf/tasks/missing-result')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({detail:'任务不存在或无权访问'})});
 if(p==='/api/wrf/display'){displays++;return reply({});}if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf?view=result&task_id=missing-result');await expect(page.getByRole('alert')).toContainText('任务不存在或无权访问');expect(displays).toBe(0);await expect(page.locator('.workspace-head small')).not.toHaveText('other-task');
});

test('deletion phase and elapsed time stay on task card and survive page reload',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'deletion-status-owner',username:'fixture',role:3}));});
 let writes=0,complete=false;
 const task={id:'deletion-progress-task',status:'failed',request:{domains:[]}},operation={id:'progress-plan',task_id:task.id,status:'checking',phase:'inventory_assets',elapsed_seconds:12,delete_now:true};
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({code:0,data})});if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
 if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/data-status')return reply({pool_items:[]});if(p==='/api/wrf/forcing/refresh')return reply({status:'idle'});if(p==='/api/wrf/workbench/tasks')return reply({items:[task]});
 if(p.endsWith('/delete')){writes++;return reply(operation,202);}if(p.endsWith('/progress-plan'))return reply(complete?{...operation,status:'complete',phase:'complete'}:operation);
 if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf');await page.getByRole('button',{name:/^任务与资料/}).click();await page.locator('.history-card article').getByRole('button',{name:'删除任务',exact:true}).click();await expect(page.locator('.history-card article').getByRole('status')).toContainText('正在核对目录 · 执行 12 秒');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.reload();await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.history-card article').getByRole('status')).toContainText('正在核对目录 · 执行 12 秒');expect(writes).toBe(1);complete=true;await expect(page.locator('.history-card article')).toHaveCount(0);expect(writes).toBe(1);
});

test('task and forcing cards show queue position with separate wait and execution clocks',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'fifo-owner',username:'fixture',role:3}));});
 const tasks=['first','second'].map(id=>({id,status:'failed',request:{domains:[]}}));let phase='queued',taskWrites=0,cycleWrites=0;
 const cycle={provider:'gfs',label:'GFS',cycles:[{cycle:'2026100100',status:'partial',cleanup_allowed:true,completed_files:2,total_files:73,size_bytes:100}]};
 const plan=id=>({id:'delete-'+id,task_id:id,delete_now:true,status:'checking',phase:id==='first'?'inventory_assets':phase,queue_position:id==='first'?0:1,elapsed_seconds:100,wait_seconds:id==='first'?0:80,execution_seconds:id==='first'?12:0});
 const cyclePlan={id:'cycle-operation',source:'gfs',cycle:'2026100100',status:'checking',phase:'queued',queue_position:2,wait_seconds:9,execution_seconds:0,elapsed_seconds:9};
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({code:0,data})});if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
 if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/data-status')return reply({pool_items:[cycle]});if(p==='/api/wrf/forcing/refresh')return reply({status:'idle'});if(p==='/api/wrf/workbench/tasks')return reply({items:tasks});
 if(p==='/api/wrf/forcing/gfs/cycles/2026100100/delete'){cycleWrites++;return reply(cyclePlan,202);}
 if(p==='/api/wrf/forcing/cleanup-plans/cycle-operation')return reply(cyclePlan);
 if(p.endsWith('/delete')){taskWrites++;return reply(plan(p.includes('/first/')?'first':'second'),202);}
 if(p.endsWith('/delete-first'))return reply(plan('first'));
 if(p.endsWith('/delete-second'))return reply(plan('second'));
 if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf');await page.getByRole('button',{name:/^任务与资料/}).click();
 await page.locator('.history-card article[title="first"]').getByRole('button',{name:'删除任务',exact:true}).click();await page.locator('.history-card article[title="second"]').getByRole('button',{name:'删除任务',exact:true}).click();
 await expect(page.locator('.history-card article[title="first"]')).toContainText('执行 12 秒');await expect(page.locator('.history-card article[title="second"]')).toContainText('排队删除 · 前方 1 个任务 · 等待 80 秒');
 await expect(page.locator('.pool-provider')).toContainText('待清理');await expect(page.locator('.pool-provider')).not.toContainText('待补齐');await page.getByRole('button',{name:'删除资料周期',exact:true}).click();await expect(page.locator('.cycle-delete-status')).toContainText('排队删除 · 前方 2 个任务 · 等待 9 秒');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.reload();await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.cycle-delete-status')).toContainText('前方 2 个任务');await expect(page.locator('.history-card article[title="second"]')).toContainText('等待 80 秒');expect(taskWrites).toBe(2);expect(cycleWrites).toBe(1);
 phase='inventory_assets';await expect(page.locator('.history-card article[title="second"]')).toContainText('正在核对目录 · 执行 0 秒');expect(taskWrites).toBe(2);
 cyclePlan.status='unknown';cyclePlan.phase='deleting';await expect(page.locator('.cycle-delete-status')).toContainText('删除状态待确认，未重复执行');expect(cycleWrites).toBe(1);
});

test('quarantined task and cycle disappear while space cleanup survives reload without new writes',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'quarantine-owner',username:'fixture',role:3}));});
 let writes=0,removed=false,complete=false;
 const task={id:'quarantine-task',status:'failed',request:{domains:[]}};
 const state=()=>({status:complete?'complete':'executing',phase:removed?'space_cleanup':'quarantining',removed,cleanup_status:complete?'complete':'pending',elapsed_seconds:2,execution_seconds:2});
 const taskPlan=()=>({id:'quarantine-plan',task_id:task.id,delete_now:true,...state()});
 const cyclePlan=()=>({id:'quarantine-cycle',source:'gfs',cycle:'2026100100',...state()});
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const r=route.request(),u=new URL(r.url()),p=u.pathname;const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({code:0,data})});if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
 if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});if(p==='/api/wrf/data-status')return reply({pool_items:[{provider:'gfs',label:'GFS',cycles:[{cycle:'2026100100',status:'partial',cleanup_allowed:true,completed_files:2,total_files:73,size_bytes:100}]}]});if(p==='/api/wrf/forcing/refresh')return reply({status:'idle'});if(p==='/api/wrf/workbench/tasks')return reply({items:[task]});
 if(p==='/api/wrf/forcing/gfs/cycles/2026100100/delete'){writes++;return reply(cyclePlan(),202);}
 if(p==='/api/wrf/forcing/cleanup-plans/quarantine-cycle')return reply(cyclePlan());
 if(p.endsWith('/delete')){writes++;return reply(taskPlan(),202);}if(p.endsWith('/quarantine-plan'))return reply(taskPlan());
 if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf');await page.getByRole('button',{name:/^任务与资料/}).click();
 await page.locator('.history-card article').getByRole('button',{name:'删除任务',exact:true}).click();await page.getByRole('button',{name:'删除资料周期',exact:true}).click();
 removed=true;await expect(page.locator('.history-card article')).toHaveCount(0);await expect(page.getByRole('button',{name:'删除资料周期',exact:true})).toHaveCount(0);
 await expect(page.getByLabel('空间清理状态')).toContainText('已移除 · 空间清理中');expect(writes).toBe(2);
 await page.reload();await expect(page.getByLabel('空间清理状态')).toContainText('quarantine-task');await expect(page.getByLabel('空间清理状态')).toContainText('GFS 2026100100');expect(writes).toBe(2);
 complete=true;await expect(page.getByLabel('空间清理状态').getByRole('status')).toHaveText(['quarantine-task：已移除 · 空间清理完成','GFS 2026100100：已移除 · 空间清理完成']);expect(writes).toBe(2);
});


test('pool distinguishes publication wait queue transfer and ready with factual progress',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'pool-owner',username:'fixture',role:2}));});
 const cycles=[
 {cycle:'2026101400',status:'waiting_publish',completed_files:0,wait_reason:'上游完整周期尚未发布，等待 f072 发布确认',download_rate_bps:999999},
 {cycle:'2026101300',status:'queued',completed_files:2,partial_size_bytes:50000000,wait_reason:'等待本源下载完成：2026101400 · gfs.t00z.pgrb2.0p25.f003'},
 {cycle:'2026101200',status:'downloading',completed_files:4,partial_size_bytes:100000000,current_file:'gfs.f004',download_rate_bps:1673},
 {cycle:'2026101100',status:'ready',completed_files:73,complete:true}
 ].map(v=>({total_files:73,size_bytes:1000000000,...v}));
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const req=route.request(),u=new URL(req.url()),p=u.pathname;if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});
 if(req.method()!=='GET')throw new Error('Unexpected mutation '+p);
 if(p==='/api/wrf/options')return reply(options);
 if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});
 if(p==='/api/wrf/workbench/tasks')return reply({items:[]});
 if(p==='/api/wrf/forcing/refresh')return reply({status:'idle'});
 if(p==='/api/wrf/data-status')return reply({pool_items:[{provider:'gfs',label:'GFS',status:'downloading',cycles}]});
 if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf');await page.getByRole('button',{name:/^任务与资料/}).click();
 const cards=page.locator('.pool-provider article');await expect(cards).toHaveCount(4);
 const waiting=cards.filter({has:page.locator('.cycle-head .waiting_publish')});await expect(waiting).toContainText('等待发布');await expect(waiting).toContainText('上游完整周期尚未发布');await expect(waiting).toContainText('0/73');await expect(waiting).not.toContainText('下载中');await expect(waiting).not.toContainText('/s');
 const queued=cards.filter({has:page.locator('.cycle-head .queued')});await expect(queued).toContainText('排队');await expect(queued).toContainText('等待本源下载完成：2026101400');await expect(queued).toContainText('f003');await expect(queued).not.toContainText('共享传输槽');await expect(queued.locator('[role=progressbar]')).toHaveAttribute('aria-valuenow','3');
 const transfer=cards.filter({has:page.locator('.cycle-head .downloading')});await expect(transfer).toContainText('gfs.f004 下载中');await expect(transfer).toContainText('当前分片');await expect(transfer).toContainText('/s');await expect(transfer.locator('[role=progressbar]')).toHaveAttribute('aria-valuenow','5');
 const ready=cards.filter({has:page.locator('.cycle-head .ready')});await expect(ready).toContainText('已就绪');await expect(ready.locator('[role=progressbar]')).toHaveAttribute('aria-valuenow','100');
});

test('redraw D02 from inside D01 preserves the parent and sibling',async({page})=>{
 const requests=[],results=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;
  const r=route.request(),u=new URL(r.url());
  if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();
  if(u.pathname==='/__fixture__/options')return route.fulfill({json:options});
  if(u.pathname.endsWith('/domains/preview')){
   const body=r.postDataJSON();requests.push(body);
   try{const data=backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',body);results.push(data);return route.fulfill({json:{code:0,data}});}
   catch(e){return route.fulfill({status:422,json:{detail:String(e.stderr||e.message)}});}
  }
  if(u.pathname.startsWith('/api/'))throw new Error('Unexpected live API '+u.pathname);
  return route.continue();
 });
 await page.goto('/tests/browser/wrf-shared.html');
 await page.getByRole('button',{name:'按坐标创建 D01',exact:true}).click();
 await page.getByRole('button',{name:'为d01增加子域',exact:true}).click();
 await expect(page.locator('.wrf-domain-row')).toHaveCount(2);
 await page.getByRole('button',{name:'为d01增加子域',exact:true}).click();
 await expect(page.locator('.wrf-domain-row')).toHaveCount(3);
 await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();
 const before=structuredClone(results.at(-1));
 await page.locator('.wrf-domain-title').filter({hasText:/^D02 /}).click();
 await page.getByRole('button',{name:'重画选中域',exact:true}).click();
 const box=await page.locator('.wrf-domain-overlay path.editable').first().boundingBox();
 const count=requests.length;
 await page.mouse.move(box.x+box.width*.15,box.y+box.height*.2);await page.mouse.down();
 await page.mouse.move(box.x+box.width*.35,box.y+box.height*.4,{steps:5});await page.mouse.up();
 await expect.poll(()=>requests.length).toBeGreaterThan(count);
 expect(requests.at(-1).edit.domain_id).toBe('d02');
 await expect(page.getByRole('button',{name:'开始模拟',exact:true})).toBeEnabled();
 const after=results.at(-1);
 expect(after.center).toEqual(before.center);
 expect(after.domains[0]).toEqual(before.domains[0]);expect(after.domains[2]).toEqual(before.domains[2]);
 expect(after.boundaries[0]).toEqual(before.boundaries[0]);expect(after.boundaries[2]).toEqual(before.boundaries[2]);
 expect(after.domains[1]).not.toEqual(before.domains[1]);
 expect((after.domains[1].e_we-1)%after.domains[1].parent_grid_ratio).toBe(0);
});

test('four-domain redraw move resize and undo retain unrelated geometry',async({page})=>{
 test.setTimeout(120000);
 const initial=backendCall('import json; from test_ordinary_ui2 import tree_request; print(json.dumps(tree_request()))');
 await page.addInitScript(value=>{window.__wrfInitialRequest=value;},initial);
 const requests=[],results=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;
  const r=route.request(),u=new URL(r.url());
  if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();
  if(u.pathname==='/__fixture__/options')return route.fulfill({json:options});
  if(u.pathname.endsWith('/domains/preview')){
   const body=r.postDataJSON();requests.push(body);
   try{const data=backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',body);results.push(data);return route.fulfill({json:{code:0,data}});}
   catch(e){return route.fulfill({status:422,json:{detail:String(e.stderr||e.message)}});}
  }
  if(u.pathname.startsWith('/api/'))throw new Error('Unexpected live API '+u.pathname);
  return route.continue();
 });
 await page.goto('/tests/browser/wrf-shared.html');
 const submit=page.getByRole('button',{name:'开始模拟',exact:true});
 await expect(submit).toBeEnabled();await expect(page.locator('.wrf-domain-row')).toHaveCount(4);
 const drag=async(x,y,xx,yy)=>{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(xx,yy,{steps:5});await page.mouse.up();};
 for(const operation of ['draw','move','resize'])for(const index of operation==='draw'?[2,3]:[0,1,2,3]){
  const before=structuredClone(results.at(-1)),count=requests.length,id=`d0${index+1}`;
  await page.locator('.wrf-domain-title').filter({hasText:new RegExp(`^D0${index+1} `)}).click();
  await page.getByRole('button',{name:operation==='draw'?'重画选中域':'移动 / 缩放域',exact:true}).click();
  const box=await page.locator('.wrf-domain-overlay path.editable').nth(operation==='draw'?(index===3?1:0):index).boundingBox();
  if(operation==='draw')await drag(box.x+box.width*.15,box.y+box.height*.2,box.x+box.width*.35,box.y+box.height*.4);
  else if(operation==='move'){const x=box.x+box.width*(index===1?.8:.5),y=box.y+box.height*(index===0?.1:.5);await drag(x,y,x+10,y-10);}
  else {const corner=await page.locator('.wrf-domain-handle').nth(3).boundingBox();await drag(corner.x+corner.width/2,corner.y+corner.height/2,corner.x+corner.width/2+10,corner.y+corner.height/2-10);}
  await expect.poll(()=>requests.length).toBeGreaterThan(count);
  expect(requests.at(-1).edit).toMatchObject({operation,domain_id:id});
  await expect(submit).toBeEnabled();
  const after=results.at(-1),affected=new Set([index+1]);
  before.domains.forEach((d,n)=>{if(affected.has(d.parent_id))affected.add(n+1);});
  before.domains.forEach((d,n)=>{if(!affected.has(n+1)){expect(after.domains[n]).toEqual(d);expect(after.boundaries[n]).toEqual(before.boundaries[n]);}});
  if(index)expect(after.center).toEqual(before.center);
  const done=results.length;
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await expect.poll(()=>results.length).toBeGreaterThan(done);await expect(submit).toBeEnabled();
  const restored=results.at(-1);
  expect(restored.domains).toEqual(before.domains);expect(restored.center).toEqual(before.center);expect(restored.boundaries).toEqual(before.boundaries);
  if(operation!=='draw')await page.getByRole('button',{name:'移动 / 缩放域',exact:true}).click();
 }
 const beforeInvalid=structuredClone(results.at(-1));
 await page.locator('.wrf-domain-title').filter({hasText:/^D04 /}).click();
 await page.getByRole('button',{name:'重画选中域',exact:true}).click();
 const rootBox=await page.locator('.wrf-domain-overlay path.editable').first().boundingBox();
 await drag(rootBox.x+rootBox.width*.6,rootBox.y+rootBox.height*.6,rootBox.x+rootBox.width*.75,rootBox.y+rootBox.height*.75);
 await expect(page.getByRole('alert')).toContainText('父域');await expect(submit).toBeDisabled();
 expect(requests.at(-1).edit.domain_id).toBe('d04');expect(results.at(-1)).toEqual(beforeInvalid);
 const invalidCount=results.length;
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect.poll(()=>results.length).toBeGreaterThan(invalidCount);await expect(submit).toBeEnabled();
 expect(results.at(-1).domains).toEqual(beforeInvalid.domains);expect(results.at(-1).boundaries).toEqual(beforeInvalid.boundaries);

});

test('direct four-domain numeric edits synchronize boundaries and undo the complete tree',async({page})=>{
 test.setTimeout(120000);
 const initial=backendCall('import json; from test_ordinary_ui2 import tree_request; print(json.dumps(tree_request()))');
 await page.addInitScript(value=>{window.__wrfInitialRequest=value;},initial);
 const requests=[],results=[];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;
  const r=route.request(),u=new URL(r.url());
  if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();
  if(u.pathname==='/__fixture__/options')return route.fulfill({json:options});
  if(u.pathname.endsWith('/domains/preview')){
   const body=r.postDataJSON();requests.push(body);
   try{const data=backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',body);results.push(data);return route.fulfill({json:{code:0,data}});}
   catch(e){return route.fulfill({status:422,json:{detail:String(e.stderr||e.message)}});}
  }
  if(u.pathname.startsWith('/api/'))throw new Error('Unexpected live API '+u.pathname);
  return route.continue();
 });
 await page.goto('/tests/browser/wrf-shared.html');
 const submit=page.getByRole('button',{name:'开始模拟',exact:true});await expect(submit).toBeEnabled();
 for(let index=0;index<4;index++)for(const [label,value,field] of [
  ...(index?[['嵌套比例','5','parent_grid_ratio']]:[['网格距（m）','45000','dx']]),
  ['东西网格数',index?'76':'127','e_we'],['南北网格数',index?'76':'127','e_sn'],
  ...(index?[['父域起点 i','12','i_parent_start'],['父域起点 j','12','j_parent_start']]:[])
 ]){
  await page.locator('.wrf-domain-title').filter({hasText:new RegExp(`^D0${index+1} `)}).click();
  const before=structuredClone(results.at(-1)),count=results.length;
  const beforePaths=await page.locator('.wrf-domain-overlay path.editable').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')));
  const input=page.getByLabel(label==='嵌套比例'?/^嵌套比例/:label,{exact:label!=='嵌套比例'});
  if(label==='嵌套比例')await input.selectOption(value);else await input.fill(value);
  await expect.poll(()=>results.length).toBeGreaterThan(count);await expect(submit).toBeEnabled();
  const after=results.at(-1);
  expect(after.domains[index][field]).toBe(Number(value));
  expect(after.boundaries[index].polygon).not.toEqual(before.boundaries[index].polygon);
  const affected=new Set([index+1]);before.domains.forEach((d,n)=>{if(affected.has(d.parent_id))affected.add(n+1);});
  before.domains.forEach((d,n)=>{if(!affected.has(n+1)){expect(after.domains[n]).toEqual(d);expect(after.boundaries[n]).toEqual(before.boundaries[n]);}});
  for(const d of after.domains.filter(d=>d.parent_id)){
   const parent=after.domains[d.parent_id-1];expect(d.dx*d.parent_grid_ratio).toBe(parent.dx);
   expect((d.e_we-1)%d.parent_grid_ratio).toBe(0);expect((d.e_sn-1)%d.parent_grid_ratio).toBe(0);
  }
  // SVG paths must have updated, not merely the numeric preview response.
  const paths=await page.locator('.wrf-domain-overlay path.editable').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')));
  expect(paths).toHaveLength(4);expect(paths[index]).not.toBe(beforePaths[index]);
  const done=results.length;await page.getByRole('button',{name:'撤销',exact:true}).click();
  await expect.poll(()=>results.length).toBeGreaterThan(done);await expect(submit).toBeEnabled();
  expect(results.at(-1).domains).toEqual(before.domains);expect(results.at(-1).center).toEqual(before.center);expect(results.at(-1).boundaries).toEqual(before.boundaries);
  const restoredPaths=await page.locator('.wrf-domain-overlay path.editable').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')));
  const pixels=path=>path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  // The notice and selected-domain controls resize the map; compare its
  // geographic path arrangement independently of that affine viewport fit.
  const frame=path=>{const a=pixels(path),x=a.filter((_,k)=>k%2===0),y=a.filter((_,k)=>k%2===1);return [Math.min(...x),Math.min(...y),Math.max(...x)-Math.min(...x),Math.max(...y)-Math.min(...y)];};
  const priorFrame=frame(beforePaths[0]),restoredFrame=frame(restoredPaths[0]);
  restoredPaths.forEach((path,n)=>{const prior=pixels(beforePaths[n]),actual=pixels(path);expect(actual.length).toBe(prior.length);expect(Math.max(...actual.map((v,k)=>Math.abs((v-restoredFrame[k%2])/restoredFrame[k%2+2]-(prior[k]-priorFrame[k%2])/priorFrame[k%2+2]))),`D0${index+1} ${field} undo D0${n+1}`).toBeLessThan(1e-6);});
 }
 const beforeInvalid=structuredClone(results.at(-1));
 await page.locator('.wrf-domain-title').filter({hasText:/^D04 /}).click();
 for(const [label,value]of [['东西网格数','62'],['父域起点 i','499']]){
  await page.getByLabel(label==='嵌套比例'?/^嵌套比例/:label,{exact:label!=='嵌套比例'}).fill(value);await expect(submit).toBeDisabled();await expect(page.getByRole('alert').first()).toBeVisible();
  const count=results.length;await page.getByRole('button',{name:'撤销',exact:true}).click();
  if(value==='62')await expect.poll(()=>results.length).toBeGreaterThan(count);
  await expect(submit).toBeEnabled();expect(results.at(-1).domains).toEqual(beforeInvalid.domains);await expect(page.getByLabel(label,{exact:true})).toHaveValue(value==='62'?'61':'11');
 }
});

test('history highlight follows displayed result instead of previously selected run',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'selection-owner',username:'fixture',role:3}));});
 const tasks=[{id:'task-00',status:'succeeded',request:{data_source:'gfs',start_time:'2026-10-13T00:00:00Z',domains:[]}},{id:'task-12',status:'succeeded',request:{data_source:'gfs',start_time:'2026-10-13T12:00:00Z',domains:[]}}];
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;
  const r=route.request(),u=new URL(r.url()),p=u.pathname,reply=data=>route.fulfill({json:{code:0,data}});
  if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
  if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});
  if(p==='/api/wrf/data-status')return reply({pool_items:[]});if(p==='/api/wrf/forcing/refresh')return reply({status:'idle'});
  if(p==='/api/wrf/workbench/tasks')return reply({items:tasks,total:2});
  if(p.endsWith('/logs'))return reply({text:'fixture',offset:0});
  if(p.startsWith('/api/wrf/tasks/'))return reply(tasks.find(t=>p.endsWith(t.id)));
  if(p==='/api/wrf/display')return reply({task_id:u.searchParams.get('task_id'),meta_json:{domains:[]}});
  if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();
 });
 await page.goto('/wrf?view=run&task_id=task-00');
 await page.getByRole('button',{name:/^任务与资料/}).click();
 await page.locator('.history-card article[title="task-12"]').click();
 await expect(page.locator('.workspace-head small')).toHaveText('task-12');
 await page.getByRole('button',{name:/^任务与资料/}).click();
 await expect(page.locator('.history-card article.selected')).toHaveAttribute('title','task-12');
 await page.reload();await expect(page.locator('.workspace-head small')).toHaveText('task-12');
 await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.history-card article.selected')).toHaveAttribute('title','task-12');
});

test('late previews cannot replace rapid cross-domain edits and consecutive undo submission',async({page})=>{
 const initial=backendCall('import json; from test_ordinary_ui2 import tree_request; print(json.dumps(tree_request()))');
 await page.addInitScript(value=>{window.__wrfInitialRequest=value;},initial);
 const previews=[],validations=[],release=[];let settled=0,initialCanonical;
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;
  const r=route.request(),u=new URL(r.url());if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
  if(u.pathname==='/__fixture__/options')return route.fulfill({json:options});
  if(u.pathname.endsWith('/domains/preview')){
   const body=r.postDataJSON(),index=previews.length;previews.push(body);
   const data=backendCall('import json,sys; from domain_preview import DomainPreviewRequest,preview_domains; print(json.dumps(preview_domains(DomainPreviewRequest.model_validate(json.load(sys.stdin)))))',body);
   if(index===0)initialCanonical=data.domains;
   if(index===1||index===2){await new Promise(resolve=>{release[index]=resolve;});try{if(index===2)await route.fulfill({status:422,json:{detail:'obsolete preview failure'}});else await route.fulfill({json:{code:0,data}});}catch{}finally{settled++;}return;}
   return route.fulfill({json:{code:0,data}});
  }
  if(u.pathname.endsWith('/tasks/validate')){validations.push(r.postDataJSON());return route.fulfill({json:{code:0,data:{request:r.postDataJSON(),warnings:[]}}});}
  if(u.pathname.startsWith('/api/'))throw new Error('Unexpected live API '+u.pathname);return route.continue();
 });
 await page.goto('/tests/browser/wrf-shared.html');const submit=page.getByRole('button',{name:'开始模拟',exact:true});await expect(submit).toBeEnabled();
 await page.locator('.wrf-domain-title').filter({hasText:/^D02 /}).click();await page.getByLabel('东西网格数',{exact:true}).fill('76');await expect.poll(()=>previews.length).toBe(2);
 await page.locator('.wrf-domain-title').filter({hasText:/^D03 /}).click();await page.getByLabel('南北网格数',{exact:true}).fill('76');await expect.poll(()=>previews.length).toBe(3);
 await expect(submit).toBeDisabled();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect.poll(()=>previews.length).toBe(4);await expect(submit).toBeEnabled();expect(previews[3].domains).toEqual(initialCanonical);
 const paths=await page.locator('.wrf-domain-overlay path.editable').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')));
 release[2]();release[1]();await expect.poll(()=>settled).toBe(2);
 await expect(submit).toBeEnabled();await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByLabel('南北网格数',{exact:true})).toHaveValue('61');
 expect(await page.locator('.wrf-domain-overlay path.editable').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')))).toEqual(paths);
 await page.locator('.wrf-domain-title').filter({hasText:/^D02 /}).click();await expect(page.getByLabel('东西网格数',{exact:true})).toHaveValue('61');
 await submit.click();await expect.poll(()=>validations.length).toBe(1);expect(validations[0].domains).toEqual(initialCanonical);
 await expect.poll(()=>page.evaluate(()=>window.__wrfSubmission?.domains)).toEqual(initialCanonical);
});

for(const sharedUrl of [false,true])test(`result metadata and frames stay bound across task variable time races and refresh shared=${sharedUrl}`,async({page})=>{
 const images=backendCall("import io,json,base64; from PIL import Image; result=[]\nfor color in [(20,140,230,255),(20,230,140,255),(230,20,20,255)]:\n b=io.BytesIO(); Image.new('RGBA',(4,4),color).save(b,format='WEBP',lossless=True); result.append(base64.b64encode(b.getvalue()).decode())\nprint(json.dumps(result))").map(s=>Buffer.from(s,'base64'));
 await page.addInitScript(()=>{const original=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.__lastResultBlob=blob;return original(blob);};localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'result-race',username:'fixture',role:3}));});
 const tasks=['a','b'].map(id=>({id:'result-'+id,status:'succeeded',request:{data_source:'gfs',domains:[]}}));
 let releaseMeta,lateMetaDone=false;const releaseAssets={};let lateAssetsDone=0,delayAssets=true;const assets=[];
 const metadata=id=>({task_id:id,meta_json:{default_domain:'d01',default_variable:'T2',domains:[{id:'d01',dx:27000,extent:[100,30,110,40],geolocation:{status:'reprojected',target_crs:'EPSG:3857'},variables:['T2','W2'].map((name,v)=>({name,label:name==='T2'?'温度':'风速',units:name==='T2'?'°C':'m/s',palette:v?[[200,0,0],[250,200,0]]:[[0,10,20],[250,240,230]],frames:[0,1].map(i=>({time:`2026-10-14T0${i}:00:00Z`,url:`/data/WRF/${id}/${name}/${sharedUrl&&name==='T2'?0:i}.webp`,display_min:v?80+i:10+i,display_max:v?100+i:20+i}))}))}]}});
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;
  const r=route.request(),u=new URL(r.url()),p=u.pathname,reply=data=>route.fulfill({json:{code:0,data}});
  if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
  if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});
  if(p==='/api/wrf/data-status')return reply({pool_items:[]});if(p==='/api/wrf/forcing/refresh')return reply({status:'idle'});
  if(p==='/api/wrf/workbench/tasks')return reply({items:tasks,total:2});
  if(p.startsWith('/api/wrf/tasks/'))return reply(tasks.find(t=>p.endsWith(t.id)));
  if(p==='/api/wrf/display'){const id=u.searchParams.get('task_id');if(id==='result-a'){await new Promise(resolve=>{releaseMeta=resolve;});try{await reply(metadata(id));}catch{}finally{lateMetaDone=true;}return;}return reply(metadata(id));}
  if(p.startsWith('/data/WRF/')){assets.push(p);if(p.includes('/W2/')&&delayAssets){await new Promise(resolve=>{releaseAssets[p]=resolve;});try{await route.fulfill({contentType:'image/webp',body:images[2]});}catch{}finally{lateAssetsDone++;}return;}return route.fulfill({contentType:'image/webp',body:images[p.includes('/W2/')?2:p.endsWith('/1.webp')?1:0]});}
  if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();
 });
 await page.goto('/wrf?view=result&task_id=result-a');await expect.poll(()=>Boolean(releaseMeta)).toBe(true);
 await page.getByRole('button',{name:/^任务与资料/}).click();await page.locator('.history-card article[title="result-b"]').click();
 await expect(page.locator('.result-toolbar')).toContainText('温度');await expect(page.locator('.proj-canvas[data-data-ready="true"]')).toBeVisible();
 releaseMeta();await expect.poll(()=>lateMetaDone).toBe(true);await expect(page.locator('.workspace-head small')).toHaveText('result-b');
 await page.getByRole('combobox',{name:'变量',exact:true}).selectOption('W2');await expect.poll(()=>assets.some(p=>p.endsWith('/W2/0.webp'))).toBe(true);
 await expect(page.locator('.lc-bar')).toHaveCount(0);await expect(page.locator('.result-toolbar')).toContainText('加载中');await expect(page.locator('.webgl-render-source')).toHaveCount(0);
 await page.getByRole('button',{name:'下一帧',exact:true}).click();await expect.poll(()=>assets.some(p=>p.endsWith('/W2/1.webp'))).toBe(true);
 await page.getByRole('combobox',{name:'变量',exact:true}).selectOption('T2');await expect(page.locator('.result-toolbar')).toContainText('温度');await expect(page.locator('.result-toolbar')).toContainText('2026-10-14T01:00:00Z');
 releaseAssets['/data/WRF/result-b/W2/1.webp']();releaseAssets['/data/WRF/result-b/W2/0.webp']();await expect.poll(()=>lateAssetsDone).toBe(2);
 await expect(page.getByRole('combobox',{name:'变量',exact:true})).toHaveValue('T2');await expect(page.locator('.lc-bar')).toHaveCSS('background-image','linear-gradient(to right, rgb(0, 10, 20), rgb(250, 240, 230))');
 await expect(page.locator('.result-toolbar')).toContainText('2026-10-14T01:00:00Z');await expect(page).toHaveURL(/frame=1/);
 const rgba=await page.evaluate(async()=>{const bitmap=await createImageBitmap(window.__lastResultBlob),canvas=document.createElement('canvas');canvas.width=canvas.height=4;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return [...ctx.getImageData(1,1,1,1).data];});expect(rgba).toEqual(sharedUrl?[20,140,230,255]:[20,230,140,255]);
 delayAssets=false;await page.getByRole('combobox',{name:'变量',exact:true}).selectOption('W2');await expect(page.locator('.result-toolbar')).toContainText('风速');await expect(page).toHaveURL(/variable=W2/);
 await page.reload();await expect(page.getByRole('combobox',{name:'变量',exact:true})).toHaveValue('W2');await expect(page.locator('.result-toolbar')).toContainText('风速');await expect(page.locator('.result-toolbar')).toContainText('2026-10-14T01:00:00Z');await expect(page.locator('.proj-canvas[data-data-ready="true"]')).toBeVisible();
 await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.history-card article.selected')).toHaveAttribute('title','result-b');
});

async function playbackFixture(page){
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'playback-owner',username:'fixture',role:3}));});
 const webp=Buffer.from(backendCall("import io,json,base64; from PIL import Image; b=io.BytesIO(); Image.new('RGBA',(4,4),(40,160,220,255)).save(b,format='WEBP',lossless=True); print(json.dumps(base64.b64encode(b.getvalue()).decode()))"),'base64');
 const requests=[],gates=new Map(),failures=new Map();
 const definitions=[['T2','温度','K',280,290,3],['PSFC','气压','Pa',100000,102000,2],['WS','风速','m/s',2,8,1],['T2','温度','°C',10,20,3]];
 const task={id:'playback-task',status:'succeeded',request:{data_source:'gfs',domains:[]}};
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;
  const r=route.request(),u=new URL(r.url()),p=u.pathname,reply=data=>route.fulfill({json:{code:0,data}});
  if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
  if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});
  if(p==='/api/wrf/data-status')return reply({pool_items:[]});if(p==='/api/wrf/forcing/refresh')return reply({status:'idle'});
  if(p==='/api/wrf/workbench/tasks')return reply({items:[task],total:1});if(p==='/api/wrf/tasks/'+task.id)return reply(task);
  if(p==='/api/wrf/display')return reply({task_id:task.id,meta_json:{default_domain:'d01',domains:definitions.map(([name,label,units,min,max,count],d)=>({id:`d0${d+1}`,dx:27000/3**d,extent:[100+d,30,110,40],geolocation:{status:'reprojected',target_crs:'EPSG:3857'},variables:[{name,label,units,palette:[[d*40,10,20],[250,240-d*40,230]],frames:Array.from({length:count},(_,i)=>({time:`2026-10-14T0${i}:00:00Z`,url:`/data/WRF/playback/d0${d+1}/${i}.webp`,display_min:min+i,display_max:max+i}))}]}))}});
  if(p.startsWith('/data/WRF/playback/')){requests.push(p);if(gates.has(p))await gates.get(p);const failure=failures.get(p);if(failure==='http')return route.fulfill({status:503,json:{detail:'fixture asset unavailable'}});if(failure==='decode')return route.fulfill({contentType:'image/webp',body:'not a valid image'});try{return await route.fulfill({contentType:'image/webp',body:webp});}catch{return;}}
  if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();
 });
 return {requests,gates,failures};
}

test('playback waits for the selected image and pause keeps its completed time',async({page})=>{
 await page.clock.install();const f=await playbackFixture(page);let release;
 f.gates.set('/data/WRF/playback/d01/1.webp',new Promise(resolve=>release=resolve));
 await page.goto('/wrf?view=result&task_id=playback-task');await expect(page.locator('.result-toolbar')).toContainText('2026-10-14T00:00:00Z');
 await page.getByRole('button',{name:'播放',exact:true}).click();await page.clock.runFor(950);await expect.poll(()=>f.requests.includes('/data/WRF/playback/d01/1.webp')).toBe(true);
 await page.clock.runFor(1800);expect(f.requests.filter(p=>p.endsWith('/2.webp'))).toHaveLength(0);
 await page.getByRole('button',{name:'暂停',exact:true}).click();release();await expect(page.locator('.result-toolbar')).toContainText('2026-10-14T01:00:00Z');
 await page.clock.runFor(1800);await expect(page.locator('.result-toolbar')).toContainText('2026-10-14T01:00:00Z');await expect(page.locator('.lc-legend small')).toHaveText('°C');
});

test('domain time-axis and failed-frame retry keep units palettes and selected time coherent',async({page})=>{
 await page.clock.install();const f=await playbackFixture(page);
 await page.goto('/wrf?view=result&task_id=playback-task');await expect(page.locator('.result-toolbar')).toContainText('温度');
 for(const [domain,unit,ticks,palette]of [
  ['d01','°C',['6.9','11.9','16.9'],'linear-gradient(to right, rgb(0, 10, 20), rgb(250, 240, 230))'],
  ['d02','hPa',['1000','1010','1020'],'linear-gradient(to right, rgb(40, 10, 20), rgb(250, 200, 230))'],
  ['d03','m/s',['2','5','8'],'linear-gradient(to right, rgb(80, 10, 20), rgb(250, 160, 230))'],
  ['d04','°C',['10','15','20'],'linear-gradient(to right, rgb(120, 10, 20), rgb(250, 120, 230))']
 ]){
  await page.getByRole('combobox',{name:'区域',exact:true}).selectOption(domain);
  await expect(page.locator('.lc-legend small')).toHaveText(unit);await expect(page.locator('.lc-legend li')).toHaveText(ticks);await expect(page.locator('.lc-bar')).toHaveCSS('background-image',palette);
  await expect(page.locator('.result-toolbar')).toContainText('2026-10-14T00:00:00Z');
  if(domain==='d03')await expect(page.getByRole('button',{name:'播放',exact:true})).toBeDisabled();
 }
 // Drag the actual slider rather than setting the host's state directly.
 const runway=await page.locator('.timebar .el-slider__runway').boundingBox();
 const handle=await page.locator('.timebar .el-slider__button-wrapper').boundingBox();
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(runway.x+runway.width,runway.y+runway.height/2,{steps:5});await page.mouse.up();
 await expect(page.locator('.result-toolbar')).toContainText('2026-10-14T02:00:00Z');await expect(page.locator('.lc-legend li')).toHaveText(['12','17','22']);
 await page.getByRole('button',{name:'第一帧',exact:true}).click();await expect(page.locator('.result-toolbar')).toContainText('2026-10-14T00:00:00Z');
 f.failures.set('/data/WRF/playback/d04/1.webp','http');
 await page.getByRole('button',{name:'播放',exact:true}).click();await page.clock.runFor(950);
 await expect(page.getByRole('button',{name:'重试加载',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'播放',exact:true})).toBeVisible();await expect(page.locator('.result-toolbar')).toContainText('加载失败');await expect(page.locator('.lc-bar')).toHaveCount(0);
 const count=f.requests.length;await page.clock.runFor(1800);expect(f.requests.length).toBe(count);
 f.failures.delete('/data/WRF/playback/d04/1.webp');await page.getByRole('button',{name:'重试加载',exact:true}).click();await expect(page.locator('.result-toolbar')).toContainText('2026-10-14T01:00:00Z');await expect(page.locator('.lc-legend li')).toHaveText(['11','16','21']);await expect(page.getByRole('alert')).toHaveCount(0);
 f.failures.set('/data/WRF/playback/d04/2.webp','decode');await page.getByRole('button',{name:'下一帧',exact:true}).click();await expect(page.getByRole('alert')).toContainText('解码失败');
 f.failures.delete('/data/WRF/playback/d04/2.webp');await page.getByRole('button',{name:'重试加载',exact:true}).click();await expect(page.locator('.result-toolbar')).toContainText('2026-10-14T02:00:00Z');await expect(page.locator('.lc-legend li')).toHaveText(['12','17','22']);await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByRole('combobox',{name:'区域',exact:true})).toHaveValue('d04');
});

test('four-task capacity and resource queue reason reflect the backend policy',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'resource-owner',username:'fixture',role:3}));});
 const tasks=Array.from({length:5},(_,i)=>({id:'resource-'+i,status:i===4?'queued':'running',stage:i===4?'queued':'running',request:{domains:[]},runtime:i===4?{resource_wait_reason:'可用内存不足，等待预留释放'}:{}}));
 await page.route('**/*',async route=>{if(await fixtureConfigurationPreview(route))return;const u=new URL(route.request().url()),p=u.pathname,reply=data=>route.fulfill({json:{code:0,data}});if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();if(p==='/api/wrf/options')return reply(options);if(p==='/api/health')return reply({status:'online',active_task_count:4,max_concurrent_tasks:4,hpc:{status:'ready'}});if(p==='/api/wrf/workbench/tasks')return reply({items:tasks,active_items:tasks,total:5});if(p==='/api/wrf/data-status')return reply({pool_items:[]});if(p==='/api/wrf/forcing/refresh')return reply({status:'idle'});if(p.startsWith('/api/'))throw new Error('Unexpected API '+p);return route.continue();});
 await page.goto('/wrf');await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.running-card')).toContainText('4/4 个任务执行中');await expect(page.locator('.running-card article')).toHaveCount(5);await expect(page.locator('.running-card article[title="resource-4"]')).toContainText('可用内存不足，等待预留释放');
});

test('model retirement redirects old links to WRF without contacting 8006',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('token','fixture-retirement');localStorage.setItem('user',JSON.stringify({uuid:'fixture',username:'fixture',role:2}));});
 const modelRequests=[],writes=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.port==='8006'){modelRequests.push(r.url());return route.abort();}if(await fixtureConfigurationPreview(route))return; if(u.pathname.startsWith('/api/')){if(r.method()!=='GET'){writes.push(u.pathname);return route.abort();}const data=u.pathname==='/api/wrf/options'?options:u.pathname==='/api/wrf/display'?{meta_json:{domains:[]}}:u.pathname==='/api/wrf/data-status'?{status:'ready',pool_items:[]}:u.pathname==='/api/health'?{status:'online',hpc:{status:'ready'}}:{items:[],status:'idle'};return route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});}if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();return route.continue();});
 await page.goto('/model');await expect(page).toHaveURL(/\/wrf(?:\?|$)/);await expect(page.getByRole('heading',{name:'WRF 工作台',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'专用模型调用'})).toHaveCount(0);await page.reload();await expect(page.getByRole('heading',{name:'WRF 工作台',exact:true})).toBeVisible();expect(modelRequests).toEqual([]);expect(writes).toEqual([]);expect(errors).toEqual([]);
});

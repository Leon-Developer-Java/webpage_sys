import {test,expect} from '@playwright/test';
const record=(id,status,cause='',requests=[])=>({id,file:`gfs.f${id}`,attempt:1,status,cause,started_at:'2026-10-20T11:00:00Z',execution_seconds:120,bytes_before:4096,bytes_after:8192,requests});
async function setup(page,handle){
 const writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('token','fixture-not-real'));
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.pathname.startsWith('/api/')){if(req.method()!=='GET')writes.push(u.pathname);return handle(route,u);}if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();return route.continue();});
 await page.goto('/tests/browser/wrf-attempt-history.html');return {writes,errors};
}
test('success retains prior low speed, total timeout, connection and throttle records with read-only paging',async({page})=>{
 const calls=[];const state=await setup(page,async(route,u)=>{calls.push(u.search);return route.fulfill({json:{code:0,data:u.searchParams.has('before')?{items:[record('old','failed','total_timeout')],next_cursor:null}:{items:[record('new','succeeded','',[{request:1,cause:'connection_failure',status:'failed',curl_code:35,execution_seconds:2},{request:2,cause:'',status:'succeeded',curl_code:0,execution_seconds:10}]),record('slow','failed','low_speed_timeout'),record('limit','failed','rate_limited')],next_cursor:100}}});});
 await page.getByText('下载记录',{exact:true}).click();await expect(page.getByLabel('下载尝试记录')).toContainText('低速超时');await expect(page.getByLabel('下载尝试记录')).toContainText('连接失败');await expect(page.getByLabel('下载尝试记录')).toContainText('上游限流');await expect(page.getByLabel('下载尝试记录')).toContainText('成功');
 await page.getByRole('button',{name:'更早记录'}).click();await expect(page.getByLabel('下载尝试记录')).toContainText('达到单次总时限');expect(calls).toHaveLength(2);expect(calls[1]).toContain('before=100');expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
 await page.screenshot({path:test.info().outputPath('history-after-success.png')});
});
test('a late other-source response cannot overwrite a newly selected source and retry recovers read errors',async({page})=>{
 let release;const gate=new Promise(r=>release=r);let failure=true;
 const state=await setup(page,async(route,u)=>{if(u.pathname.includes('/gfs/')){await gate;try{return await route.fulfill({json:{code:0,data:{items:[record('stale','succeeded')],next_cursor:null}}});}catch{return;}}
 if(failure){failure=false;return route.fulfill({status:503,json:{detail:'fixture unavailable'}});}return route.fulfill({json:{code:0,data:{items:[{...record('ec','succeeded'),file:'ECMWF current'}],next_cursor:null}}});});
 await page.getByText('下载记录',{exact:true}).click();await page.getByRole('button',{name:'切换ECMWF'}).click();await page.getByText('下载记录',{exact:true}).click();await expect(page.getByRole('alert')).toContainText('读取失败');await page.getByRole('button',{name:'更新记录'}).click();await expect(page.getByLabel('下载尝试记录')).toContainText('ECMWF current');release();await page.waitForTimeout(150);await expect(page.getByLabel('下载尝试记录')).not.toContainText('stale');expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test('legacy and interrupted attempts are explicit rather than invented failure causes',async({page})=>{
 await setup(page,route=>route.fulfill({json:{code:0,data:{items:[record('unfinished','unfinished')],next_cursor:null,legacy_unrecorded:true}}}));
 await page.getByText('下载记录',{exact:true}).click();await expect(page.getByText('仅显示启用记录后的尝试；此前失败原因无法还原。')).toBeVisible();await expect(page.getByLabel('下载尝试记录')).toContainText('尚未记录结束');
 await page.reload();await page.getByText('下载记录',{exact:true}).click();await expect(page.getByLabel('下载尝试记录')).toContainText('尚未记录结束');
});
test('operator pause is labelled as an observation and retains the continuation record',async({page})=>{
 await setup(page,route=>route.fulfill({json:{code:0,data:{items:[record('resumed','unfinished'),{...record('paused','interrupted','operator_pause'),origin:'operator_pause_observation',execution_seconds:null}],next_cursor:null}}}));
 await page.getByText('下载记录',{exact:true}).click();await expect(page.getByLabel('下载尝试记录')).toContainText('主动暂停交接（分片已保留）');await expect(page.getByLabel('下载尝试记录')).toContainText('旧版在途请求的暂停观测；此前连接过程未记录。');await expect(page.getByLabel('下载尝试记录')).toContainText('尚未记录结束');
});

test('actual workbench shows read-only records on a completed cycle and hides unsupported backend capability',async({page})=>{
 const {execFileSync}=await import('node:child_process');const {resolve}=await import('node:path');
 const profile=JSON.parse(execFileSync(resolve('../backend_wrf/.venv/bin/python'),['-B','-c','import json; from configuration_profile import definition; print(json.dumps(definition()))'],{cwd:resolve('../backend_wrf'),encoding:'utf8'}));
 const writes=[],errors=[];let capable=true;page.on('pageerror',e=>{errors.push(e.message);console.log('HISTORY PAGE ERROR',e.stack);});page.on('console',m=>{if(m.type()==='error')console.log('HISTORY CONSOLE',m.text());});
 await page.addInitScript(()=>{localStorage.setItem('token','fixture');localStorage.setItem('user',JSON.stringify({uuid:'history-fixture',username:'fixture',role:2}));});
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()),p=u.pathname;const reply=data=>route.fulfill({json:{code:0,data}});if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
 if(p==='/api/wrf/namelist/resolve')return reply({errors:[],rules:[]});
 if(p==='/api/wrf/options')return reply({configuration_profile:profile,namelist_capability:{schema_version:'fixture',source_hash:'fixture'},workbench_management:{id:'wrf-workbench-management-1',forcing_refresh:true,forcing_attempt_history:capable}});
 if(p==='/api/health')return reply({status:'online',hpc:{status:'ready'}});
 if(p==='/api/wrf/workbench/tasks')return reply({items:[]});
 if(p==='/api/wrf/forcing/refresh' && req.method()==='GET')return reply({status:'idle'});
 if(p==='/api/wrf/data-status')return reply({status:'ready',pool_items:[{provider:'gfs',label:'GFS',status:'ready',cycles:[{cycle:'2026102000',status:'ready',complete:true,completed_files:73,total_files:73,size_bytes:1e9}]}]});
 if(p.endsWith('/attempts'))return reply({items:[record('saved','failed','low_speed_timeout'),record('success','succeeded')],next_cursor:null});
 if(p.startsWith('/api/')){if(req.method()!=='GET')writes.push(p);return route.abort();}return route.continue();});
 await page.goto('/wrf?view=result');await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.data-pool')).toContainText('73/73');await page.locator('.data-pool').getByText('下载记录',{exact:true}).click();await expect(page.locator('.data-pool')).toContainText('低速超时');await expect(page.locator('.data-pool')).toContainText('成功');
 capable=false;await page.reload();await page.getByRole('button',{name:/^任务与资料/}).click();await expect(page.locator('.data-pool')).toContainText('73/73');await expect(page.locator('.data-pool summary')).toHaveCount(0);expect(writes).toEqual([]);expect(errors).toEqual([]);
});

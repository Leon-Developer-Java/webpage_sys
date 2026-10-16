export const PROFILE = 'wrf-ordinary-ui-2';
export const CUMULUS_UI_FIELD = 'ui_cumulus_overrides';
export const clone = value => JSON.parse(JSON.stringify(value));
export function defaultConfig(options = {}, source = 'gfs') {
  options ||= {};
  const profile = options.configuration_profile || {};
  const interval = source === 'ecmwf' ? 3 : 1;
  const start = new Date(); start.setUTCMinutes(0,0,0); start.setUTCHours(Math.floor(start.getUTCHours()/interval)*interval);
  const physics=clone(profile.physics_defaults || options.physics_presets?.['默认通用'] || {});delete physics.cu_physics;delete physics.cu_physics_by_domain;
  return {configuration_profile:PROFILE,data_source:source,start_time:start.toISOString().replace('.000Z','Z'),end_time:new Date(+start+24*3600000).toISOString().replace('.000Z','Z'),forecast_interval_hours:interval,history_interval_minutes:60,spinup:clone(profile.defaults?.spinup||{mode:'custom',hours:6}),vertical_levels:profile.defaults?.vertical_levels??88,assimilation_scheme:'off',physics,center:null,domains:[],projection:{map_proj:'lambert',truelat1:35,truelat2:35,stand_lon:104},aoi:null};
}
export function withKeys(config) {
  const value=clone(config);value.domains ||= [];
  value.domains=value.domains.map(d=>({...d,node_key:d.node_key || globalThis.crypto.randomUUID()}));
  value.projection ||= {...value.namelist?.wps?.geogrid};
  if(!value.projection.map_proj)value.projection={map_proj:'lambert',truelat1:value.center?.lat??35,truelat2:value.center?.lat??35,stand_lon:value.center?.lon??104};
  value.spinup={mode:'custom',...(value.spinup||{hours:6})};value.vertical_levels ??=88;return value;
}
export function renumber(domains) {
  if(!domains.length)return [];
  const byId=new Map(domains.map((d,i)=>[i+1,d]));
  const children=new Map();for(const d of domains){const parent=Number(d.parent_id||0);if(!children.has(parent))children.set(parent,[]);children.get(parent).push(d);}
  if((children.get(0)||[]).length!==1)throw new Error('需要且只能有一个 D01 根域');
  const ordered=[],seen=new Set();
  function visit(d,parent){if(seen.has(d))throw new Error('计算域不能循环引用');seen.add(d);const oldId=[...byId].find(([,v])=>v===d)?.[0];const id=ordered.length+1;ordered.push({...d,id:`d${String(id).padStart(2,'0')}`,parent_id:parent});for(const child of children.get(oldId)||[])visit(child,id);}
  visit(children.get(0)[0],0);if(ordered.length!==domains.length)throw new Error('计算域包含无效父域');return ordered;
}
export function addDomain(config,parentKey=null,ratio=3) {
  const next=withKeys(config),ds=next.domains;
  if(ds.length>=4)throw new Error('当前服务最多支持 4 个计算域');
  if(!ds.length){next.center ||= {lat:35,lon:104};next.domains=[{id:'d01',node_key:crypto.randomUUID(),dx:27000,dy:27000,e_we:100,e_sn:79,parent_id:0,parent_grid_ratio:1,i_parent_start:1,j_parent_start:1}];return next;}
  const index=ds.findIndex(d=>d.node_key===parentKey);if(index<0)throw new Error('请先选择父域');
  const p=ds[index],dx=p.dx/ratio;if(!Number.isInteger(dx)||dx<1000)throw new Error('子域网格距必须为整数米且不小于 1 km');
  const size=v=>Math.max(ratio*3,Math.min(Math.floor(499/ratio)*ratio,Math.floor((v-6)*.5)*ratio))+1;
  const child={id:`d0${ds.length+1}`,node_key:crypto.randomUUID(),parent_id:index+1,parent_grid_ratio:ratio,dx,dy:dx,e_we:size(p.e_we),e_sn:size(p.e_sn)};
  const width=(child.e_we-1)/ratio,height=(child.e_sn-1)/ratio,siblings=ds.filter(d=>d.parent_id===index+1);let position=null;
  for(let j=2;j+height<p.e_sn&&!position;j++)for(let i=2;i+width<p.e_we;i++){if(siblings.every(d=>{const w=(d.e_we-1)/d.parent_grid_ratio,h=(d.e_sn-1)/d.parent_grid_ratio;return i+width<=d.i_parent_start||d.i_parent_start+w<=i||j+height<=d.j_parent_start||d.j_parent_start+h<=j;})){position={i_parent_start:i,j_parent_start:j};break;}}
  if(!position)throw new Error('父域没有足够的无重叠空间，请先调整已有子域大小或位置');
  const old=clone(next);ds.push({...child,...position});next.domains=renumber(ds);remapPhysics(next,old,p.node_key);return next;
}
export function descendants(domains,key) {
  const selected=domains.findIndex(d=>d.node_key===key);if(selected<0)return new Set();
  const removed=new Set([selected+1]);let changed=true;while(changed){changed=false;domains.forEach((d,i)=>{if(removed.has(Number(d.parent_id))&&!removed.has(i+1)){removed.add(i+1);changed=true;}});}return removed;
}
export function removeDomain(config,key) {
  const next=withKeys(config),removed=descendants(next.domains,key);const old=next.domains;const kept=old.map((d,i)=>({d,index:i+1})).filter(x=>!removed.has(x.index));const remap=new Map(kept.map((x,i)=>[x.index,i+1]));
  const previous=clone(next);next.domains=kept.map(({d})=>({...d,parent_id:d.parent_id?remap.get(Number(d.parent_id)):0}));next.domains=renumber(next.domains);remapPhysics(next,previous);if(!next.domains.length)next.center=null;return next;
}
function remapPhysics(next,old,fallbackKey){
  const overrides=cumulusOverrides(old);
  if(Object.hasOwn(old,CUMULUS_UI_FIELD)||Object.keys(overrides).length){
    const kept=new Set(next.domains.map(d=>d.node_key));
    next[CUMULUS_UI_FIELD]=Object.fromEntries(Object.entries(overrides).filter(([key])=>kept.has(key)));
  }
  for(const key of ['cu_physics_by_domain','sf_urban_physics_by_domain']){const values=old.physics?.[key];if(!Array.isArray(values))continue;next.physics[key]=next.domains.map(d=>values[old.domains.findIndex(p=>p.node_key===d.node_key)]??(key==='cu_physics_by_domain'?defaultCumulus(d):values[old.domains.findIndex(p=>p.node_key===fallbackKey)]??values[0]));}
}
export function defaultCumulus(domain,options={}) {
  const rule=options?.configuration_profile?.physics_default_rules?.cu_physics||{};
  return Number(domain.dx)<=Number(rule.at_or_below_spacing_m??3000)?Number(rule.fine_value??0):Number(rule.coarse_value??3);
}
export function cumulusOverrides(config) {
  if(Object.hasOwn(config,CUMULUS_UI_FIELD))return {...config[CUMULUS_UI_FIELD]};
  const physics=config.physics||{},advanced=config.namelist?.input?.physics?.cu_physics;
  const values=physics.cu_physics_by_domain??physics.cu_physics??advanced;
  if(values===undefined||values===null)return {};
  return Object.fromEntries(config.domains.map((d,i)=>[d.node_key,Array.isArray(values)?values[i]:values]).filter(([,v])=>v!==undefined&&v!==null));
}
export function cumulusValue(config,domain,options={}) {return cumulusOverrides(config)[domain.node_key]??defaultCumulus(domain,options);}
export function setCumulus(config,key,value) {
  const next=withKeys(config);if(!next.domains.some(d=>d.node_key===key))throw new Error('请先选择计算域');
  const overrides=cumulusOverrides(next);
  if(value==='auto')delete overrides[key];
  else {const number=Number(value);if(!Number.isInteger(number))throw new Error('积云方案必须为合法整数');overrides[key]=number;}
  next[CUMULUS_UI_FIELD]=overrides;next.physics ||= {};next.physics.preset='自定义';
  delete next.physics.cu_physics;delete next.physics.cu_physics_by_domain;
  // Resolve an existing advanced override only after a deliberate cumulus edit.
  if(next.namelist?.input?.physics)delete next.namelist.input.physics.cu_physics;
  return next;
}
export function setDomain(config,key,field,value) {
  const next=withKeys(config),index=next.domains.findIndex(d=>d.node_key===key);if(index<0)return next;
  next.domains[index][field]=Number(value);if(field==='dx')next.domains[index].dy=Number(value);
  const subtree=descendants(next.domains,key);
  for(let i=0;i<next.domains.length;i++){const d=next.domains[i];if(d.parent_id&&subtree.has(i+1)){const p=next.domains[d.parent_id-1];d.dx=p.dx/d.parent_grid_ratio;d.dy=d.dx;}}
  return next;
}
export function depth(domains,d){let n=0,p=d,seen=new Set();while(p?.parent_id){if(seen.has(p))break;seen.add(p);n++;p=domains[p.parent_id-1];}return n;}
export function geometryRequest(config,edit){return {configuration_profile:PROFILE,center:config.center,domains:config.domains.map(({node_key,...d})=>d),projection:config.projection,aoi:config.aoi||null,...(edit?{edit}:{})};}
export function calculationRequest(config,options={}) {
  options ||= {};
  const next=clone(config);delete next.projection;delete next.aoi;next.domains=geometryRequest(config).domains;
  if(Object.hasOwn(next,CUMULUS_UI_FIELD)){
    const overrides=cumulusOverrides(config);next.physics ||= {};delete next.physics.cu_physics;delete next.physics.cu_physics_by_domain;
    if(config.domains.some(d=>Object.hasOwn(overrides,d.node_key)))next.physics.cu_physics_by_domain=config.domains.map(d=>cumulusValue(config,d,options));
    delete next[CUMULUS_UI_FIELD];
  }
  next.configuration_profile=PROFILE;
  next.namelist ||= {schema_version:options.namelist_capability?.schema_version,source_hash:options.namelist_capability?.source_hash,wps:{},input:{}};
  next.namelist.wps ||= {};next.namelist.wps.geogrid={...next.namelist.wps.geogrid,...config.projection};delete next.namelist.plan_digest;
  return next;
}

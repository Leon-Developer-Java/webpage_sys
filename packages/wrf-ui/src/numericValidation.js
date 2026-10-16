export function numberIssue(raw, spec) {
  const {label,min,max,integer,multiple}=spec;
  if(raw===null||raw===undefined||String(raw).trim()==='')return `${label}不能为空`;
  const n=Number(raw);
  if(!Number.isFinite(n))return `${label}请输入有效数字`;
  if(integer&&!Number.isInteger(n))return `${label}必须为整数`;
  if(min!==undefined&&n<min)return `${label}不能小于 ${min}`;
  if(max!==undefined&&n>max)return `${label}不能大于 ${max}`;
  if(multiple&&n%multiple!==0)return `${label}须为 ${multiple} 的整数倍`;
  return '';
}

export function numericFields(config,options={}) {
  const profile=options?.configuration_profile||{},fields={};
  const add=(key,label,value,min,max,integer=true,multiple)=>{fields[key]={label,value,min,max,integer,multiple};};
  add('run.spinup','Spin-up（小时）',config.spinup?.hours??6,profile.runtime_parameters?.spinup_hours?.min??0,profile.runtime_parameters?.spinup_hours?.max,true,config.forecast_interval_hours||1);
  add('run.vertical_levels','垂直层数',config.vertical_levels??88,profile.runtime_parameters?.vertical_levels?.min??10,profile.runtime_parameters?.vertical_levels?.max??500);
  if(config.center){
    add('center.lat','中心纬度',config.center.lat,-90,90,false);
    add('center.lon','中心经度',config.center.lon,-180,180,false);
    for(const k of ['truelat1',...(config.projection?.map_proj==='lambert'?['truelat2']:[]),'stand_lon'])add('projection.'+k,k,config.projection?.[k],k==='stand_lon'?-180:-90,k==='stand_lon'?180:90,false);
  }
  for(const d of config.domains||[]){
    const prefix='domain.'+d.node_key+'.',label=d.id.toUpperCase();
    if(!d.parent_id)add(prefix+'dx',label+' 网格距（m）',d.dx,1000,50000);
    add(prefix+'e_we',label+' 东西网格数',d.e_we,10,500);add(prefix+'e_sn',label+' 南北网格数',d.e_sn,10,500);
    if(d.parent_id){const parent=config.domains[d.parent_id-1];for(const k of ['i_parent_start','j_parent_start'])add(prefix+k,label+' 父域起点 '+(k[0]==='i'?'i':'j'),d[k],1,parent?.[k[0]==='i'?'e_we':'e_sn']-1);}
  }
  for(const f of profile.physics_fields||[])if(f.id!=='cu_physics'&&!f.choices?.length)add('physics.'+f.id,f.label,config.physics?.[f.id]??profile.physics_defaults?.[f.id],f.min,f.max,f.integer!==false);
  return fields;
}

export function numericValidation(config,options,buffers={}) {
  const errors=Object.entries(numericFields(config,options)).map(([key,spec])=>numberIssue(Object.hasOwn(buffers,key)?buffers[key]:spec.value,spec)).filter(Boolean);
  return {valid:errors.length===0,errors};
}

import { BASEMAPS } from '../../utils/basemaps';
import { sceneFetch,SCENE3D_BASE } from './api';
import { imageryScheme } from './coordinates';
import { WrfWindWebGpu } from './windRenderer';
import { installCameraControls } from './cameraControls';

let cesiumPromise;
function loadCesium(){
  if(window.Cesium)return Promise.resolve(window.Cesium);
  if(!cesiumPromise)cesiumPromise=new Promise((resolve,reject)=>{
    window.CESIUM_BASE_URL=SCENE3D_BASE+'/scene3d-runtime/cesium/';
    if(!document.querySelector('link[data-scene3d-runtime]')){
      const css=document.createElement('link');css.rel='stylesheet';css.href=window.CESIUM_BASE_URL+'Widgets/widgets.css';css.dataset.scene3dRuntime='true';document.head.append(css);
    }
    const script=document.createElement('script');script.src=window.CESIUM_BASE_URL+'Cesium.js';
    script.onload=()=>resolve(window.Cesium);script.onerror=()=>{cesiumPromise=null;reject(new Error('三维渲染资源加载失败，请检查服务器连接'));};
    document.head.append(script);
  });
  return cesiumPromise;
}

export async function createScene(container,canvas,onStatus,signal,onWeatherStatus=onStatus){
  const C=await loadCesium();
  const [terrain,wrf]=await Promise.all(['terrain_global','wrf3d'].map(async kind=>(await sceneFetch(`/api/scene3d/assets/${kind}/manifest.json`,{signal})).json()));
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const scheme=new C.GeographicTilingScheme({ellipsoid:C.Ellipsoid.WGS84});
  const rect=C.Rectangle.fromDegrees(...terrain.dataRectangleDegrees),cache=new Map();
  const provider=new C.CustomHeightmapTerrainProvider({width:terrain.samples,height:terrain.samples,tilingScheme:scheme,credit:'Copernicus DEM GLO-30',
    callback(x,y,z){
      if(z>terrain.maximumLevel)return undefined;
      if(!C.Rectangle.intersection(scheme.tileXYToRectangle(x,y,z),rect))return new Float32Array(terrain.samples**2);
      const key=`${z}/${x}/${y}`;
      if(!cache.has(key))cache.set(key,sceneFetch(`/api/scene3d/assets/terrain_global/${key}.bin`,{signal})
        .then(r=>r.arrayBuffer()).then(buffer=>Float32Array.from(new Uint16Array(buffer),v=>v*terrain.heightScaleMetres))
        .catch(error=>{cache.delete(key);throw error;}));
      return cache.get(key);
    }});
  provider.getTileDataAvailable=(_x,_y,z)=>z<=terrain.maximumLevel;
  const viewer=new C.Viewer(container,{terrainProvider:provider,baseLayer:false,animation:false,timeline:false,geocoder:false,homeButton:false,
    sceneModePicker:false,baseLayerPicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,shouldAnimate:true});
  viewer.scene.globe.depthTestAgainstTerrain=true;
  viewer.scene.globe.maximumScreenSpaceError=4;viewer.scene.globe.tileCacheSize=320;
  viewer.scene.globe.baseColor=C.Color.fromCssColorString('#456857');viewer.scene.verticalExaggeration=6;
  const cameraControls=installCameraControls(C,viewer);
  const source=new C.CustomDataSource('scene3d-lines');await viewer.dataSources.add(source);
  let disposed=false,wind=null,geometry=null,frame=null,wireRows=[],insulatorRows=[],nodeRows=[],animation=0,group='all',mode='wind';
  let amplification=50,exaggeration=6,linesVisible=true,cloudVisible=false,playing=true,last=performance.now(),elapsed=0;
  let cropHandler=null,cropPolygon=null;
  const colors={A:'#e7a451',B:'#64ced4',C:'#d7dfe8',G:'#a3abbd'};
  const basePosition=(xyz)=>new C.Cartesian3(...xyz);
  function exaggerated(point){
    const carto=C.Cartographic.fromCartesian(point);carto.height*=exaggeration;
    return C.Cartesian3.fromRadians(carto.longitude,carto.latitude,carto.height);
  }
  function home(){const b=wrf.bounds;
    cameraControls.cancel();viewer.camera.cancelFlight();
    const range=Math.max(wrf.projection.dx*wrf.dimensions.x,wrf.projection.dy*wrf.dimensions.y)*1.42;
    viewer.camera.lookAt(C.Cartesian3.fromDegrees((b.west+b.east)/2,(b.south+b.north)/2,150),new C.HeadingPitchRange(C.Math.toRadians(12),C.Math.toRadians(-34),range));
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
  }
  function setBasemap(name){
    const spec=BASEMAPS[name]||BASEMAPS['矢量底图'];viewer.imageryLayers.removeAll();
    onStatus('正在加载底图');
    const image=new C.UrlTemplateImageryProvider({url:spec.url,subdomains:['1','2','3','4'],tilingScheme:imageryScheme(C,spec.coordinates==='GCJ02'),maximumLevel:19,credit:spec.credit});
    let warned=false;image.errorEvent.addEventListener(()=>{if(!warned){onStatus('底图暂时不可用，地形和业务数据仍可查看');warned=true;}});
    viewer.imageryLayers.addImageryProvider(image);
  }
  function showGroup(value){
    group=value;
    for(const entity of source.entities.values)entity.show=linesVisible&&(group==='all'||entity.scene3dGroup===group)&&(!entity.scene3dCloud||cloudVisible);
  }
  function addLine(id,points,color,width,groupId,extra={}){
    const material=C.Color.fromCssColorString(color);
    const entity=source.entities.add({id,polyline:{positions:points,material,depthFailMaterial:material.withAlpha(.92),arcType:C.ArcType.NONE,width,...extra}});
    entity.scene3dGroup=groupId;return entity;
  }
  function loadGeometry(value){
    geometry=value;source.entities.removeAll();wireRows=[];insulatorRows=[];nodeRows=[];
    for(const tower of value.towers){
      const matrix=C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(tower.longitude,tower.latitude,tower.ground_height));
      const point=(x,y,z)=>exaggerated(C.Matrix4.multiplyByPoint(matrix,new C.Cartesian3(x,y,z*tower.height/42),new C.Cartesian3()));
      const corners=[[-1,-1],[-1,1],[1,1],[1,-1]];
      for(let side=0;side<4;side++){
        const a=corners[side],b=corners[(side+1)%4];
        addLine(`${tower.id}-leg${side}`,[point(a[0]*4,a[1]*4,0),point(a[0],a[1],38)],'#dbe5ed',2,tower.group_id);
        for(let level=0;level<4;level++){
          const z=level*9,r=4-z*3/38,r2=4-(z+9)*3/38;
          addLine(`${tower.id}-brace${side}-${level}`,[point(a[0]*r,a[1]*r,z),point(b[0]*r2,b[1]*r2,z+9),point(a[0]*r2,a[1]*r2,z+9),point(b[0]*r,b[1]*r,z)],'#92a9bc',1,tower.group_id);
        }
      }
      addLine(`${tower.id}-arm`,[point(0,-8,34),point(0,8,34)],'#e2edf4',3,tower.group_id);
      addLine(`${tower.id}-top`,[point(0,0,34),point(0,0,42)],'#e2edf4',3,tower.group_id);
      const label=source.entities.add({id:`${tower.id}-label`,position:point(0,0,44),label:{text:`${tower.id}\n${tower.height.toFixed(0)} m`,font:'12px sans-serif',fillColor:C.Color.WHITE,outlineColor:C.Color.BLACK,outlineWidth:2,style:C.LabelStyle.FILL_AND_OUTLINE,distanceDisplayCondition:new C.DistanceDisplayCondition(0,14000)}});label.scene3dGroup=tower.group_id;
    }
    for(const span of value.spans)for(const wire of ['A','B','C','G']){
      const row={id:span.id+'-'+wire,points:[],reference:[],groupId:span.group_id};wireRows.push(row);
      addLine(row.id,new C.CallbackProperty(()=>row.points,false),colors[wire],wire==='G'?1.2:2,span.group_id);
      const reference=addLine(row.id+'-reference',new C.CallbackProperty(()=>row.reference,false),'#ffffff',1,span.group_id,{material:new C.PolylineDashMaterialProperty({color:C.Color.WHITE,dashLength:8})});
      reference.scene3dReference=true;
    }
    for(const tower of value.towers)for(const wire of ['A','B','C','G']){
      const row={id:tower.id+'-'+wire,points:[]};insulatorRows.push(row);
      addLine(row.id+'-insulator',new C.CallbackProperty(()=>row.points,false),'#dce8b1',4,tower.group_id);
    }
    showGroup(group);
  }
  function setFrame(value){
    frame=value;
    const byId=new Map(value.wires.map(w=>[w.id,w]));
    for(const row of wireRows){const wire=byId.get(row.id);row.data=wire;row.base=wire?.base.map(basePosition)||[];row.target=wire?.positions.map(basePosition)||[];}
    const insulators=new Map((value.insulators||[]).map(item=>[item.tower_id+'-'+item.wire,item]));
    for(const row of insulatorRows){const item=insulators.get(row.id);row.points=item?[exaggerated(basePosition(item.anchor)),exaggerated(basePosition(item.endpoint))]:[];}
    for(const row of nodeRows)source.entities.remove(row.entity);nodeRows=[];
    for(const item of value.response_nodes||[]){
      const color=C.Color.fromHsl(.66*(1-Math.min(1,item.magnitude/Math.max(value.maximum_response||1e-6,1e-6))),1,.55);
      const entity=source.entities.add({id:`node-${item.id}`,point:{pixelSize:item.maximum?10:5,color,outlineColor:C.Color.BLACK,outlineWidth:1},label:item.maximum?{text:`最大位移 ${item.magnitude.toFixed(4)} m`,font:'12px sans-serif',showBackground:true}:undefined});
      entity.scene3dGroup=item.group_id;entity.scene3dCloud=true;nodeRows.push({entity,item});
    }
    showGroup(group);
  }
  function draw(now){
    if(disposed)return;
    const delta=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
    if(playing)elapsed+=delta;
    const blend=1-Math.exp(-delta/.65);
    for(const row of wireRows){
      if(!row.base?.length)continue;
      const index=geometry.spans.findIndex(span=>span.id===row.data?.span_id);
      const pulse=1+.5*Math.sin(elapsed*1.05+index*.9);
      if(playing)row.pulse=(row.pulse??0)+(pulse-(row.pulse??0))*blend;
      const amount=mode==='static'?0:amplification*(mode==='wind'?(row.pulse??0):1);
      row.points=row.base.map((base,i)=>exaggerated(C.Cartesian3.lerp(base,row.target[i],amount,new C.Cartesian3())));
      row.reference=amplification>1&&mode!=='static'?row.base.map(exaggerated):[];
    }
    for(const {entity,item} of nodeRows){
      const row=wireRows.find(r=>r.id===item.wire_id);entity.position=row?.points[item.point_index];
    }
    animation=requestAnimationFrame(draw);
  }
  function focus(close=false){
    if(!geometry)return;
    cameraControls.cancel();viewer.camera.cancelFlight();
    let selected=geometry.towers.filter(t=>group==='all'||t.group_id===group);
    if(close&&frame){const best=[...frame.spans].sort((a,b)=>b.displacement-a.displacement)[0];selected=geometry.towers.filter(t=>t.group_id===best?.group_id);}
    if(!selected.length)return;
    const points=selected.map(t=>C.Cartesian3.fromDegrees(t.longitude,t.latitude,(t.ground_height+t.height)*exaggeration));
    const sphere=C.BoundingSphere.fromPoints(points);
    viewer.camera.flyToBoundingSphere(sphere,{duration:1,offset:new C.HeadingPitchRange(0,C.Math.toRadians(-25),close?Math.max(140,sphere.radius*.6):Math.max(300,sphere.radius*3))});
    if(close)canvas.style.opacity='.25';
  }
  function startCrop(){
    cropHandler?.destroy();const points=[];onStatus('依次点击框选区域的两个角点');
    cropHandler=new C.ScreenSpaceEventHandler(viewer.canvas);
    cropHandler.setInputAction(event=>{
      const ray=viewer.camera.getPickRay(event.position),point=viewer.scene.globe.pick(ray,viewer.scene);
      if(!point)return;const v=C.Cartographic.fromCartesian(point);points.push([C.Math.toDegrees(v.longitude),C.Math.toDegrees(v.latitude)]);
      if(points.length===2){
        const west=Math.min(points[0][0],points[1][0]),east=Math.max(points[0][0],points[1][0]);
        const south=Math.min(points[0][1],points[1][1]),north=Math.max(points[0][1],points[1][1]);
        const polygon=[[west,south],[east,south],[east,north],[west,north]];wind?.setCropPolygon(polygon);
        if(cropPolygon)viewer.entities.remove(cropPolygon);
        cropPolygon=viewer.entities.add({rectangle:{coordinates:C.Rectangle.fromDegrees(west,south,east,north),material:C.Color.CYAN.withAlpha(.08),outline:true,outlineColor:C.Color.CYAN}});
        cropHandler.destroy();cropHandler=null;onStatus('已框选风场显示范围');
      }
    },C.ScreenSpaceEventType.LEFT_CLICK);
  }
  home();setBasemap('矢量底图');animation=requestAnimationFrame(draw);
  try{
    wind=new WrfWindWebGpu(canvas,viewer,wrf,{fetch:path=>sceneFetch(path,{signal}),status:onWeatherStatus});
    await wind.initialise();wind.setTerrainScale(exaggeration);
  }catch(error){
    wind?.destroy();wind=null;
    if(!signal?.aborted)onWeatherStatus(`原风场显示未启动：${error.message}`);
  }
  if(signal?.aborted){disposed=true;wind?.destroy();cameraControls.destroy();cancelAnimationFrame(animation);viewer.destroy();throw new DOMException('Aborted','AbortError');}
  return {
    loadGeometry,setFrame,setBasemap,showGroup,focus,startCrop,manifest:wrf,
    setMode(value){mode=value;},setPlaying(value){playing=value;},
    setAmplification(value){amplification=Number(value);},setCloud(value){cloudVisible=value;showGroup(group);},
    setLinesVisible(value){linesVisible=value;showGroup(group);},
    setExaggeration(value){exaggeration=Number(value);viewer.scene.verticalExaggeration=exaggeration;wind?.setTerrainScale(exaggeration);if(geometry){const old=frame;loadGeometry(geometry);if(old)setFrame(old);}},
    setWindMode(value){wind?.setRenderMode(value);},setDensity(value){wind?.setParticleCount(Number(value));},
    setHeight(value){wind?.setDisplayHeight(Number(value));},setThreshold(value){wind?.setSpeedThreshold(Number(value));},
    setWeatherFrame(index){return wind?.setFrame(index);},
    clearCrop(){wind?.clearCropBounds();cropHandler?.destroy();cropHandler=null;if(cropPolygon)viewer.entities.remove(cropPolygon);cropPolygon=null;},
    home(){canvas.style.opacity='1';home();},
    destroy(){disposed=true;cancelAnimationFrame(animation);cropHandler?.destroy();cameraControls.destroy();wind?.destroy();cache.clear();viewer.destroy();},
  };
}

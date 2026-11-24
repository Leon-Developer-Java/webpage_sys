// The source data remain WGS84. Only the GCJ02 basemap's imagery projection is adapted.
const A=6378245,EE=.006693421622965943;
export function wgsToGcj(lon,lat){
  if(lon<72.004||lon>137.8347||lat<.8293||lat>55.8271)return [lon,lat];
  const x=lon-105,y=lat-35,p=Math.PI;
  let dlat=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
  dlat+=(20*Math.sin(6*x*p)+20*Math.sin(2*x*p))*2/3;
  dlat+=(20*Math.sin(y*p)+40*Math.sin(y/3*p))*2/3;
  dlat+=(160*Math.sin(y/12*p)+320*Math.sin(y*p/30))*2/3;
  let dlon=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  dlon+=(20*Math.sin(6*x*p)+20*Math.sin(2*x*p))*2/3;
  dlon+=(20*Math.sin(x*p)+40*Math.sin(x/3*p))*2/3;
  dlon+=(150*Math.sin(x/12*p)+300*Math.sin(x/30*p))*2/3;
  const rad=lat/180*p,magic=1-EE*Math.sin(rad)**2;
  return [lon+dlon*180/(A/Math.sqrt(magic)*Math.cos(rad)*p),lat+dlat*180/(A*(1-EE)/(magic*Math.sqrt(magic))*p)];
}
export function gcjToWgs(lon,lat){
  let x=lon,y=lat;
  for(let i=0;i<5;i++){const [a,b]=wgsToGcj(x,y);x-=a-lon;y-=b-lat;}
  return [x,y];
}
export function imageryScheme(C,gcj){
  const scheme=new C.WebMercatorTilingScheme();
  if(!gcj)return scheme;
  const original=scheme.projection,project=original.project.bind(original),unproject=original.unproject.bind(original);
  // Cesium's imagery tiling scheme owns its projection. Terrain stays on its original geographic scheme.
  scheme.projection.project=(cartographic,result)=>{
    const [lon,lat]=wgsToGcj(C.Math.toDegrees(cartographic.longitude),C.Math.toDegrees(cartographic.latitude));
    return project(C.Cartographic.fromDegrees(lon,lat,cartographic.height),result);
  };
  scheme.projection.unproject=(cartesian,result)=>{
    const value=unproject(cartesian,result);
    const [lon,lat]=gcjToWgs(C.Math.toDegrees(value.longitude),C.Math.toDegrees(value.latitude));
    value.longitude=C.Math.toRadians(lon);value.latitude=C.Math.toRadians(lat);return value;
  };
  return scheme;
}

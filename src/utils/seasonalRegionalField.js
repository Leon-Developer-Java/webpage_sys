export function valueText(value) {
  if(typeof value!=='number' || !Number.isFinite(value))return '缺测';
  if(value===0)return '0';
  return Number(value.toPrecision(3)).toString();
}
export function fieldScale(data,mode,range) {
  const values=data.series.flatMap(frame=>frame.values.flat()).filter(v=>typeof v==='number' && Number.isFinite(v));
  if(!values.length)return null;
  const min=values.reduce((a,b)=>Math.min(a,b),Infinity),max=values.reduce((a,b)=>Math.max(a,b),-Infinity);
  let low=min,high=max;
  if(mode==='product' && Number.isFinite(range?.min) && Number.isFinite(range?.max) && range.max>range.min){low=range.min;high=range.max;}
  else if(data.result_type==='probability'){low=0;high=100;}
  else if(data.result_type==='anomaly'){high=Math.max(Math.abs(min),Math.abs(max));low=-high;}
  const constant=min===max;
  const stops=data.result_type==='anomaly' ? ['#9a3412','#fb923c','#f8fafc','#38bdf8','#075985'] : ['#eff6ff','#38bdf8','#22c55e','#facc15','#ef4444'];
  return {min:low,max:high,actualMin:min,actualMax:max,constant,stops,
    gradient:`linear-gradient(to right, ${stops.join(',')})`,
    ticks:low===high ? [valueText(low)] : Array.from({length:5},(_,i)=>valueText(low+(high-low)*i/4))};
}
export function fieldColor(value,scale) {
  if(value===null || !Number.isFinite(value) || !scale)return 'transparent';
  const t=scale.max===scale.min ? .5 : Math.max(0,Math.min(1,(value-scale.min)/(scale.max-scale.min)));
  const p=t*(scale.stops.length-1),i=Math.min(scale.stops.length-2,Math.floor(p)),f=p-i;
  const rgb=hex=>[1,3,5].map(at=>parseInt(hex.slice(at,at+2),16));
  const a=rgb(scale.stops[i]),b=rgb(scale.stops[i+1]);
  return `rgb(${a.map((v,j)=>Math.round(v+(b[j]-v)*f)).join(',')})`;
}
export function regionCells(data,index) {
  const frame=data?.series?.[index];if(!frame)return [];
  const [w,s,e,n]=data.bbox,dx=data.grid_spacing.longitude,dy=data.grid_spacing.latitude;
  if(!(dx>0 && dy>0))return [];
  return data.latitudes.flatMap((lat,y)=>data.longitudes.map((lon,x)=>({longitude:lon,latitude:lat,value:frame.values[y][x],
    bbox:[Math.max(w,lon-dx/2),Math.max(s,lat-dy/2),Math.min(e,lon+dx/2),Math.min(n,lat+dy/2)]})));
}

export function seasonalGridSpacing(layer = {}) {
  const extent=layer.extent, grid=layer.grid;
  if (Array.isArray(extent) && grid?.nx>1 && grid?.ny>1) {
    const x=(extent[2]-extent[0])/(grid.nx-1), y=(extent[3]-extent[1])/(grid.ny-1);
    if (Number.isFinite(x) && Number.isFinite(y) && x>0 && y>0) return {longitude:x,latitude:y};
  }
  return null;
}

export function regionalViewExtent(region) {
  return [...region.bbox];
}

export function pointInRegion(longitude, latitude, region) {
  const [w,s,e,n]=region.bbox;
  return Number.isFinite(longitude) && Number.isFinite(latitude) && w<=longitude && longitude<=e && s<=latitude && latitude<=n;
}

/** North-up equirectangular image window; the geographic output is exact. */
export function seasonalRasterWindow(extent, bbox, width, height) {
  const valid = box => Array.isArray(box) && box.length===4 && box.every(Number.isFinite) &&
    -180<=box[0] && box[0]<box[2] && box[2]<=180 && -90<=box[1] && box[1]<box[3] && box[3]<=90;
  if (!valid(extent) || !valid(bbox) || !Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1) throw new Error('区域图像坐标无效。');
  const [w,s,e,n]=extent, [left,bottom,right,top]=bbox;
  if (left<w || right>e || bottom<s || top>n) throw new Error('该图像未覆盖指定范围，未显示其他地区的降水。');
  const sx=(left-w)/(e-w)*width, sy=(n-top)/(n-s)*height;
  const sw=(right-left)/(e-w)*width, sh=(top-bottom)/(n-s)*height;
  return {sx,sy,sw,sh,width:Math.max(1,Math.ceil(sw)),height:Math.max(1,Math.ceil(sh)),extent:[...bbox]};
}

/** Null values stay null and break the curve, never becoming zero rain. */
export function pointSeriesChart(series, width=560, height=115) {
  const finite=series.map(item=>item.value).filter(value=>typeof value==='number' && Number.isFinite(value));
  if (!finite.length) return {points:[],segments:[],minimum:null,maximum:null};
  let minimum=Math.min(...finite),maximum=Math.max(...finite);
  const delta=maximum-minimum || Math.max(Math.abs(maximum)*.1,.1);
  minimum-=delta*.15;maximum+=delta*.15;
  const points=series.map((item,index)=> typeof item.value==='number' && Number.isFinite(item.value) ? {
    x:series.length===1?width/2:16+index*(width-32)/(series.length-1),
    y:12+(maximum-item.value)/(maximum-minimum)*(height-24),value:item.value,index,
  }:null);
  const segments=[];let segment=[];
  for (const point of points) {
    if (point) segment.push(`${point.x},${point.y}`);
    else if (segment.length) {segments.push(segment.join(' '));segment=[];}
  }
  if (segment.length) segments.push(segment.join(' '));
  return {points:points.filter(Boolean),segments,minimum,maximum};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonalGridSpacing,regionalViewExtent,pointSeriesChart,pointInRegion,seasonalRasterWindow} from '../src/utils/seasonalGridView.js';
const layer={extent:[-180,-90,179,90],grid:{nx:360,ny:181}};
const region={name:'南京',bbox:[118.3667,31.2333,119.2333,32.6167]};

test('coarse grids keep the exact requested region instead of expanding the viewport',()=>{
  assert.deepEqual(seasonalGridSpacing(layer),{longitude:1,latitude:1});
  assert.deepEqual(regionalViewExtent(region,layer),region.bbox);
  assert.notEqual(regionalViewExtent(region),region.bbox);
  assert.equal(seasonalGridSpacing({}),null);
});

test('regional image window preserves north-up position and exact geographic bounds',()=>{
  const crop=seasonalRasterWindow([-180,-90,180,90],[110,20,120,30],3600,1800);
  assert.deepEqual(crop,{sx:2900,sy:600,sw:100,sh:100,width:100,height:100,extent:[110,20,120,30]});
  const tiny=seasonalRasterWindow([-180,-90,180,90],[118.2,31.1,118.3,31.2],360,180);
  assert.equal(tiny.width,1);assert.equal(tiny.height,1);
  assert.deepEqual(tiny.extent,[118.2,31.1,118.3,31.2]);
  assert.equal(pointInRegion(119,32,region),true);
  assert.equal(pointInRegion(120,32,region),false);
  assert.equal(pointInRegion(NaN,32,region),false);
});

test('invalid or uncovered regional raster requests fail without a global fallback',()=>{
  for (const bbox of [[120,30,110,40],[-181,0,10,1],[110,20,120,NaN],[110,20,170,30]]) {
    assert.throws(()=>seasonalRasterWindow([100,0,160,60],bbox,600,600));
  }
  assert.throws(()=>seasonalRasterWindow([-180,-90,180,90],region.bbox,0,180));
});
test('chart preserves missing values as gaps and supports a single season window',()=>{
  const data=[{value:1},{value:null},{value:3}];
  const result=pointSeriesChart(data);
  assert.equal(result.points.length,2);
  assert.equal(result.segments.length,2);
  assert.equal(pointSeriesChart([{value:33.3}]).points.length,1);
  assert.equal(pointSeriesChart([{value:null}]).points.length,0);
  assert.equal(data[1].value,null);
});

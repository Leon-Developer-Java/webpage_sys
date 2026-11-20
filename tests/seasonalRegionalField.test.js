import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldScale,fieldColor,valueText,regionCells} from '../src/utils/seasonalRegionalField.js';
const data={result_type:'anomaly',bbox:[115.5,38.5,117.5,40.5],longitudes:[116,117],latitudes:[40,39],grid_spacing:{longitude:1,latitude:1},series:[{values:[[-.02,.01],[null,.04]]},{values:[[-.03,0],[.01,.05]]}]};
test('regional scale uses actual original values over all chosen months, with anomaly zero centered',()=>{
  const scale=fieldScale(data,'regional',{min:-1,max:1});
  assert.equal(scale.min,-.05);assert.equal(scale.max,.05);
  assert.ok(scale.ticks.includes('0.025'));
  assert.notEqual(fieldColor(-.02,scale),fieldColor(.01,scale));
  assert.equal(fieldColor(null,scale),'transparent');
  assert.equal(fieldScale(data,'product',{min:-1,max:1}).max,1);
  assert.equal(regionCells(data,0)[0].latitude,40);
  assert.deepEqual(regionCells(data,0)[0].bbox,[115.5,39.5,116.5,40.5]);
});
test('constant/absent values stay honest and small decimals remain readable',()=>{
  const scale=fieldScale({...data,result_type:'precipitation',series:[{values:[[.012,.012]]}]},'regional');
  assert.equal(scale.constant,true);assert.deepEqual(scale.ticks,['0.012']);
  assert.equal(fieldScale({...data,series:[{values:[[null]]}]},'regional'),null);
  assert.equal(valueText(-.00342),'-0.00342');
  const probability=fieldScale({...data,result_type:'probability'},'regional');
  assert.equal(probability.min,0);assert.equal(probability.max,100);
});

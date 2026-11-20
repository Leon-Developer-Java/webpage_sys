import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSeasonalMapSelection,seasonalMapFrames} from '../src/utils/seasonalMapSelection.js';

const resource={data_type:'SEASONAL_PRECIP',meta:{variable_layers:{prob_norm:{frames:[
  {valid_time:'2026-10-01T00:00:00.000000000'}, {valid_time:'2026-11-01T00:00:00.000000000'},
]}}}};
test('inline map keeps the exact requested nonfirst variable and UTC frame',()=>{
  assert.deepEqual(resolveSeasonalMapSelection(resource,'prob_norm','2026-11-01T08:00:00+08:00'),{variableKey:'prob_norm',frameIndex:1});
});
test('inline map rejects missing variables/times and nonseasonal resources without fallback',()=>{
  assert.throws(()=>resolveSeasonalMapSelection(resource,'prob_above','2026-11-01T00:00:00Z'));
  assert.throws(()=>resolveSeasonalMapSelection(resource,'prob_norm','2027-11-01T00:00:00Z'));
  assert.throws(()=>resolveSeasonalMapSelection({...resource,data_type:'RADAR'},'prob_norm','2026-11-01T00:00:00Z'));
});

test('regional view filters exact requested months and refuses missing coverage',()=>{
  const snapshot=structuredClone(resource);
  const scoped={...resource,meta:{...resource.meta,extent:[-180,-90,179,90]}};
  const times=['2026-11-01T00:00:00Z'];
  const region={name:'南京',bbox:[118.36,31.23,119.24,32.62]};
  assert.equal(resolveSeasonalMapSelection(scoped,'prob_norm',times[0],times,region).frameIndex,0);
  assert.equal(seasonalMapFrames(scoped.meta.variable_layers.prob_norm,times).length,1);
  assert.throws(()=>resolveSeasonalMapSelection({...scoped,meta:{...scoped.meta,extent:[-180,-90,0,90]}},'prob_norm',times[0],times,region));
  assert.throws(()=>seasonalMapFrames(scoped.meta.variable_layers.prob_norm,[...times,'2027-01-01T00:00:00Z']));
  assert.deepEqual(resource,snapshot);
});

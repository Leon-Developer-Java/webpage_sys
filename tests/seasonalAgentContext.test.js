import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonalAgentContext,seasonalAgentQuery,seasonalContextFromQuery} from '../src/utils/seasonalAgentContext.js';
const selection={fileUuid:'12345678-1234-1234-1234-123456789012',variableKey:'prob_norm',validTime:'2026-11-01T00:00:00Z'};
test('agent handoff retains the selected frame, without embedding credentials or statistics',()=>{
  const safe=seasonalAgentContext({...selection,token:'secret-token',mean:22});
  assert.equal(safe.validTime,'2026-11-01T00:00:00.000Z');
  assert.equal(safe.variableKey,'prob_norm');
  assert.ok(!JSON.stringify(safe).includes('secret-token'));
  assert.deepEqual(seasonalContextFromQuery(seasonalAgentQuery(safe)),safe);
});
test('bad UUID, missing variable and invalid times are rejected',()=>{
  assert.equal(seasonalAgentContext({...selection,fileUuid:'../../file'}),null);
  assert.equal(seasonalAgentContext({...selection,variableKey:''}),null);
  assert.equal(seasonalAgentContext({...selection,validTime:'bad'}),null);
  assert.deepEqual(seasonalAgentQuery({topic:'products'}),{seasonal_topic:'products'});
});

test('regional map bridge preserves bounds and selected months but drops client statistics',()=>{
  const safe=seasonalAgentContext({...selection,region:{name:'南京',bbox:[118.36,31.23,119.24,32.62],mean:99},validTimes:['2026-11-01T00:00:00Z','2026-12-01T00:00:00Z','2027-01-01T00:00:00Z']});
  assert.deepEqual(seasonalContextFromQuery(seasonalAgentQuery(safe)),safe);
  assert.equal(safe.region.name,'南京');
  assert.equal(safe.validTimes.length,3);
  assert.equal(safe.region.mean,undefined);
  assert.equal(seasonalAgentContext({...safe,region:{bbox:[119,32,118,33]}}),null);
  assert.equal(seasonalAgentContext({...safe,validTimes:['2027-02-01T00:00:00Z']}),null);
});

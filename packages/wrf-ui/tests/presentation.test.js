import assert from 'node:assert/strict';
import test from 'node:test';
import {unitPresentation,formatDisplayValue,paletteGradient} from '../src/presentation.js';

test('native metadata stays intact while both endpoints use the same affine unit transform',()=>{
  const v={name:'T2',units:'K'},p=unitPresentation(v);
  assert.equal(formatDisplayValue(291.7265692138672,p),'18.6');
  assert.equal(formatDisplayValue(300.6924938964844,p),'27.5');
  assert.equal(p.unit,'°C');assert.equal(v.units,'K');
  assert.equal(formatDisplayValue(291.7265692138672,unitPresentation(v,true)),'291.7');
  assert.equal(formatDisplayValue(101325,unitPresentation({name:'PSFC',units:'Pa'})),'1013.3');
});
test('display formatting handles missing, negative zero, unknown units and physical variable identity',()=>{
  const p=unitPresentation({name:'V10',units:'m s-1'});
  assert.equal(p.unit,'m/s');assert.equal(formatDisplayValue(-0.00001,p),'-1.00e-5');
  for(const value of [null,undefined,NaN,Infinity,'123'])assert.equal(formatDisplayValue(value,p),'—');
  assert.equal(unitPresentation({name:'OTHER',units:'K'}).unit,'K');
  assert.equal(formatDisplayValue(0,p),'0');
});
test('legend uses only the exact published palette, rejecting malformed metadata',()=>{
  assert.equal(paletteGradient([[0,0,0],[255,255,255]]),'linear-gradient(to right,rgb(0,0,0),rgb(255,255,255))');
  for(const p of [null,[],[[0,0,0]],[[0,0,0],[256,0,0]]])assert.equal(paletteGradient(p),null);
});

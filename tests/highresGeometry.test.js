import test from 'node:test';
import assert from 'node:assert/strict';
import {highresDomains, highresReferencePoint} from '../src/utils/highresGeometry.js';
test('selected position maps exactly to d08 centre through every nested domain', () => {
  const ds = highresDomains();
  let {grid_x:x,grid_y:y} = highresReferencePoint();
  assert.ok(x > 1 && x < ds[0].e_we && y > 1 && y < ds[0].e_sn);
  for (const d of ds.slice(1)) {
    x = (x-d.parent_start_i)*d.parent_grid_ratio+1;
    y = (y-d.parent_start_j)*d.parent_grid_ratio+1;
    assert.ok(x > 1 && x < d.e_we && y > 1 && y < d.e_sn);
  }
  assert.ok(Math.abs(x-(ds.at(-1).e_we+1)/2)<1e-8);
  assert.ok(Math.abs(y-(ds.at(-1).e_sn+1)/2)<1e-8);
});

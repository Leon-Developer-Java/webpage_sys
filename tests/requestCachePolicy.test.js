import test from 'node:test';
import assert from 'node:assert/strict';
import { requestCacheMode } from '../src/utils/requestCachePolicy.js';

test('authenticated API reads avoid stale task and evidence state', () => {
  for (const url of ['/api/wrf/evidence?offset=0', '/api/wrf/tasks/id', 'http://localhost:8007/api/wrf/evidence/id', '/api/health']) {
    assert.equal(requestCacheMode(url), 'no-store');
    assert.equal(requestCacheMode(url, { method: 'head' }), 'no-store');
  }
});
test('explicit caller cache policy is preserved', () => {
  for (const cache of ['default', 'reload', 'no-cache', 'force-cache', 'no-store', 'only-if-cached']) {
    assert.equal(requestCacheMode('/api/wrf/tasks', { cache }), cache);
  }
});
test('static products and non-API paths keep browser defaults', () => {
  for (const url of ['/data/WRF/frame.webp', '/assets/app.js', '/apiary', '/wrf?redirect=/api/tasks', 'http://[invalid']) {
    assert.equal(requestCacheMode(url), undefined);
  }
});
test('mutations are not assigned a read cache policy', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(requestCacheMode('/api/agent/wrf/evidence', { method }), undefined);
  }
});

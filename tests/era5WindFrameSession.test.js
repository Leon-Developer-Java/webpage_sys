import test from "node:test";
import assert from "node:assert/strict";

import { createEra5WindFrameSession } from "../src/utils/era5WindFrameSession.js";
import { createEra5WindFieldCache } from "../src/utils/era5WindFieldCache.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function lease(name, releaseCalls) {
  return {
    key: name,
    namespace: "dataset",
    revision: "revision",
    field: { name },
    release() {
      releaseCalls.push(name);
    },
  };
}

function windDescriptor() {
  return {
    schema_version: "1.0",
    available: true,
    product: "10m_wind",
    components: { u: "u10", v: "v10" },
    unit: "m/s",
    times: ["2025-07-01T00:00"],
    grid: {
      crs: "EPSG:4326",
      width: 2,
      height: 2,
      extent: [100, 20, 101, 21],
      origin: "north_west",
      scan_order: "row_major",
      row_order: "north_to_south",
      column_order: "west_to_east",
      grid_registration: "cell_center",
      lon_step: 1,
      lat_step: 1,
      periodic_longitude: false,
    },
    encoding: {
      dtype: "float32",
      byte_order: "little",
      layout: "component_separated",
      array_order: "C",
      bytes_per_value: 4,
      nodata: -999999,
      invalid_when_either_component_is_nodata: true,
    },
    frames: [{
      index: 0,
      time: "2025-07-01T00:00",
      u_url: "/data/ERA5/u0.float32",
      v_url: "/data/ERA5/v0.float32",
      component_byte_length: 16,
    }],
  };
}

function float32Response(values) {
  const buffer = new ArrayBuffer(values.length * 4);
  const view = new DataView(buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return {
    ok: true,
    status: 200,
    async arrayBuffer() {
      return buffer;
    },
  };
}

test("connects the real binary cache to a current decoded frame lease", async () => {
  const cache = createEra5WindFieldCache();
  const session = createEra5WindFrameSession({
    acquire: (...args) => cache.acquire(...args),
  });
  const calls = [];
  const result = await session.load(
    windDescriptor(),
    0,
    {
      apiBase: "http://127.0.0.1:8002",
      namespace: "dataset",
      revision: "generated-at",
      fetcher: async url => {
        calls.push(url);
        return new URL(url).pathname.includes("/u")
          ? float32Response([1, 2, 3, 4])
          : float32Response([10, 20, 30, 40]);
      },
    },
  );

  assert.equal(result.status, "ready");
  assert.deepEqual([...result.field.u], [1, 2, 3, 4]);
  assert.deepEqual([...result.field.v], [10, 20, 30, 40]);
  assert.equal(session.currentField, result.field);
  assert.equal(calls.length, 2);
  session.dispose();
  cache.clear({ force: true });
});

test("a slow old request cannot overwrite a newer ready frame", async () => {
  const pending = [];
  const releaseCalls = [];
  const session = createEra5WindFrameSession({
    acquire: (_wind, frameIndex, options) => {
      const request = deferred();
      pending.push({ frameIndex, signal: options.signal, ...request });
      return request.promise;
    },
  });

  const oldLoad = session.load({}, 0);
  const newLoad = session.load({}, 1);
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(pending[1].signal.aborted, false);

  pending[1].resolve(lease("new", releaseCalls));
  const newResult = await newLoad;
  assert.equal(newResult.status, "ready");
  assert.equal(session.currentField.name, "new");

  pending[0].resolve(lease("old", releaseCalls));
  const oldResult = await oldLoad;
  assert.equal(oldResult.status, "stale");
  assert.equal(session.currentField.name, "new");
  assert.deepEqual(releaseCalls, ["old"]);
  session.dispose();
  assert.deepEqual(releaseCalls, ["old", "new"]);
});

test("keeps the current frame until the replacement is ready", async () => {
  const replacement = deferred();
  const releaseCalls = [];
  let requestCount = 0;
  const session = createEra5WindFrameSession({
    acquire: async () => {
      requestCount += 1;
      if (requestCount === 1) return lease("first", releaseCalls);
      return replacement.promise;
    },
  });

  await session.load({}, 0);
  const nextLoad = session.load({}, 1);
  assert.equal(session.currentField.name, "first");
  assert.deepEqual(releaseCalls, []);

  replacement.resolve(lease("second", releaseCalls));
  const result = await nextLoad;
  assert.equal(result.status, "ready");
  assert.equal(session.currentField.name, "second");
  assert.deepEqual(releaseCalls, ["first"]);
  session.dispose();
});

test("a real replacement failure clears a now-misleading old frame", async () => {
  const releaseCalls = [];
  let requestCount = 0;
  const session = createEra5WindFrameSession({
    acquire: async () => {
      requestCount += 1;
      if (requestCount === 1) return lease("first", releaseCalls);
      throw new Error("network failed");
    },
  });

  await session.load({}, 0);
  await assert.rejects(session.load({}, 1), /network failed/);
  assert.equal(session.currentField, null);
  assert.deepEqual(releaseCalls, ["first"]);
});

test("cancel and dispose abort pending work and release leases exactly once", async () => {
  const releaseCalls = [];
  const pending = deferred();
  let pendingSignal;
  const session = createEra5WindFrameSession({
    acquire: async (_wind, frameIndex, options) => {
      if (frameIndex === 0) return lease("current", releaseCalls);
      pendingSignal = options.signal;
      return pending.promise;
    },
  });

  await session.load({}, 0);
  const loading = session.load({}, 1);
  session.cancel({ releaseCurrent: true });
  assert.equal(pendingSignal.aborted, true);
  assert.equal(session.currentField, null);
  assert.deepEqual(releaseCalls, ["current"]);
  pending.resolve(lease("late", releaseCalls));
  assert.equal((await loading).status, "stale");
  assert.deepEqual(releaseCalls, ["current", "late"]);
  session.dispose();
  session.dispose();
  assert.deepEqual(releaseCalls, ["current", "late"]);
});

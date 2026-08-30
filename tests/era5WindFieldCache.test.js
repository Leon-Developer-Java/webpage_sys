import test from "node:test";
import assert from "node:assert/strict";

import {
  Era5WindFieldError,
  createEra5WindFieldCache,
  era5WindDisplayRange,
  era5WindPalette,
  era5WindSpeedVariableName,
  resolveEra5WindAssetUrl,
  shouldDisplayEra5WindParticles,
  validateEra5WindFrame,
} from "../src/utils/era5WindFieldCache.js";

const API_BASE = "http://127.0.0.1:8002";
const NODATA = -999999;

function descriptor(frameCount = 1) {
  const times = Array.from({ length: frameCount }, (_, index) => "2025-07-01T0" + index + ":00");
  return {
    schema_version: "1.0",
    available: true,
    product: "10m_wind",
    components: { u: "u10", v: "v10" },
    unit: "m/s",
    speed_variable: "ws10",
    display_range: { min: 0, max: 30 },
    palette: ["#2563eb", "#0891b2", "#16a34a", "#facc15", "#dc2626"],
    times,
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
      nodata: NODATA,
      invalid_when_either_component_is_nodata: true,
    },
    frames: times.map((time, index) => ({
      index,
      time,
      u_url: "/data/ERA5/u" + index + ".float32",
      v_url: "/data/ERA5/v" + index + ".float32",
      component_byte_length: 16,
    })),
  };
}

test("shows particles only for the derived wind-speed variable and shares its style", () => {
  const wind = descriptor();
  assert.equal(era5WindSpeedVariableName(wind), "ws10");
  assert.equal(shouldDisplayEra5WindParticles("ws10", wind), true);
  assert.equal(shouldDisplayEra5WindParticles("u10", wind), false);
  assert.equal(shouldDisplayEra5WindParticles("v10", wind), false);
  assert.equal(shouldDisplayEra5WindParticles("t2m", wind), false);
  assert.deepEqual(era5WindDisplayRange(wind), { min: 0, max: 30 });
  assert.deepEqual(era5WindPalette(wind), wind.palette);

  assert.equal(shouldDisplayEra5WindParticles("ws10", { available: false }), false);
  assert.deepEqual(era5WindDisplayRange({ display_range: { min: -10, max: 20 } }), {
    min: 0,
    max: 30,
  });
});

function float32Buffer(values) {
  const buffer = new ArrayBuffer(values.length * 4);
  const view = new DataView(buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return buffer;
}

function binaryResponse(values, { ok = true, status = 200 } = {}) {
  const buffer = values instanceof ArrayBuffer ? values : float32Buffer(values);
  return {
    ok,
    status,
    async arrayBuffer() {
      return buffer;
    },
  };
}

function valuesForUrl(url) {
  const path = new URL(url).pathname;
  const indexMatch = path.match(/(\d+)\.float32$/);
  const index = Number(indexMatch?.[1] || 0);
  return path.includes("/u")
    ? [1 + index, 2 + index, 3 + index, 4 + index]
    : [10 + index, 20 + index, 30 + index, 40 + index];
}

function workingFetcher(calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    return binaryResponse(valuesForUrl(url));
  };
}

function acquireOptions(fetcher, overrides = {}) {
  return {
    apiBase: API_BASE,
    namespace: "dataset-a",
    revision: "generated-at-1",
    fetcher,
    ...overrides,
  };
}

test("validates the ERA5 contract and adds a revision to asset URLs", () => {
  const wind = descriptor();
  const contract = validateEra5WindFrame(wind, 0, acquireOptions(workingFetcher()));
  assert.equal(contract.expectedByteLength, 16);
  assert.equal(contract.grid.width, 2);
  assert.equal(new URL(contract.uUrl).pathname, "/data/ERA5/u0.float32");
  assert.equal(new URL(contract.uUrl).searchParams.get("era5_rev"), "generated-at-1");
  assert.equal(
    resolveEra5WindAssetUrl("/data/ERA5/u0.float32", {
      apiBase: API_BASE,
      revision: "revision 2",
    }),
    "http://127.0.0.1:8002/data/ERA5/u0.float32?era5_rev=revision+2",
  );

  const invalid = descriptor();
  invalid.encoding.byte_order = "big";
  assert.throws(
    () => validateEra5WindFrame(invalid, 0, acquireOptions(workingFetcher())),
    error => error instanceof Era5WindFieldError && error.code === "ENCODING_BYTE_ORDER_INVALID",
  );
});

test("downloads U and V concurrently and decodes little-endian Float32 values", async () => {
  const wind = descriptor();
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return new URL(url).pathname.includes("/u")
      ? binaryResponse([1.25, NODATA, -3.5, NODATA])
      : binaryResponse([4.5, NODATA, 6.75, NODATA]);
  };
  const cache = createEra5WindFieldCache();
  const lease = await cache.acquire(wind, 0, acquireOptions(fetcher));

  assert.equal(calls.length, 2);
  assert.deepEqual([...lease.field.u], [1.25, NODATA, -3.5, NODATA]);
  assert.deepEqual([...lease.field.v], [4.5, NODATA, 6.75, NODATA]);
  assert.equal(lease.field.validCount, 2);
  assert.equal(lease.field.invalidCount, 2);
  assert.equal(lease.field.byteLength, 32);
  assert.equal(calls[0].options.cache, "force-cache");
  assert.equal(calls[0].options.headers.Accept, "application/octet-stream");
  lease.release();
});

test("rejects mismatched nodata masks and non-finite component values", async () => {
  const wind = descriptor();
  const mismatchCache = createEra5WindFieldCache();
  await assert.rejects(
    mismatchCache.acquire(
      wind,
      0,
      acquireOptions(async url =>
        new URL(url).pathname.includes("/u")
          ? binaryResponse([1, NODATA, 3, 4])
          : binaryResponse([10, 20, 30, 40])),
    ),
    error => error.code === "NODATA_MASK_MISMATCH",
  );
  assert.equal(mismatchCache.stats().entries, 0);

  const nonFiniteCache = createEra5WindFieldCache();
  await assert.rejects(
    nonFiniteCache.acquire(
      wind,
      0,
      acquireOptions(async url =>
        new URL(url).pathname.includes("/u")
          ? binaryResponse([1, Number.NaN, 3, 4])
          : binaryResponse([10, 20, 30, 40])),
    ),
    error => error.code === "NON_FINITE_COMPONENT",
  );
  assert.equal(nonFiniteCache.stats().entries, 0);
});

test("does not cache HTTP or byte-length failures and permits a retry", async () => {
  const wind = descriptor();
  const cache = createEra5WindFieldCache();
  await assert.rejects(
    cache.acquire(
      wind,
      0,
      acquireOptions(async url =>
        new URL(url).pathname.includes("/u")
          ? binaryResponse([], { ok: false, status: 503 })
          : binaryResponse([10, 20, 30, 40])),
    ),
    error => error.code === "HTTP_ERROR" && error.detail.status === 503,
  );
  assert.equal(cache.stats().entries, 0);

  await assert.rejects(
    cache.acquire(
      wind,
      0,
      acquireOptions(async () => binaryResponse([1, 2, 3])),
    ),
    error => error.code === "BYTE_LENGTH_MISMATCH",
  );
  assert.equal(cache.stats().entries, 0);

  const calls = [];
  const lease = await cache.acquire(wind, 0, acquireOptions(workingFetcher(calls)));
  assert.equal(calls.length, 2);
  lease.release();
});

test("deduplicates concurrent requests and returns reference-counted shared data", async () => {
  const wind = descriptor();
  const calls = [];
  const cache = createEra5WindFieldCache();
  const fetcher = workingFetcher(calls);
  const [first, second] = await Promise.all([
    cache.acquire(wind, 0, acquireOptions(fetcher)),
    cache.acquire(wind, 0, acquireOptions(fetcher)),
  ]);

  assert.equal(calls.length, 2);
  assert.equal(first.field, second.field);
  assert.equal(cache.stats().references, 2);
  first.release();
  first.release();
  assert.equal(cache.stats().references, 1);
  second.release();
  assert.equal(cache.stats().references, 0);
});

function deferredFetcher(pending) {
  return (url, { signal }) => new Promise((resolve, reject) => {
    const request = { url, signal, resolve, reject };
    pending.push(request);
    const onAbort = () => reject(signal.reason || new DOMException("cancelled", "AbortError"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

test("one caller can cancel without aborting another caller's shared download", async () => {
  const wind = descriptor();
  const cache = createEra5WindFieldCache();
  const pending = [];
  const fetcher = deferredFetcher(pending);
  const firstController = new AbortController();
  const secondController = new AbortController();
  const firstPromise = cache.acquire(
    wind,
    0,
    acquireOptions(fetcher, { signal: firstController.signal }),
  );
  const secondPromise = cache.acquire(
    wind,
    0,
    acquireOptions(fetcher, { signal: secondController.signal }),
  );
  assert.equal(pending.length, 2);

  const firstRejected = assert.rejects(firstPromise, error => error.name === "AbortError");
  firstController.abort();
  await firstRejected;
  assert.equal(pending[0].signal.aborted, false);
  assert.equal(cache.stats().waiters, 1);

  for (const request of pending) {
    request.resolve(binaryResponse(valuesForUrl(request.url)));
  }
  const secondLease = await secondPromise;
  assert.equal(secondLease.field.validCount, 4);
  secondLease.release();
});

test("the underlying U and V requests abort only after every waiter cancels", async () => {
  const wind = descriptor();
  const cache = createEra5WindFieldCache();
  const pending = [];
  const fetcher = deferredFetcher(pending);
  const firstController = new AbortController();
  const secondController = new AbortController();
  const firstPromise = cache.acquire(
    wind,
    0,
    acquireOptions(fetcher, { signal: firstController.signal }),
  );
  const secondPromise = cache.acquire(
    wind,
    0,
    acquireOptions(fetcher, { signal: secondController.signal }),
  );
  const firstRejected = assert.rejects(firstPromise, error => error.name === "AbortError");
  const secondRejected = assert.rejects(secondPromise, error => error.name === "AbortError");

  firstController.abort();
  assert.equal(pending[0].signal.aborted, false);
  secondController.abort();
  await Promise.all([firstRejected, secondRejected]);
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(pending[1].signal.aborted, true);
  assert.equal(cache.stats().entries, 0);

  const retryCalls = [];
  const retryLease = await cache.acquire(wind, 0, acquireOptions(workingFetcher(retryCalls)));
  assert.equal(retryCalls.length, 2);
  retryLease.release();
});

test("evicts least-recently-used unreferenced frames and protects active leases", async () => {
  const wind = descriptor(3);
  const calls = [];
  const fetcher = workingFetcher(calls);
  const cache = createEra5WindFieldCache({ maxBytes: 1024, maxEntries: 2 });

  const zero = await cache.acquire(wind, 0, acquireOptions(fetcher));
  zero.release();
  const one = await cache.acquire(wind, 1, acquireOptions(fetcher));
  one.release();
  const zeroAgain = await cache.acquire(wind, 0, acquireOptions(fetcher));
  zeroAgain.release();
  const two = await cache.acquire(wind, 2, acquireOptions(fetcher));
  two.release();
  assert.equal(calls.length, 6);
  assert.equal(cache.stats().readyEntries, 2);

  const oneAgain = await cache.acquire(wind, 1, acquireOptions(fetcher));
  assert.equal(calls.length, 8);
  const zeroHeld = await cache.acquire(wind, 0, acquireOptions(fetcher));
  cache.setLimits({ maxBytes: 31, maxEntries: 1 });
  assert.equal(cache.stats().referencedEntries, 2);
  assert.equal(cache.stats().readyEntries, 2);
  oneAgain.release();
  assert.equal(cache.stats().readyEntries, 1);
  zeroHeld.release();
});

test("isolates cache entries by dataset namespace and generated revision", async () => {
  const wind = descriptor();
  const calls = [];
  const fetcher = workingFetcher(calls);
  const cache = createEra5WindFieldCache();

  const first = await cache.acquire(
    wind,
    0,
    acquireOptions(fetcher, { namespace: "dataset-a", revision: "rev-1" }),
  );
  first.release();
  const second = await cache.acquire(
    wind,
    0,
    acquireOptions(fetcher, { namespace: "dataset-b", revision: "rev-1" }),
  );
  second.release();
  const third = await cache.acquire(
    wind,
    0,
    acquireOptions(fetcher, { namespace: "dataset-a", revision: "rev-2" }),
  );
  third.release();

  assert.equal(calls.length, 6);
  assert.deepEqual(
    calls.map(call => new URL(call.url).searchParams.get("era5_rev")),
    ["rev-1", "rev-1", "rev-1", "rev-1", "rev-2", "rev-2"],
  );
  assert.equal(cache.clear({ namespace: "dataset-a" }), 2);
  assert.equal(cache.stats().entries, 1);
  assert.equal(cache.clear({ force: true }), 1);
  assert.equal(cache.stats().readyBytes, 0);
});

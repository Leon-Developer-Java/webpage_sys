const DEFAULT_API_BASE = import.meta.env?.VITE_API_BASE || "http://127.0.0.1:8002";
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 3;
const REVISION_QUERY_KEY = "era5_rev";
const DEFAULT_WIND_PALETTE = Object.freeze([
  "#2563eb",
  "#0891b2",
  "#16a34a",
  "#facc15",
  "#dc2626",
]);

const HOST_IS_LITTLE_ENDIAN = (() => {
  const buffer = new ArrayBuffer(4);
  new Uint32Array(buffer)[0] = 0x01020304;
  return new Uint8Array(buffer)[0] === 0x04;
})();

export class Era5WindFieldError extends Error {
  constructor(code, message, detail = {}, cause) {
    super(message);
    this.name = "Era5WindFieldError";
    this.code = code;
    this.detail = detail;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, message, detail = {}, cause) {
  throw new Era5WindFieldError(code, message, detail, cause);
}

function requireObject(value, code, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, label + " must be an object");
  }
  return value;
}

function requireString(value, code, label) {
  if (typeof value !== "string" || !value.trim()) {
    fail(code, label + " must be a non-empty string");
  }
  return value;
}

function requirePositiveInteger(value, code, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(code, label + " must be a positive safe integer");
  }
  return value;
}

function requireFiniteNumber(value, code, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(code, label + " must be a finite number");
  }
  return value;
}

function requireExact(value, expected, code, label) {
  if (value !== expected) {
    fail(code, label + " must be " + String(expected), { expected, actual: value });
  }
}

function nearlyEqual(left, right) {
  const tolerance = Math.max(Math.abs(left), Math.abs(right), 1) * 1e-6;
  return Math.abs(left - right) <= tolerance;
}

export function era5WindSpeedVariableName(windFieldValue) {
  if (!windFieldValue || typeof windFieldValue !== "object" || windFieldValue.available !== true) {
    return "";
  }
  const value = windFieldValue.speed_variable;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function shouldDisplayEra5WindParticles(selectedVariable, windFieldValue) {
  const selected = typeof selectedVariable === "string"
    ? selectedVariable.trim().toLowerCase()
    : "";
  const speedVariable = era5WindSpeedVariableName(windFieldValue);
  return !!selected && !!speedVariable && selected === speedVariable;
}

export function era5WindDisplayRange(windFieldValue, fallbackMaximum = 30) {
  const fallback = Math.max(0.001, Number(fallbackMaximum) || 30);
  const range = windFieldValue?.display_range;
  const minimum = Number(range?.min);
  const maximum = Number(range?.max);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum !== 0 || maximum <= minimum) {
    return Object.freeze({ min: 0, max: fallback });
  }
  return Object.freeze({ min: minimum, max: maximum });
}

export function era5WindPalette(windFieldValue) {
  const palette = windFieldValue?.palette;
  if (
    !Array.isArray(palette)
    || palette.length !== 5
    || palette.some(color => typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))
  ) {
    return DEFAULT_WIND_PALETTE;
  }
  return Object.freeze([...palette]);
}

function normalizeBaseUrl(apiBase) {
  const value = requireString(apiBase, "API_BASE_INVALID", "apiBase");
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    fail("API_BASE_INVALID", "apiBase is not a valid URL", { value }, error);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail("API_BASE_INVALID", "apiBase must use HTTP or HTTPS", { value });
  }
  url.pathname = url.pathname.endsWith("/") ? url.pathname : url.pathname + "/";
  url.search = "";
  url.hash = "";
  return url;
}

export function resolveEra5WindAssetUrl(
  value,
  { apiBase = DEFAULT_API_BASE, revision } = {},
) {
  const raw = requireString(value, "ASSET_URL_INVALID", "wind asset URL");
  if (raw.includes("\\") || raw.includes("\0")) {
    fail("ASSET_URL_INVALID", "wind asset URL contains unsupported characters", { value: raw });
  }

  let url;
  try {
    url = new URL(raw, normalizeBaseUrl(apiBase));
  } catch (error) {
    if (error instanceof Era5WindFieldError) throw error;
    fail("ASSET_URL_INVALID", "wind asset URL is invalid", { value: raw }, error);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail("ASSET_URL_INVALID", "wind asset URL must use HTTP or HTTPS", { value: raw });
  }
  if (url.username || url.password || url.hash) {
    fail("ASSET_URL_INVALID", "wind asset URL cannot contain credentials or a fragment", { value: raw });
  }
  if (!url.pathname.toLowerCase().endsWith(".float32")) {
    fail("ASSET_EXTENSION_INVALID", "wind asset URL must end with .float32", { value: raw });
  }
  if (revision !== undefined) {
    const revisionText = requireString(revision, "REVISION_INVALID", "revision");
    url.searchParams.set(REVISION_QUERY_KEY, revisionText);
  }
  return url.toString();
}

function validateGrid(gridValue) {
  const grid = requireObject(gridValue, "GRID_MISSING", "grid");
  requireExact(grid.crs, "EPSG:4326", "GRID_CRS_INVALID", "grid.crs");
  const width = requirePositiveInteger(grid.width, "GRID_WIDTH_INVALID", "grid.width");
  const height = requirePositiveInteger(grid.height, "GRID_HEIGHT_INVALID", "grid.height");
  if (width < 2 || height < 2) {
    fail("GRID_TOO_SMALL", "wind grid must contain at least two rows and columns", { width, height });
  }

  if (!Array.isArray(grid.extent) || grid.extent.length !== 4) {
    fail("GRID_EXTENT_INVALID", "grid.extent must contain west, south, east and north");
  }
  const extent = grid.extent.map((value, index) =>
    requireFiniteNumber(value, "GRID_EXTENT_INVALID", "grid.extent[" + index + "]"),
  );
  const [west, south, east, north] = extent;
  if (west >= east || south >= north) {
    fail("GRID_EXTENT_INVALID", "grid.extent bounds are reversed", { extent });
  }

  requireExact(grid.origin, "north_west", "GRID_ORIGIN_INVALID", "grid.origin");
  requireExact(grid.scan_order, "row_major", "GRID_SCAN_ORDER_INVALID", "grid.scan_order");
  requireExact(grid.row_order, "north_to_south", "GRID_ROW_ORDER_INVALID", "grid.row_order");
  requireExact(grid.column_order, "west_to_east", "GRID_COLUMN_ORDER_INVALID", "grid.column_order");
  requireExact(
    grid.grid_registration,
    "cell_center",
    "GRID_REGISTRATION_INVALID",
    "grid.grid_registration",
  );

  const lonStep = requireFiniteNumber(grid.lon_step, "GRID_LON_STEP_INVALID", "grid.lon_step");
  const latStep = requireFiniteNumber(grid.lat_step, "GRID_LAT_STEP_INVALID", "grid.lat_step");
  if (lonStep <= 0 || latStep <= 0) {
    fail("GRID_STEP_INVALID", "grid steps must be positive", { lonStep, latStep });
  }
  if (!nearlyEqual(east - west, lonStep * (width - 1))) {
    fail("GRID_LON_SPAN_INVALID", "longitude span does not match width and lon_step");
  }
  if (!nearlyEqual(north - south, latStep * (height - 1))) {
    fail("GRID_LAT_SPAN_INVALID", "latitude span does not match height and lat_step");
  }
  if (typeof grid.periodic_longitude !== "boolean") {
    fail("GRID_PERIODIC_FLAG_INVALID", "grid.periodic_longitude must be boolean");
  }
  if (grid.periodic_longitude && !nearlyEqual(lonStep * width, 360)) {
    fail("GRID_PERIODIC_SPAN_INVALID", "periodic longitude grid must cover 360 degrees");
  }

  const valueCount = width * height;
  if (!Number.isSafeInteger(valueCount)) {
    fail("GRID_SIZE_INVALID", "wind grid is too large");
  }
  return {
    crs: grid.crs,
    width,
    height,
    extent,
    origin: grid.origin,
    scanOrder: grid.scan_order,
    rowOrder: grid.row_order,
    columnOrder: grid.column_order,
    gridRegistration: grid.grid_registration,
    lonStep,
    latStep,
    periodicLongitude: grid.periodic_longitude,
    valueCount,
  };
}

function validateEncoding(encodingValue) {
  const encoding = requireObject(encodingValue, "ENCODING_MISSING", "encoding");
  requireExact(encoding.dtype, "float32", "ENCODING_DTYPE_INVALID", "encoding.dtype");
  requireExact(encoding.byte_order, "little", "ENCODING_BYTE_ORDER_INVALID", "encoding.byte_order");
  requireExact(
    encoding.layout,
    "component_separated",
    "ENCODING_LAYOUT_INVALID",
    "encoding.layout",
  );
  requireExact(encoding.array_order, "C", "ENCODING_ARRAY_ORDER_INVALID", "encoding.array_order");
  requireExact(
    encoding.bytes_per_value,
    4,
    "ENCODING_BYTES_PER_VALUE_INVALID",
    "encoding.bytes_per_value",
  );
  requireExact(
    encoding.invalid_when_either_component_is_nodata,
    true,
    "ENCODING_NODATA_POLICY_INVALID",
    "encoding.invalid_when_either_component_is_nodata",
  );
  const nodata = requireFiniteNumber(encoding.nodata, "ENCODING_NODATA_INVALID", "encoding.nodata");
  const nodata32 = Math.fround(nodata);
  if (!Number.isFinite(nodata32)) {
    fail("ENCODING_NODATA_INVALID", "encoding.nodata cannot be represented as Float32");
  }
  return {
    dtype: encoding.dtype,
    byteOrder: encoding.byte_order,
    layout: encoding.layout,
    arrayOrder: encoding.array_order,
    bytesPerValue: encoding.bytes_per_value,
    nodata,
    nodata32,
  };
}

export function validateEra5WindFrame(
  windFieldValue,
  frameIndex,
  {
    apiBase = DEFAULT_API_BASE,
    namespace = "ERA5",
    revision,
  } = {},
) {
  const windField = requireObject(windFieldValue, "WIND_FIELD_MISSING", "wind_field");
  requireExact(windField.available, true, "WIND_FIELD_UNAVAILABLE", "wind_field.available");
  requireExact(windField.schema_version, "1.0", "SCHEMA_VERSION_INVALID", "wind_field.schema_version");
  requireExact(windField.product, "10m_wind", "PRODUCT_INVALID", "wind_field.product");

  const components = requireObject(windField.components, "COMPONENTS_INVALID", "wind_field.components");
  if (requireString(components.u, "COMPONENTS_INVALID", "components.u").toLowerCase() !== "u10"
      || requireString(components.v, "COMPONENTS_INVALID", "components.v").toLowerCase() !== "v10") {
    fail("COMPONENTS_INVALID", "wind components must be u10 and v10");
  }
  requireExact(windField.unit, "m/s", "UNIT_INVALID", "wind_field.unit");

  const grid = validateGrid(windField.grid);
  const encoding = validateEncoding(windField.encoding);
  const expectedByteLength = grid.valueCount * encoding.bytesPerValue;
  if (!Number.isSafeInteger(expectedByteLength)) {
    fail("FRAME_BYTE_LENGTH_INVALID", "component byte length is not a safe integer");
  }

  if (!Array.isArray(windField.times) || !Array.isArray(windField.frames)
      || !windField.times.length || windField.times.length !== windField.frames.length) {
    fail("FRAME_TIME_COUNT_MISMATCH", "wind_field.frames and wind_field.times must have equal non-zero length");
  }
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= windField.frames.length) {
    fail("FRAME_INDEX_OUT_OF_RANGE", "requested wind frame index is out of range", {
      frameIndex,
      frameCount: windField.frames.length,
    });
  }

  const revisionText = requireString(revision, "REVISION_REQUIRED", "revision");
  const namespaceText = requireString(namespace, "NAMESPACE_INVALID", "namespace");
  let selectedFrame = null;
  for (let index = 0; index < windField.frames.length; index += 1) {
    const time = requireString(windField.times[index], "FRAME_TIME_INVALID", "wind_field.times[" + index + "]");
    const frame = requireObject(windField.frames[index], "FRAME_INVALID", "wind_field.frames[" + index + "]");
    requireExact(frame.index, index, "FRAME_INDEX_INVALID", "frame.index");
    requireExact(frame.time, time, "FRAME_TIME_MISMATCH", "frame.time");
    requireExact(
      frame.component_byte_length,
      expectedByteLength,
      "FRAME_BYTE_LENGTH_INVALID",
      "frame.component_byte_length",
    );
    const normalized = {
      index,
      time,
      uUrl: resolveEra5WindAssetUrl(frame.u_url, { apiBase, revision: revisionText }),
      vUrl: resolveEra5WindAssetUrl(frame.v_url, { apiBase, revision: revisionText }),
    };
    if (index === frameIndex) selectedFrame = normalized;
  }

  const signature = {
    namespace: namespaceText,
    revision: revisionText,
    schemaVersion: windField.schema_version,
    product: windField.product,
    frameIndex,
    time: selectedFrame.time,
    width: grid.width,
    height: grid.height,
    extent: grid.extent,
    lonStep: grid.lonStep,
    latStep: grid.latStep,
    periodicLongitude: grid.periodicLongitude,
    dtype: encoding.dtype,
    byteOrder: encoding.byteOrder,
    layout: encoding.layout,
    arrayOrder: encoding.arrayOrder,
    nodata: encoding.nodata32,
    expectedByteLength,
    uUrl: selectedFrame.uUrl,
    vUrl: selectedFrame.vUrl,
  };

  return {
    key: JSON.stringify(signature),
    namespace: namespaceText,
    revision: revisionText,
    frameIndex,
    time: selectedFrame.time,
    uUrl: selectedFrame.uUrl,
    vUrl: selectedFrame.vUrl,
    expectedByteLength,
    grid,
    encoding,
  };
}

function abortError(reason) {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  const message = reason instanceof Error && reason.message
    ? reason.message
    : "ERA5 wind frame request was cancelled";
  if (typeof DOMException === "function") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function decodeLittleEndianFloat32(buffer) {
  if (HOST_IS_LITTLE_ENDIAN) return new Float32Array(buffer);
  const result = new Float32Array(buffer.byteLength / 4);
  const view = new DataView(buffer);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = view.getFloat32(index * 4, true);
  }
  return result;
}

function inspectComponents(u, v, nodata32) {
  let validCount = 0;
  let invalidCount = 0;
  for (let index = 0; index < u.length; index += 1) {
    const uValue = u[index];
    const vValue = v[index];
    const uMissing = uValue === nodata32;
    const vMissing = vValue === nodata32;
    if (uMissing !== vMissing) {
      fail(
        "NODATA_MASK_MISMATCH",
        "U and V nodata masks differ",
        { index, u: uValue, v: vValue },
      );
    }
    if (uMissing) {
      invalidCount += 1;
      continue;
    }
    if (!Number.isFinite(uValue) || !Number.isFinite(vValue)) {
      fail(
        "NON_FINITE_COMPONENT",
        "wind component contains NaN or Infinity",
        { index, u: uValue, v: vValue },
      );
    }
    validCount += 1;
  }
  return { validCount, invalidCount };
}

function requestHeaders(initialHeaders) {
  const headers = {};
  if (typeof Headers === "function" && initialHeaders instanceof Headers) {
    initialHeaders.forEach((value, key) => {
      headers[key] = value;
    });
  } else if (Array.isArray(initialHeaders)) {
    for (const [key, value] of initialHeaders) headers[key] = value;
  } else if (initialHeaders && typeof initialHeaders === "object") {
    Object.assign(headers, initialHeaders);
  }
  const acceptKey = Object.keys(headers).find(key => key.toLowerCase() === "accept");
  if (!acceptKey) headers.Accept = "application/octet-stream";
  return headers;
}

async function fetchComponent(component, url, expectedByteLength, fetcher, signal, requestInit) {
  let response;
  try {
    response = await fetcher(url, {
      ...requestInit,
      method: "GET",
      cache: "no-store",
      headers: requestHeaders(requestInit?.headers),
      signal,
    });
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw abortError(signal.reason || error);
    fail(
      "FETCH_FAILED",
      "failed to download ERA5 " + component + " component",
      { component, url },
      error,
    );
  }

  if (!response || response.ok !== true) {
    fail(
      "HTTP_ERROR",
      "ERA5 " + component + " component returned an HTTP error",
      { component, url, status: response?.status },
    );
  }
  if (typeof response.arrayBuffer !== "function") {
    fail(
      "RESPONSE_BODY_INVALID",
      "ERA5 " + component + " response has no binary body reader",
      { component, url },
    );
  }

  let buffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw abortError(signal.reason || error);
    fail(
      "RESPONSE_READ_FAILED",
      "failed to read ERA5 " + component + " binary body",
      { component, url },
      error,
    );
  }
  if (!(buffer instanceof ArrayBuffer)) {
    fail(
      "RESPONSE_BODY_INVALID",
      "ERA5 " + component + " response did not return an ArrayBuffer",
      { component, url },
    );
  }
  if (buffer.byteLength !== expectedByteLength) {
    fail(
      "BYTE_LENGTH_MISMATCH",
      "ERA5 " + component + " byte length does not match metadata",
      {
        component,
        url,
        expected: expectedByteLength,
        actual: buffer.byteLength,
      },
    );
  }
  return buffer;
}

async function loadWindFrame(contract, fetcher, controller, requestInit) {
  try {
    const [uBuffer, vBuffer] = await Promise.all([
      fetchComponent(
        "U",
        contract.uUrl,
        contract.expectedByteLength,
        fetcher,
        controller.signal,
        requestInit,
      ),
      fetchComponent(
        "V",
        contract.vUrl,
        contract.expectedByteLength,
        fetcher,
        controller.signal,
        requestInit,
      ),
    ]);
    if (controller.signal.aborted) throw abortError(controller.signal.reason);

    const u = decodeLittleEndianFloat32(uBuffer);
    const v = decodeLittleEndianFloat32(vBuffer);
    const counts = inspectComponents(u, v, contract.encoding.nodata32);
    return Object.freeze({
      frameIndex: contract.frameIndex,
      time: contract.time,
      width: contract.grid.width,
      height: contract.grid.height,
      extent: Object.freeze([...contract.grid.extent]),
      lonStep: contract.grid.lonStep,
      latStep: contract.grid.latStep,
      periodicLongitude: contract.grid.periodicLongitude,
      crs: contract.grid.crs,
      nodata: contract.encoding.nodata32,
      u,
      v,
      validCount: counts.validCount,
      invalidCount: counts.invalidCount,
      byteLength: u.byteLength + v.byteLength,
      urls: Object.freeze({ u: contract.uUrl, v: contract.vUrl }),
      encoding: Object.freeze({
        dtype: contract.encoding.dtype,
        byteOrder: contract.encoding.byteOrder,
        layout: contract.encoding.layout,
        arrayOrder: contract.encoding.arrayOrder,
      }),
    });
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(error);
    throw error;
  }
}

function validateLimit(value, code, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(code, label + " must be a positive safe integer");
  }
  return value;
}

export class Era5WindFieldCache {
  constructor({
    maxBytes = DEFAULT_MAX_BYTES,
    maxEntries = DEFAULT_MAX_ENTRIES,
  } = {}) {
    this.entries = new Map();
    this.readyBytes = 0;
    this.clock = 0;
    this.setLimits({ maxBytes, maxEntries });
  }

  setLimits({
    maxBytes = this.maxBytes,
    maxEntries = this.maxEntries,
  } = {}) {
    this.maxBytes = validateLimit(maxBytes, "CACHE_LIMIT_INVALID", "maxBytes");
    this.maxEntries = validateLimit(maxEntries, "CACHE_LIMIT_INVALID", "maxEntries");
    this.trim();
  }

  acquire(
    windField,
    frameIndex,
    {
      apiBase = DEFAULT_API_BASE,
      namespace = "ERA5",
      revision,
      fetcher = globalThis.fetch,
      signal,
      requestInit = {},
    } = {},
  ) {
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));
    if (typeof fetcher !== "function") {
      return Promise.reject(new Era5WindFieldError(
        "FETCHER_INVALID",
        "a fetch-compatible function is required",
      ));
    }

    let contract;
    try {
      contract = validateEra5WindFrame(windField, frameIndex, {
        apiBase,
        namespace,
        revision,
      });
    } catch (error) {
      return Promise.reject(error);
    }

    let entry = this.entries.get(contract.key);
    if (!entry) entry = this.createEntry(contract, fetcher, requestInit);
    entry.lastUsed = ++this.clock;
    entry.waiters += 1;

    return new Promise((resolve, reject) => {
      let settled = false;
      const removeAbortListener = () => signal?.removeEventListener("abort", onAbort);
      const finishWaiting = () => {
        entry.waiters = Math.max(0, entry.waiters - 1);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        removeAbortListener();
        finishWaiting();
        if (
          entry.state === "pending"
          && entry.waiters === 0
          && entry.refs === 0
          && this.entries.get(entry.key) === entry
        ) {
          this.removeEntry(entry, true);
        } else {
          this.trim();
        }
        reject(abortError(signal.reason));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      entry.promise.then(
        field => {
          if (settled) return;
          settled = true;
          removeAbortListener();
          finishWaiting();
          if (this.entries.get(entry.key) !== entry || entry.controller.signal.aborted) {
            reject(abortError(entry.controller.signal.reason));
            return;
          }

          entry.refs += 1;
          entry.lastUsed = ++this.clock;
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            entry.refs = Math.max(0, entry.refs - 1);
            entry.lastUsed = ++this.clock;
            this.trim();
          };
          resolve(Object.freeze({
            key: entry.key,
            namespace: entry.namespace,
            revision: entry.revision,
            field,
            release,
          }));
        },
        error => {
          if (settled) return;
          settled = true;
          removeAbortListener();
          finishWaiting();
          reject(error);
        },
      );
    });
  }

  async prefetch(windField, frameIndex, options = {}) {
    const lease = await this.acquire(windField, frameIndex, options);
    lease.release();
    return lease.field;
  }

  createEntry(contract, fetcher, requestInit) {
    const controller = new AbortController();
    const entry = {
      key: contract.key,
      namespace: contract.namespace,
      revision: contract.revision,
      state: "pending",
      controller,
      promise: null,
      value: null,
      byteLength: 0,
      waiters: 0,
      refs: 0,
      lastUsed: ++this.clock,
    };
    this.entries.set(entry.key, entry);
    entry.promise = loadWindFrame(contract, fetcher, controller, requestInit)
      .then(field => {
        if (controller.signal.aborted || this.entries.get(entry.key) !== entry) {
          throw abortError(controller.signal.reason);
        }
        entry.state = "ready";
        entry.value = field;
        entry.byteLength = field.byteLength;
        this.readyBytes += entry.byteLength;
        this.trim();
        return field;
      })
      .catch(error => {
        if (this.entries.get(entry.key) === entry) this.removeEntry(entry, false);
        throw error;
      });
    return entry;
  }

  removeEntry(entry, abortPending) {
    if (this.entries.get(entry.key) !== entry) return false;
    this.entries.delete(entry.key);
    if (entry.state === "ready") {
      this.readyBytes = Math.max(0, this.readyBytes - entry.byteLength);
    } else if (abortPending && !entry.controller.signal.aborted) {
      entry.controller.abort(abortError());
    }
    return true;
  }

  trim() {
    while (true) {
      const readyEntries = [...this.entries.values()].filter(entry => entry.state === "ready");
      if (readyEntries.length <= this.maxEntries && this.readyBytes <= this.maxBytes) return;
      const candidate = readyEntries
        .filter(entry => entry.refs === 0 && entry.waiters === 0)
        .sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!candidate) return;
      this.removeEntry(candidate, false);
    }
  }

  clear({ namespace, force = false } = {}) {
    let removed = 0;
    for (const entry of [...this.entries.values()]) {
      if (namespace !== undefined && entry.namespace !== namespace) continue;
      if (!force && (entry.refs > 0 || entry.waiters > 0)) continue;
      if (this.removeEntry(entry, entry.state === "pending")) removed += 1;
    }
    return removed;
  }

  stats() {
    const values = [...this.entries.values()];
    return Object.freeze({
      entries: values.length,
      pendingEntries: values.filter(entry => entry.state === "pending").length,
      readyEntries: values.filter(entry => entry.state === "ready").length,
      referencedEntries: values.filter(entry => entry.refs > 0).length,
      waiters: values.reduce((sum, entry) => sum + entry.waiters, 0),
      references: values.reduce((sum, entry) => sum + entry.refs, 0),
      readyBytes: this.readyBytes,
      maxBytes: this.maxBytes,
      maxEntries: this.maxEntries,
    });
  }
}

export function createEra5WindFieldCache(options) {
  return new Era5WindFieldCache(options);
}

export const sharedEra5WindFieldCache = createEra5WindFieldCache();

export function acquireEra5WindFrame(windField, frameIndex, options) {
  return sharedEra5WindFieldCache.acquire(windField, frameIndex, options);
}

export function prefetchEra5WindFrame(windField, frameIndex, options) {
  return sharedEra5WindFieldCache.prefetch(windField, frameIndex, options);
}

export function getEra5WindFieldCacheStats() {
  return sharedEra5WindFieldCache.stats();
}

export function clearEra5WindFieldCache(options) {
  return sharedEra5WindFieldCache.clear(options);
}

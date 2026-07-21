const METERS_PER_DEGREE = 111_320;
const DEFAULT_TIME_SCALE = 36_000;
const DEFAULT_MAX_AGE = 90;
const MIN_COS_LATITUDE = 0.05;

export class Era5WindParticleError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "Era5WindParticleError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new Era5WindParticleError(code, message, detail);
}

function finiteNumber(value, code, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(code, label + " must be a finite number");
  }
  return value;
}

function positiveInteger(value, code, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(code, label + " must be a positive safe integer");
  }
  return value;
}

export function validateEra5ParticleField(fieldValue) {
  if (!fieldValue || typeof fieldValue !== "object" || Array.isArray(fieldValue)) {
    fail("FIELD_INVALID", "ERA5 wind field must be an object");
  }
  const width = positiveInteger(fieldValue.width, "FIELD_WIDTH_INVALID", "field.width");
  const height = positiveInteger(fieldValue.height, "FIELD_HEIGHT_INVALID", "field.height");
  const valueCount = width * height;
  if (!Number.isSafeInteger(valueCount)) {
    fail("FIELD_SIZE_INVALID", "ERA5 wind field is too large");
  }
  if (!(fieldValue.u instanceof Float32Array) || fieldValue.u.length !== valueCount) {
    fail("FIELD_U_INVALID", "field.u must be a width x height Float32Array");
  }
  if (!(fieldValue.v instanceof Float32Array) || fieldValue.v.length !== valueCount) {
    fail("FIELD_V_INVALID", "field.v must be a width x height Float32Array");
  }
  if (!Array.isArray(fieldValue.extent) || fieldValue.extent.length !== 4) {
    fail("FIELD_EXTENT_INVALID", "field.extent must contain west, south, east and north");
  }
  const extent = fieldValue.extent.map((value, index) =>
    finiteNumber(value, "FIELD_EXTENT_INVALID", "field.extent[" + index + "]"),
  );
  const [west, south, east, north] = extent;
  if (west >= east || south >= north) {
    fail("FIELD_EXTENT_INVALID", "field.extent bounds are reversed", { extent });
  }
  const lonStep = finiteNumber(fieldValue.lonStep, "FIELD_LON_STEP_INVALID", "field.lonStep");
  const latStep = finiteNumber(fieldValue.latStep, "FIELD_LAT_STEP_INVALID", "field.latStep");
  if (lonStep <= 0 || latStep <= 0) {
    fail("FIELD_STEP_INVALID", "field grid steps must be positive");
  }
  const nodata = Math.fround(
    finiteNumber(fieldValue.nodata, "FIELD_NODATA_INVALID", "field.nodata"),
  );
  if (!Number.isFinite(nodata)) {
    fail("FIELD_NODATA_INVALID", "field.nodata cannot be represented as Float32");
  }
  if (typeof fieldValue.periodicLongitude !== "boolean") {
    fail("FIELD_PERIODIC_INVALID", "field.periodicLongitude must be boolean");
  }
  return Object.freeze({
    u: fieldValue.u,
    v: fieldValue.v,
    width,
    height,
    extent: Object.freeze(extent),
    west,
    south,
    east,
    north,
    lonStep,
    latStep,
    periodicLongitude: fieldValue.periodicLongitude,
    longitudePeriod: fieldValue.periodicLongitude ? lonStep * width : east - west,
    nodata,
    valueCount,
  });
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function sampleEra5Wind(fieldValue, longitude, latitude, target = {}) {
  const field = fieldValue?.west === undefined
    ? validateEra5ParticleField(fieldValue)
    : fieldValue;
  const lon = finiteNumber(longitude, "SAMPLE_LONGITUDE_INVALID", "longitude");
  const lat = finiteNumber(latitude, "SAMPLE_LATITUDE_INVALID", "latitude");
  const epsilon = 1e-7;
  if (lat < field.south - epsilon || lat > field.north + epsilon) return null;

  let gridX;
  if (field.periodicLongitude) {
    const wrapped = field.west + modulo(lon - field.west, field.longitudePeriod);
    gridX = (wrapped - field.west) / field.lonStep;
  } else {
    if (lon < field.west - epsilon || lon > field.east + epsilon) return null;
    gridX = (Math.min(field.east, Math.max(field.west, lon)) - field.west) / field.lonStep;
  }
  const gridY = (field.north - Math.min(field.north, Math.max(field.south, lat))) / field.latStep;

  const x0 = Math.min(field.width - 1, Math.max(0, Math.floor(gridX)));
  const y0 = Math.min(field.height - 1, Math.max(0, Math.floor(gridY)));
  const x1 = field.periodicLongitude
    ? (x0 + 1) % field.width
    : Math.min(field.width - 1, x0 + 1);
  const y1 = Math.min(field.height - 1, y0 + 1);
  const tx = x1 === x0 ? 0 : gridX - Math.floor(gridX);
  const ty = y1 === y0 ? 0 : gridY - Math.floor(gridY);
  const indices = [
    y0 * field.width + x0,
    y0 * field.width + x1,
    y1 * field.width + x0,
    y1 * field.width + x1,
  ];

  const weights = [
    (1 - tx) * (1 - ty),
    tx * (1 - ty),
    (1 - tx) * ty,
    tx * ty,
  ];
  let sampledU = 0;
  let sampledV = 0;
  for (let index = 0; index < indices.length; index += 1) {
    if (weights[index] <= Number.EPSILON) continue;
    const uValue = field.u[indices[index]];
    const vValue = field.v[indices[index]];
    if (
      uValue === field.nodata
      || vValue === field.nodata
      || !Number.isFinite(uValue)
      || !Number.isFinite(vValue)
    ) {
      return null;
    }
    sampledU += uValue * weights[index];
    sampledV += vValue * weights[index];
  }
  target.u = sampledU;
  target.v = sampledV;
  target.speed = Math.hypot(target.u, target.v);
  return target;
}

function createRandom(seedValue) {
  let state = (Number(seedValue) || 1) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export class Era5WindParticleSystem {
  constructor(
    field,
    {
      count = 1_200,
      maxAge = DEFAULT_MAX_AGE,
      seed = 1,
    } = {},
  ) {
    this.field = validateEra5ParticleField(field);
    this.count = positiveInteger(count, "PARTICLE_COUNT_INVALID", "count");
    this.maxAge = positiveInteger(maxAge, "PARTICLE_MAX_AGE_INVALID", "maxAge");
    this.random = createRandom(seed);
    this.sample = { u: 0, v: 0, speed: 0 };
    this.lon = new Float32Array(this.count);
    this.lat = new Float32Array(this.count);
    this.previousLon = new Float32Array(this.count);
    this.previousLat = new Float32Array(this.count);
    this.speed = new Float32Array(this.count);
    this.age = new Uint16Array(this.count);
    this.generation = new Uint32Array(this.count);
    for (let index = 0; index < this.count; index += 1) {
      this.respawn(index, true);
    }
  }

  randomPosition() {
    const field = this.field;
    const east = field.periodicLongitude
      ? field.west + field.longitudePeriod
      : field.east;
    return {
      lon: field.west + this.random() * (east - field.west),
      lat: field.south + this.random() * (field.north - field.south),
    };
  }

  respawn(index, staggerAge = false) {
    let position = this.randomPosition();
    let sampled = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      sampled = sampleEra5Wind(this.field, position.lon, position.lat, this.sample);
      if (sampled) break;
      position = this.randomPosition();
    }
    this.lon[index] = position.lon;
    this.lat[index] = position.lat;
    this.previousLon[index] = position.lon;
    this.previousLat[index] = position.lat;
    this.speed[index] = sampled?.speed || 0;
    this.age[index] = staggerAge ? Math.floor(this.random() * this.maxAge) : 0;
    this.generation[index] = (this.generation[index] + 1) >>> 0;
  }

  step(
    deltaSeconds,
    {
      timeScale = DEFAULT_TIME_SCALE,
    } = {},
  ) {
    const realSeconds = finiteNumber(deltaSeconds, "STEP_DELTA_INVALID", "deltaSeconds");
    const scale = finiteNumber(timeScale, "STEP_TIME_SCALE_INVALID", "timeScale");
    if (realSeconds < 0 || scale < 0) {
      fail("STEP_TIME_INVALID", "deltaSeconds and timeScale cannot be negative");
    }
    const simulatedSeconds = Math.min(realSeconds, 0.05) * scale;
    let moved = 0;
    let respawned = 0;

    for (let index = 0; index < this.count; index += 1) {
      if (this.age[index] >= this.maxAge) {
        this.respawn(index);
        respawned += 1;
        continue;
      }
      const lon = this.lon[index];
      const lat = this.lat[index];
      const wind = sampleEra5Wind(this.field, lon, lat, this.sample);
      if (!wind) {
        this.respawn(index);
        respawned += 1;
        continue;
      }

      this.previousLon[index] = lon;
      this.previousLat[index] = lat;
      const cosLatitude = Math.max(
        MIN_COS_LATITUDE,
        Math.abs(Math.cos(lat * Math.PI / 180)),
      );
      let nextLon = lon + wind.u * simulatedSeconds / (METERS_PER_DEGREE * cosLatitude);
      const nextLat = lat + wind.v * simulatedSeconds / METERS_PER_DEGREE;
      if (this.field.periodicLongitude) {
        nextLon = this.field.west + modulo(
          nextLon - this.field.west,
          this.field.longitudePeriod,
        );
      }
      if (
        nextLat < this.field.south
        || nextLat > this.field.north
        || (!this.field.periodicLongitude
          && (nextLon < this.field.west || nextLon > this.field.east))
      ) {
        this.respawn(index);
        respawned += 1;
        continue;
      }

      this.lon[index] = nextLon;
      this.lat[index] = nextLat;
      this.speed[index] = wind.speed;
      this.age[index] += 1;
      moved += 1;
    }
    return { moved, respawned, simulatedSeconds };
  }
}

export function createEra5WindParticleSystem(field, options) {
  return new Era5WindParticleSystem(field, options);
}

export const ERA5_WIND_PARTICLE_DEFAULTS = Object.freeze({
  count: 1_200,
  maxAge: DEFAULT_MAX_AGE,
  timeScale: DEFAULT_TIME_SCALE,
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  Era5WindParticleError,
  createEra5WindParticleSystem,
  sampleEra5Wind,
  validateEra5ParticleField,
} from "../src/utils/era5WindParticles.js";

const NODATA = -999999;

function field({
  width = 2,
  height = 2,
  extent = [100, 20, 101, 21],
  lonStep = 1,
  latStep = 1,
  periodicLongitude = false,
  u = [0, 10, 20, 30],
  v = [0, 20, 40, 60],
} = {}) {
  return {
    width,
    height,
    extent,
    lonStep,
    latStep,
    periodicLongitude,
    nodata: NODATA,
    u: new Float32Array(u),
    v: new Float32Array(v),
  };
}

test("validates the decoded field shape before particle simulation", () => {
  const normalized = validateEra5ParticleField(field());
  assert.equal(normalized.valueCount, 4);
  assert.equal(normalized.west, 100);
  assert.equal(normalized.north, 21);

  const invalid = field();
  invalid.v = new Float32Array(3);
  assert.throws(
    () => validateEra5ParticleField(invalid),
    error => error instanceof Era5WindParticleError && error.code === "FIELD_V_INVALID",
  );
});

test("bilinearly samples north-to-south, west-to-east ERA5 grids", () => {
  const wind = field();
  assert.deepEqual(
    sampleEra5Wind(wind, 100, 21),
    { u: 0, v: 0, speed: 0 },
  );
  const center = sampleEra5Wind(wind, 100.5, 20.5);
  assert.equal(center.u, 15);
  assert.equal(center.v, 30);
  assert.equal(center.speed, Math.hypot(15, 30));
  assert.deepEqual(
    sampleEra5Wind(wind, 101, 20),
    { u: 30, v: 60, speed: Math.hypot(30, 60) },
  );
  assert.equal(sampleEra5Wind(wind, 99, 20.5), null);
  assert.equal(sampleEra5Wind(wind, 100.5, 22), null);
});

test("rejects samples whose interpolation cell contains nodata", () => {
  const wind = field({
    u: [1, 2, NODATA, 4],
    v: [10, 20, NODATA, 40],
  });
  assert.equal(sampleEra5Wind(wind, 100.5, 20.5), null);
  assert.deepEqual(
    sampleEra5Wind(wind, 100.5, 21),
    { u: 1.5, v: 15, speed: Math.hypot(1.5, 15) },
  );
});

test("interpolates continuously across a periodic longitude seam", () => {
  const wind = field({
    width: 4,
    height: 2,
    extent: [0, 0, 270, 1],
    lonStep: 90,
    latStep: 1,
    periodicLongitude: true,
    u: [0, 10, 20, 30, 0, 10, 20, 30],
    v: [0, 0, 0, 0, 0, 0, 0, 0],
  });
  const eastSeam = sampleEra5Wind(wind, 315, 0.5);
  const westEquivalent = sampleEra5Wind(wind, -45, 0.5);
  assert.equal(eastSeam.u, 15);
  assert.equal(westEquivalent.u, 15);
});

test("advects particles eastward and northward using metres per second", () => {
  const constant = field({
    width: 3,
    height: 3,
    extent: [0, 0, 2, 2],
    lonStep: 1,
    latStep: 1,
    u: Array(9).fill(11_132),
    v: Array(9).fill(11_132),
  });
  const system = createEra5WindParticleSystem(constant, {
    count: 1,
    maxAge: 10,
    seed: 7,
  });
  system.lon[0] = 1;
  system.lat[0] = 1;
  system.age[0] = 0;
  const generation = system.generation[0];

  const result = system.step(0.05, { timeScale: 20 });
  assert.equal(result.moved, 1);
  assert.equal(result.respawned, 0);
  assert.equal(system.previousLon[0], 1);
  assert.equal(system.previousLat[0], 1);
  assert.ok(Math.abs(system.lat[0] - 1.1) < 1e-6);
  assert.ok(system.lon[0] > 1.099 && system.lon[0] < 1.101);
  assert.equal(system.generation[0], generation);
  assert.ok(Math.abs(system.speed[0] - Math.hypot(11_132, 11_132)) < 0.01);
});

test("respawns expired or out-of-bounds particles without drawing a false segment", () => {
  const eastward = field({
    width: 3,
    height: 3,
    extent: [0, 0, 2, 2],
    lonStep: 1,
    latStep: 1,
    u: Array(9).fill(111_320),
    v: Array(9).fill(0),
  });
  const system = createEra5WindParticleSystem(eastward, {
    count: 1,
    maxAge: 2,
    seed: 11,
  });
  system.lon[0] = 1.9;
  system.lat[0] = 1;
  system.age[0] = 0;
  const firstGeneration = system.generation[0];
  const boundary = system.step(0.05, { timeScale: 20 });
  assert.equal(boundary.respawned, 1);
  assert.notEqual(system.generation[0], firstGeneration);
  assert.equal(system.previousLon[0], system.lon[0]);
  assert.equal(system.previousLat[0], system.lat[0]);

  system.age[0] = 2;
  const secondGeneration = system.generation[0];
  const expired = system.step(0.016, { timeScale: 1 });
  assert.equal(expired.respawned, 1);
  assert.notEqual(system.generation[0], secondGeneration);
});

test("uses a deterministic seeded distribution for repeatable rendering", () => {
  const wind = field();
  const first = createEra5WindParticleSystem(wind, { count: 8, seed: 123 });
  const second = createEra5WindParticleSystem(wind, { count: 8, seed: 123 });
  assert.deepEqual([...first.lon], [...second.lon]);
  assert.deepEqual([...first.lat], [...second.lat]);
  assert.deepEqual([...first.age], [...second.age]);
});

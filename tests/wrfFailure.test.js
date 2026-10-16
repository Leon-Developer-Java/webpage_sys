import assert from "node:assert/strict";
import test from "node:test";
import { wrfConfigurationFailure, configurationFailureAdvice, safeError } from "../src/utils/wrfFailure.js";

test("historical generic model errors use namelist evidence without mutating the task", () => {
  const failure = Object.freeze({ failure_class: "model", message: "远端 WRF 退出码 1" });
  const log = "FIO-F-228/namelist read/unit=10/end of file reached without finding group. File name = 'namelist.wps', record = 43";
  assert.equal(wrfConfigurationFailure(failure, log), true);
  assert.equal(failure.failure_class, "model");
  assert.match(configurationFailureAdvice, /不要直接重试旧配置/);
});
test("layout validation failures are identified, ordinary physics errors are not", () => {
  assert.equal(wrfConfigurationFailure({ failure_class: "configuration_generation" }), true);
  assert.equal(wrfConfigurationFailure({}, "NAMELIST_LAYOUT_ERROR: order"), true);
  assert.equal(wrfConfigurationFailure({}, "namelist.input physics incompatibility"), false);
  assert.equal(wrfConfigurationFailure({}, "points exceeded cfl"), false);
});

test("operation errors never expose tracebacks or deployment credentials", () => {
  for (const value of ["Traceback FileNotFoundError", "/mnt/private/task", "Bearer private-secret", "/Users/private/path"]) {
    assert.equal(safeError(value), "操作未完成，详细诊断已保留，请重新核验任务状态。");
  }
  assert.equal(safeError("参数无效"), "参数无效");
  assert.equal(safeError("x".repeat(800)).length, 600);
});

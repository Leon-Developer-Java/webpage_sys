import test from "node:test";
import assert from "node:assert/strict";

import { loadDisplayDocument, registeredDisplayType } from "../src/agent-display-providers.js";

const resource = (dataType, meta) => ({
  file_uuid: "selected-file",
  file_name: `${dataType}-selected.dat`,
  data_type: dataType,
  meta_path: `${dataType}/assets/selected-file/data.meta.json`,
  meta,
});

test("provider registry covers current parsed weather families", () => {
  for (const type of ["CMA", "RADAR", "ERA5", "WRF", "GFS", "ECMWF", "HIMAWARI", "FY3"]) {
    assert.equal(registeredDisplayType(type.toLowerCase()), type);
  }
  assert.equal(registeredDisplayType("unknown"), "");
});

test("CMA conversation viewer uses only WebP assets bound to the selected file", async () => {
  let fetchCalls = 0;
  const result = await loadDisplayDocument(resource("CMA", {
    default_variable: "TMP",
    times: ["2026-09-02T00:00:00Z"],
    extent: [70, 10, 140, 60],
    webp_files: ["/data/CMA/assets/selected-file/input.TMP.L0.webp"],
    variables: [
      { name: "TMP", name_cn: "气温", unit: "C" },
      { name: "SPFH", name_cn: "比湿", unit: "kg/kg", webp: "/data/CMA/input.SPFH.L0.webp" },
    ],
  }), { variable: "SPFH" }, { fetch: async () => { fetchCalls += 1; } });
  assert.equal(fetchCalls, 0);
  assert.equal(result.selectedVariable, "TMP");
  assert.deepEqual(result.variables.map(item => item.name), ["TMP"]);
  assert.deepEqual(result.frames.map(item => item.image_url), ["/data/CMA/assets/selected-file/input.TMP.L0.webp"]);
  assert.equal(result.times.length, 1);
});

test("Radar endpoint provider binds the selected meta and normalizes its real response shape", async () => {
  let requested = "";
  const fetch = async url => {
    requested = url;
    return {
      ok: true,
      json: async () => ({ code: 0, data: {
        webp_url: "/data/radar-selected.webp",
        extent: [115.4, 39.4, 117.6, 41.1],
        times: ["2026-09-02T00:00:00Z", "2026-09-02T00:06:00Z"],
        products: [{
          key: "observation.base_ref_cor_log",
          label: "反射率",
          unit: "dBZ",
          levels: [{ key: "max", stats: { min: -9.5, max: 37.2 } }],
        }],
      } }),
    };
  };
  const result = await loadDisplayDocument(resource("RADAR", {}), { timeIndex: 1 }, { fetch, apiBase: "http://127.0.0.1:8002" });
  assert.match(requested, /\/api\/display\/RADAR\?/);
  assert.match(requested, /meta_file=.*selected-file/);
  assert.equal(result.frames[0].image_url, "/data/radar-selected.webp");
  assert.equal(result.frames[0].valid_time, "2026-09-02T00:06:00Z");
  assert.equal(result.variables[0].name, "observation.base_ref_cor_log");
});

test("ERA5, GFS and ECMWF normalize only the selected resource metadata", async () => {
  for (const type of ["ERA5", "GFS", "ECMWF"]) {
    let fetchCalls = 0;
    const result = await loadDisplayDocument(resource(type, {
      default_variable: "t2m",
      times: ["2026-09-02T00:00:00Z", "2026-09-02T01:00:00Z"],
      variable_layers: {
        t2m: {
          label: "2米温度",
          unit: "K",
          width: 4,
          height: 3,
          extent: [70, 10, 140, 60],
          webp_urls: ["/data/selected-t0.webp", "/data/selected-t1.webp"],
          stats: [{ min: 270, max: 300 }, { min: 271, max: 301 }],
        },
      },
    }), {}, { fetch: async () => { fetchCalls += 1; } });
    assert.equal(fetchCalls, 0);
    assert.equal(result.selectedVariable, "t2m");
    assert.deepEqual(result.frames.map(item => item.image_url), ["/data/selected-t0.webp", "/data/selected-t1.webp"]);
  }
});

test("WRF maps selected variable frames across file-bound resolution products", async () => {
  const result = await loadDisplayDocument(resource("WRF", {
    default_resolution: "native",
    times: ["2026-09-02T00:00:00Z", "2026-09-02T01:00:00Z"],
    resolution_products: {
      native: {
        label: "原始",
        variables: [
          { name: "T2", label: "2米温度", units: "K", shape: [3, 4] },
          { name: "RAINNC", label: "累计降水", units: "mm", shape: [3, 4] },
        ],
        webp_files: ["/data/t0-t2.webp", "/data/t0-rain.webp", "/data/t1-t2.webp", "/data/t1-rain.webp"],
      },
    },
  }), { variable: "RAINNC" });
  assert.equal(result.selectedVariable, "RAINNC");
  assert.deepEqual(result.frames.map(item => item.image_url), ["/data/t0-rain.webp", "/data/t1-rain.webp"]);
});

test("satellite providers use selected products and resolution assets", async () => {
  for (const type of ["HIMAWARI", "FY3"]) {
    const result = await loadDisplayDocument(resource(type, {
      default_variable: "B03",
      times: ["2026-09-02T00:00:00Z"],
      resolution_options: [{ key: "original", label: "原始" }],
      variables: [{
        name: "B03",
        label: "可见光",
        unit: "1",
        resolution_assets: {
          original: { webp: "/data/selected-b03.webp", extent: [70, 10, 140, 60], width: 4, height: 3 },
        },
      }],
    }), { resolution: "original" });
    assert.equal(result.frames[0].image_url, "/data/selected-b03.webp");
  }
});

test("registered provider refuses metadata without a real image asset", async () => {
  await assert.rejects(
    loadDisplayDocument(resource("ERA5", { variable_layers: { t2m: { unit: "K" } } }), {}),
    /没有可展示的图像资产/,
  );
});

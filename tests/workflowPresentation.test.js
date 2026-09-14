import test from "node:test";
import assert from "node:assert/strict";
import { presentWorkflow, formatNumber, fileQuery, resourceUrl } from "../src/workflow-presentation.js";

const uuid = "123e4567-e89b-12d3-a456-426614174000";
const file = { file_uuid: uuid, original_file_name: "example.nc", data_type: "WRF", parse_status: "success" };
const run = (template, result = {}, extra = {}) => ({ origin: "workflow_orchestrator", run_id: "run-test", session_id: "s", status: "succeeded", template_id: template,
  result: { summary: "INTERNAL_RAW_RETURN file_uuid=secret /data/long-path", ...result }, ...extra });

test("all ten readonly templates and parser have a business-facing result view", () => {
  const cases = {
    "weather.data_catalog": { datasets: [{ dataset_id: "sample", data_type: "ERA5", variables: [], times: 0, png_count: 0 }] },
    "weather.asset_overview": { data: { task_total: 2, detail_counts: [{ data_type: "WRF", file_count: 1, asset_count: 2 }], status_summary: [], latest_tasks: [] } },
    "weather.parse_task_list": { tasks: [file] },
    "weather.file_assets": { file, assets: [file] },
    "weather.latest_file_assets": { file, assets: [file] },
    "weather.asset_query": { assets: [file] },
    "weather.parse_failure_diagnosis": { groups: [{ data_type: "Radar", count: 3, retryable: false, parse_error: "missing", suggestion: "check" }], tasks: [] },
    "weather.wrf_asset_summary": { records: [{ resolution_key: "native", asset_count: 2 }], assets: [file] },
    "weather.era5_timeseries": { records: [{ time: "2026-01-01", mean: 0, min: -1, max: 1 }] },
    "weather.radar_echo_change": { records: [{ time: "2026-01-01", status: "ok", mean: 0, max: 1, strong_count: 0, threshold: 35 }] },
    "parser.existing_file": { sources: [{ source_file: "D:/data/example.nc", meta_file: "D:/data/example.nc.meta.json" }] },
  };
  for (const [template, result] of Object.entries(cases)) {
    const view = presentWorkflow(run(template, result));
    assert.ok(view.title && view.headline, template);
    assert.ok(!view.headline.includes("INTERNAL_RAW_RETURN"), template);
    if (template !== "parser.existing_file") assert.ok(view.tables.length, template);
  }
});

test("WRF distinguishes 52 counted assets from 50 returned details and 25 identified files", () => {
  const result = { records: [{ resolution_key: "native", asset_count: 52 }], assets: Array.from({ length: 50 }, (_, i) => ({ file_uuid: `uuid-${Math.floor(i / 2)}`, original_file_name: `file-${Math.floor(i / 2)}.nc`, resolution_key: "native", webp_url: "/data/3km/t2.webp" })) };
  const view = presentWorkflow(run("weather.wrf_asset_summary", result, { parameters: { element_key: "T2" } }));
  assert.deepEqual(view.metrics.map(item => item.value), ["52", "50", "25"]);
  assert.equal(view.files.length, 25);
  assert.equal(view.tables.find(t => t.id === "assets").rows.length, 50);
  assert.match(view.notes.join(" "), /不保证覆盖全库/);
  assert.match(view.tables[0].rows[0].resolution, /间距未标注/);
  assert.ok(!view.tables[0].rows[0].resolution.includes("3km"));
});

test("zero stays zero; missing numbers, units and time never become fabricated values", () => {
  assert.equal(formatNumber(0), "0");
  for (const value of [null, undefined, NaN, Infinity, ""]) assert.equal(formatNumber(value), "未提供");
  const view = presentWorkflow(run("weather.asset_query", { assets: [{ ...file, dataset_id: "2026-01-01", mean_value: 0, valid_time: null, display_unit: null }] }));
  assert.equal(view.tables[0].rows[0].mean, "0");
  assert.equal(view.tables[0].rows[0].time, "未提供");
  assert.equal(view.tables[0].rows[0].unit, "未提供");
  const unknown = presentWorkflow(run("weather.asset_query", { assets: [{ element_key: "T2" }] }));
  assert.equal(unknown.metrics[1].value, "未提供");
});

test("dataset identifiers are not turned into guessed file UUIDs or paths", () => {
  const view = presentWorkflow(run("weather.data_catalog", { datasets: [{ dataset_id: "dataset_a", variables: [{ name: "t2m", units: "K" }], times: 0, png_count: 0 }] }));
  assert.equal(view.files[0].kind, "数据集");
  assert.equal(view.files[0].path, "");
  assert.equal(fileQuery(view.files[0]), "");
  assert.equal(view.files[0].variables, "t2m (K)");
});

test("formatting is repeatable and never modifies the saved run or its warnings", () => {
  const record = run("weather.data_catalog", { using_sample: true, datasets: [], warnings: [] });
  const before = JSON.stringify(record);
  assert.equal(presentWorkflow(record).warnings.length, 1);
  assert.equal(presentWorkflow(record).warnings.length, 1);
  assert.equal(JSON.stringify(record), before);
});

test("file references deduplicate UUIDs, not filenames; commands are explicit and readonly", () => {
  const otherUuid = "123e4567-e89b-12d3-a456-426614174001";
  const view = presentWorkflow(run("weather.file_assets", { file, assets: [file, file, { ...file, file_uuid: otherUuid }] }));
  assert.equal(view.files.length, 2);
  const rows = view.tables[0].rows;
  assert.equal(rows[0].file.fileId, rows[1].file.fileId);
  assert.notEqual(rows[0].file.fileId, rows[2].file.fileId);
  assert.equal(fileQuery(view.files[0]), `查询指定文件资产 file_uuid=${uuid}`);
  assert.equal(fileQuery({ uuid: "invalid; delete data" }), "");
});

test("previous-result references name their source run, not the system latest file", () => {
  const view = presentWorkflow(run("weather.file_assets", { file, assets: [file] }, { events: [{ type: "artifact_bound", data: { reference_run_id: "run-prior" } }] }));
  assert.equal(view.referenceRunId, "run-prior");
  assert.match(view.notes.join(" "), /没有用系统最新文件替代/);
  assert.equal(view.files[0].uuid, uuid);
});

test("task counts describe returned rows, not numbers extracted from backend prose", () => {
  const view = presentWorkflow(run("weather.parse_task_list", { summary: "共999条", tasks: [file, file] }));
  assert.equal(view.metrics[0].value, "2");
  assert.match(view.headline, /本次返回 2 条/);
  assert.match(view.notes.join(" "), /不代表数据库全部/);
});

test("radar separates valid and missing records; count is not area, unknown units remain unknown", () => {
  const view = presentWorkflow(run("weather.radar_echo_change", { records: [
    { status: "ok", time: "2026-01-01", mean: 0, max: 10, strong_count: 0, threshold: 35, source_file: "D:/data/radar.nc" },
    { status: "missing_source", meta_file: "D:/data/missing.meta.json" },
  ] }));
  assert.deepEqual(view.metrics.map(item => item.value), ["1", "1"]);
  assert.match(view.notes.join(" "), /不足两条/);
  assert.match(view.notes.join(" "), /不是回波覆盖面积/);
  assert.equal(view.tables[0].rows[0].strong, "0");
  assert.equal(view.tables[0].rows[1].mean, "未提供");
  assert.match(view.tables[0].columns[1].label, /单位未提供/);
});

test("ERA5 honors a returned unit and preserves individual statistics instead of inferring a trend", () => {
  const view = presentWorkflow(run("weather.era5_timeseries", { unit: "K", records: [{ time: "2026-01-01", mean: 280, min: 279, max: 281 }] }));
  assert.match(view.tables[0].columns[1].label, /K/);
  assert.equal(view.tables[0].rows[0].min, "279");
  assert.equal(view.tables[0].rows[0].mean, "280");
  assert.match(view.notes.join(" "), /不足两条/);
});

test("empty, missing-input, rejected, failed and preview results do not look like success", () => {
  assert.match(presentWorkflow(run("weather.data_catalog", { datasets: [] })).headline, /没有返回/);
  const missing = presentWorkflow(run("weather.file_assets", {}, { status: "need_input", events: [{ type: "need_input", data: { missing: ["file_uuid"] } }] }));
  assert.match(missing.headline, /文件标识/);
  assert.match(missing.notes[0], /填入查询/);
  const failed = presentWorkflow(run("weather.era5_timeseries", { summary: "缺少时间维" }, { status: "failed" }));
  assert.match(failed.notes[0], /时间维/);
  assert.equal(failed.tables.length, 0);
  const rejected = presentWorkflow(run("parser.existing_file", {}, { status: "rejected" }));
  assert.match(rejected.headline, /拒绝/);
  const preview = presentWorkflow(run("parser.existing_file", { approved_inputs: { file_path: "D:/data/test.nc" } }, { status: "waiting_confirmation" }));
  assert.match(preview.headline, /尚未开始解析/);
  assert.equal(preview.files[0].kind, "请求文件");
  assert.equal(fileQuery(preview.files[0]), "");
});

test("LLM clarification is shown verbatim as text and invites a natural reply", () => {
  const view = presentWorkflow(run("weather.latest_file_assets", {}, {
    status: "need_input", recognition: { mode: "llm", model: "test" },
    events: [{ type: "need_input", message: "请选择数据类型", data: { question: "你想查看 WRF 还是 ERA5 的最新文件？" } }],
  }));
  assert.equal(view.headline, "你想查看 WRF 还是 ERA5 的最新文件？");
  assert.match(view.notes[0], /直接在输入框回答/);
  assert.equal(view.tables.length, 0);
});

test("model unavailability is not disguised as an unsupported request", () => {
  const view = presentWorkflow(run("", {}, { status: "failed", recognition: { mode: "llm" },
    events: [{ type: "recognition_error", message: "意图识别服务暂时不可用，本次没有执行工具。" }] }));
  assert.match(view.notes.join(" "), /意图识别服务暂时不可用/);
  assert.equal(view.tables.length, 0);
});

test("resource links only target configured data or workflow chart hosts", () => {
  const safe = value => resourceUrl(value, "http://127.0.0.1:8002", "http://127.0.0.1:8010");
  assert.equal(safe("/data/test.webp"), "http://127.0.0.1:8002/data/test.webp");
  assert.equal(safe("http://127.0.0.1:8010/outputs/chart.png"), "http://127.0.0.1:8010/outputs/chart.png");
  for (const value of ["javascript:alert(1)", "file:///D:/data/a.nc", "https://evil.test/data/a.png", "http://127.0.0.1:8010/api/runs/run1", "http://user:pass@127.0.0.1:8002/data/a.png", "//evil.test/data/a.png"]) assert.equal(safe(value), "");
});

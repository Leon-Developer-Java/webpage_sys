import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  WORKFLOW_BASE, WORKFLOW_ORIGIN, workflowChat, workflowGetRun,
} from "../src/workflow-api.js";
import { presentWorkflow } from "../src/workflow-presentation.js";

const pageOrigin = "http://127.0.0.1:5177";
const originalFetch = globalThis.fetch;
let postCount = 0;
globalThis.fetch = async (url, options = {}) => {
  assert.ok(String(url).startsWith(WORKFLOW_BASE), `unexpected request target: ${url}`);
  const response = await originalFetch(url, { ...options, headers: { ...options.headers, Origin: pageOrigin } });
  if (options.method === "POST") postCount += 1;
  assert.equal(response.headers.get("access-control-allow-origin"), pageOrigin, `missing CORS header: ${url}`);
  return response;
};

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const session = `ui_post_${suffix}`;
const otherSession = `ui_other_${suffix}`;
const summaries = [];
async function chat(name, message, expectedStatus, targetSession = session) {
  const run = await workflowChat(targetSession, message);
  assert.equal(run.origin, WORKFLOW_ORIGIN);
  assert.equal(run.session_id, targetSession);
  assert.equal(run.status, expectedStatus, `${name}: ${run.events?.at(-1)?.message}`);
  assert.ok(run.run_id && run.events.every(event => event.origin === WORKFLOW_ORIGIN));
  const view = presentWorkflow(run);
  assert.ok(view.headline && view.title);
  assert.ok(!JSON.stringify(view).includes("[object Object]"));
  for (const table of view.tables) for (const row of table.rows) for (const cell of Object.values(row)) {
    if (cell?.fileId) assert.ok(view.files.some(file => file.id === cell.fileId));
  }
  if (run.status === "succeeded" && run.template_id === "weather.wrf_asset_summary") {
    assert.equal(Number(view.metrics[1].value), run.result.assets.length);
    assert.match(view.notes.join(" "), /不保证覆盖全库/);
  }
  summaries.push({ name, status: run.status, run_id: run.run_id, template_id: run.template_id,
    display: { headline: view.headline, metrics: view.metrics, tables: view.tables.map(table => ({ title: table.title, rows: table.rows.length })), file_references: view.files.length } });
  return run;
}
function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// The API resolves relative paths from backend_system/data, not this script's cwd.
const raw = resolve("../backend_system/data/ERA5/CRA40LAND_LAND_2022012003_GLB_34KM_HOUR_V1_0_0_1.nc").replaceAll("\\", "/");
const radarMeta = resolve("../backend_system/data/Radar/Z_RADR_I_BJSCN_20250601000000_O_DOR_MOC_CAP_FMT_4.nc.meta.json").replaceAll("\\", "/");
assert.ok(existsSync(raw), `real preview fixture is missing: ${raw}`);
assert.ok(existsSync(radarMeta), `radar fixture is missing: ${radarMeta}`);
const rawHash = digest(raw);
const rawDirectoryBefore = readdirSync("../backend_system/data/ERA5").sort();

await chat("asset inspection", "巡检数据资产", "succeeded");
await chat("dataset catalog", "查询 ERA5 数据集", "succeeded");
await chat("parse tasks", "列出 WRF 解析任务", "succeeded");
const latest = await chat("latest file", "查询最新 WRF 文件资产", "succeeded");
const fileUuid = latest.result?.file?.file_uuid;
assert.match(fileUuid, /^[0-9a-f-]{36}$/i);
const missing = await chat("missing file UUID", "查询指定文件资产", "need_input");
const continued = await chat("same-run input continuation", `file_uuid=${fileUuid}`, "succeeded");
assert.equal(continued.run_id, missing.run_id);
await chat("session-local reference", "查询这个文件的资产", "succeeded");
await chat("cross-session isolation", "查询这个文件的资产", "need_input", otherSession);
await chat("asset filters", "筛选 WRF T2 资产 limit=5", "succeeded");
await chat("parse failure diagnosis", "诊断 Radar 解析失败", "succeeded");
await chat("WRF summary", "汇总 WRF T2 资产", "succeeded");
const radar = await chat("radar analysis", `分析雷达回波变化 meta_files=["${radarMeta}"]`, "succeeded");
assert.ok(radar.result?.image_url?.startsWith(`${WORKFLOW_BASE}/outputs/`));
const imageResponse = await originalFetch(radar.result.image_url);
assert.equal(imageResponse.status, 200);
assert.ok(imageResponse.headers.get("content-type")?.startsWith("image/"));
await chat("unknown intent", "今天天气怎么样", "unsupported");
await chat("forbidden compound action", "删除数据然后查询数据资产", "unsupported");
await chat("out-of-scope path", "解析文件 file_path=\"D:/Desktop/not-allowed.nc\" business_type=ERA5", "rejected");
await chat("metadata parse refusal", `解析文件 file_path="${radarMeta}" business_type=Radar`, "rejected");
const preview = await chat("real parser preview", `解析文件 file_path="${raw}" business_type=ERA5`, "waiting_confirmation");
assert.equal(preview.plan.steps.at(-1).status, "waiting_confirmation");
assert.equal(preview.ticket?.consumed, false);
assert.equal(digest(raw), rawHash);
assert.deepEqual(readdirSync("../backend_system/data/ERA5").sort(), rawDirectoryBefore);

const invalidConfirmation = await originalFetch(`${WORKFLOW_BASE}/api/runs/${preview.run_id}/confirm`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: pageOrigin },
  body: JSON.stringify({ session_id: session, step_id: preview.ticket.step_id,
    ticket_id: "invalid-ticket", confirmed: true }),
});
postCount += 1;
assert.equal(invalidConfirmation.status, 409);
assert.equal(invalidConfirmation.headers.get("access-control-allow-origin"), pageOrigin);
assert.equal((await invalidConfirmation.json()).origin, WORKFLOW_ORIGIN);
assert.equal(digest(raw), rawHash);

const fetched = await workflowGetRun(preview.run_id, session);
assert.equal(fetched.status, "waiting_confirmation");
assert.equal(fetched.ticket.consumed, false);
const traces = await originalFetch(`${WORKFLOW_BASE}/api/sessions/${session}/traces`, { headers: { Origin: pageOrigin } });
assert.equal(traces.status, 200);
assert.equal(traces.headers.get("access-control-allow-origin"), pageOrigin);
assert.ok((await traces.json()).runs.length >= 1);

console.log(JSON.stringify({ origin: WORKFLOW_ORIGIN, session_id: session, post_count: postCount,
  checks: summaries, parser_preview: { run_id: preview.run_id, ticket_consumed: preview.ticket.consumed,
    source_sha256_unchanged: true, directory_listing_unchanged: true }, invalid_confirmation_http: 409 }, null, 2));

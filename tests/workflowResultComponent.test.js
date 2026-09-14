import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, compileScript, compileStyle } from "@vue/compiler-sfc";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";

const filename = new URL("../src/components/AgentWorkflowResult.vue", import.meta.url);
const source = readFileSync(filename, "utf8");
const parsed = parse(source, { filename: filename.pathname });
assert.deepEqual(parsed.errors, []);
const compiled = compileScript(parsed.descriptor, { id: "workflow-result-test", inlineTemplate: true });
let code = compiled.content;
for (const name of ["vue", "../workflow-api.js", "../workflow-presentation.js", "../agent-visualization.js"]) {
  const resolved = name === "vue" ? import.meta.resolve(name) : new URL(name, filename).href;
  code = code.replaceAll(`from "${name}"`, `from "${resolved}"`);
}
const viewerStub = `data:text/javascript;base64,${Buffer.from('export default { name: "AgentDataVisualization", template: "<div />" }').toString("base64")}`;
code = code.replaceAll('from "./AgentDataVisualization.vue"', `from "${viewerStub}"`);
const Component = (await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)).default;
const uuid = "123e4567-e89b-12d3-a456-426614174000";
const file = { file_uuid: uuid, original_file_name: "example.nc", data_type: "WRF" };
const makeRun = (extra = {}) => ({ origin: "workflow_orchestrator", run_id: "run-test", session_id: "s",
  status: "succeeded", template_id: "weather.file_assets", result: { summary: "INTERNAL_RAW_RETURN", file, assets: [file] }, ...extra });
const render = (run, extra = {}) => renderToString(createSSRApp(Component, { run, sessionId: "s", ...extra }));

test("business content is rendered ahead of collapsed raw JSON, without HTML injection", async () => {
  const html = await render(makeRun());
  const visibleSection = html.split("<summary>技术详情")[0];
  assert.match(visibleSection, /资产明细/);
  assert.match(visibleSection, /文件标识/);
  assert.match(visibleSection, /填入查询/);
  assert.doesNotMatch(visibleSection, /INTERNAL_RAW_RETURN/);
  assert.match(html, /<details><summary>技术详情/);
  assert.match(html, /INTERNAL_RAW_RETURN/);
  const malicious = { ...file, original_file_name: "<script>alert(1)</script>" };
  const escaped = await render(makeRun({ result: { file: malicious, assets: [malicious] } }));
  assert.doesNotMatch(escaped, /<script>alert/);
  assert.match(escaped, /&lt;script&gt;/);
});

test("table paging states shown and returned counts without losing rows", async () => {
  const html = await render(makeRun({ result: { file, assets: Array(12).fill(file) } }));
  assert.match(html, /已显示 10 \/ 12 条已返回记录/);
  assert.match(html, /再显示 10 条/);
  assert.equal((html.match(/class="file-reference"/g) || []).length, 10);
});

test("native AgentScope confirmation remains session-bound and respects response lock", async () => {
  const run = makeRun({ status: "waiting_confirmation", template_id: "parser.existing_file",
    runtime: "agentscope", _agentscope_confirmation: { reply_id: "reply-1", tool_calls: [{ id: "call-1" }] },
    result: { guardrail: { risk_level: "medium" } } });
  assert.match(await render(run), /<button type="button">确认执行<\/button>/);
  assert.match(await render(run, { locked: true }), /<button type="button" disabled>确认执行<\/button>/);
  assert.match(await render(run, { sessionId: "other" }), /<button type="button" disabled>确认执行<\/button>/);
});

test("winter archive confirmation names the replay and accepts a versioned archive id", async () => {
  const run = makeRun({ status: "waiting_confirmation", template_id: "icing.prepare_jilin_winter",
    ticket: { ticket_id: "t", session_id: "s", run_id: "run-test", step_id: "submit", expires_at: new Date(Date.now() + 60000).toISOString(), consumed: false },
    plan: { steps: [{ step_id: "submit", status: "waiting_confirmation" }] },
    result: { archive_id: "jilin_2025_winter_era5_v2" } });
  const html = await render(run);
  assert.match(html, /冬季覆冰档案预演完成/);
  assert.match(html, /确认回放冬季覆冰档案/);
  assert.doesNotMatch(html, /确认执行解析/);
});

test("query preparation is disabled outside workflow mode, and styles compile", async () => {
  const html = await render(makeRun(), { queryEnabled: false });
  assert.match(html, /disabled title="请先切换到通用工作流模式">填入查询/);
  const style = compileStyle({ source: parsed.descriptor.styles[0].content, id: "workflow-result-test", scoped: true });
  assert.deepEqual(style.errors, []);
});

test("LLM questions are escaped text and model provenance is visible in technical details", async () => {
  const question = '请说明数据类型 <script>alert(1)</script>';
  const html = await render(makeRun({ status: "need_input", result: {}, recognition: { mode: "llm", model: "test-model" },
    events: [{ type: "need_input", data: { question } }] }));
  assert.match(html, /直接在输入框回答/);
  assert.match(html, /LLM · test-model/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("structured response renders direct answer, sections, tables, references and multi-action plan", async () => {
  const response = {
    kind: "execution_result", title: "工作流执行结果", direct_answer: "已经完成两项只读查询。",
    highlights: [{ label: "动作数", value: 2, unit: "项" }],
    sections: [
      { heading: "数据资产巡检", paragraphs: ["任务数、文件数和资产数采用不同口径。"], status: "succeeded", action_id: "a1" },
      { heading: "最新成功文件", paragraphs: ["最新按入库时间选择。"], status: "succeeded", action_id: "a2" },
    ],
    tables: [{ id: "capabilities", title: "结果明细", columns: [{ key: "name", label: "名称" }], rows: [{ name: "WRF 文件" }], note: "结构化字段" }],
    references: [{ id: 1, name: "wrf.nc", file_uuid: uuid, source_path: "D:/data/wrf.nc", meta_path: "D:/data/wrf.nc.meta.json", data_type: "WRF" }],
    warnings: [], suggested_prompts: ["解释一下刚才的结果"], source_run_id: "run-test",
    understanding: { goal_summary: "先盘点资产，再查看最新 WRF 文件", normalized_parameters: [
      { action_id: "a2", parameter: "data_type", raw_value: "wrf", normalized_value: "WRF", note: "规范化大小写" },
    ] },
  };
  const run = makeRun({ template_id: "workflow.composed", response,
    actions: [
      { action_id: "a1", intent_id: "asset_overview", status: "succeeded", step_ids: ["a1__result"], origin: "agent" },
      { action_id: "a2", intent_id: "latest_file_assets", status: "succeeded", step_ids: ["a2__result"] },
    ] });
  const html = await render(run);
  const visible = html.split("<summary>技术详情")[0];
  assert.match(visible, /已经完成两项只读查询/);
  assert.match(visible, /数据资产巡检/);
  assert.match(visible, /执行计划/);
  assert.match(visible, /理解到的目标/);
  assert.match(visible, /规范化大小写/);
  assert.match(visible, /Agent 补充的只读步骤/);
  assert.match(visible, /WRF 文件/);
  assert.match(visible, /wrf.nc/);
  assert.match(visible, /解释一下刚才的结果/);
  assert.doesNotMatch(visible, /INTERNAL_RAW_RETURN/);
});

test("text workflow highlights keep their declared values", async () => {
  const response = {
    kind: "execution_result", title: "覆冰防控建议", direct_answer: "已生成建议。",
    highlights: [{ label: "风险预警", value: "蓝色", unit: "" }, { label: "过程趋势", value: "整体增厚", unit: "" }],
    sections: [], tables: [], references: [], warnings: [], suggested_prompts: [], understanding: {},
  };
  const html = await render(makeRun({ response }));
  assert.match(html, /蓝色/);
  assert.match(html, /整体增厚/);
  assert.doesNotMatch(html, /风险预警[\s\S]{0,180}未提供/);
});

test("registered weather file references offer the embedded system visualization", async () => {
  for (const dataType of ["CMA", "ERA5", "WRF", "Radar", "GFS", "ECMWF", "Himawari", "FY3"]) {
    const response = {
      kind: "execution_result", title: `${dataType} 数据`, direct_answer: `返回一个 ${dataType} 文件。`,
      highlights: [], sections: [], tables: [], warnings: [], suggested_prompts: [],
      references: [{ id: 1, name: `${dataType}.dat`, file_uuid: uuid, data_type: dataType }],
    };
    const html = await render(makeRun({ response }));
    assert.match(html, /在对话中查看/, dataType);
    assert.match(html, /查看默认图像|文件与数据集引用/, dataType);
  }
});

test("selected visualization is rendered once after the file-reference articles", () => {
  const filesSection = source.indexOf('class="workflow-files"');
  const articleStart = source.indexOf('class="workflow-file"', filesSection);
  const articleEnd = source.indexOf("</article>", articleStart);
  const viewer = source.indexOf("<AgentDataVisualization", articleEnd);
  const filesSectionEnd = source.indexOf("</section>", viewer);
  assert.ok(filesSection >= 0);
  assert.ok(articleStart > filesSection);
  assert.ok(articleEnd > articleStart);
  assert.ok(viewer > articleEnd);
  assert.ok(viewer < filesSectionEnd);
  assert.equal(source.slice(articleStart, articleEnd).includes("<AgentDataVisualization"), false);
});

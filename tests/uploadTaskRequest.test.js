import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { parse as parseSfc } from "@vue/compiler-sfc";

const source = readFileSync(new URL("../src/api.js", import.meta.url), "utf8");
const functions = new Set(["apiError", "getUploadTasks"]);
const script = parse(source, { sourceType: "module" }).program.body
  .map(node => node.type === "ExportNamedDeclaration" ? node.declaration : node)
  .filter(node => node?.type === "FunctionDeclaration" && functions.has(node.id.name))
  .map(node => source.slice(node.start, node.end)).join("\n");

test("upload task reads bypass browser caches", async () => {
  const calls = [];
  const context = vm.createContext({
    URLSearchParams,
    UPLOAD_BASE: "http://test.invalid",
    authedFetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { items: [], total: 0, summary: { total: 0 } } }),
      };
    },
  });
  vm.runInContext(script, context);

  const result = await context.getUploadTasks({ limit: 20, offset: 0 });

  assert.equal(result.total, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cache, "no-store");
  assert.match(calls[0].url, /limit=20/);
});

test("duplicate upload results are reported and located once per batch", () => {
  const vueSource = readFileSync(new URL("../src/views/Upload.vue", import.meta.url), "utf8");
  const setup = parseSfc(vueSource).descriptor.scriptSetup.content;
  const body = parse(setup, { sourceType: "module" }).program.body;
  const functionText = name => {
    const node = body.find(item => item.type === "FunctionDeclaration" && item.id.name === name);
    assert.ok(node, `Expected ${name} to be declared`);
    return setup.slice(node.start, node.end);
  };

  assert.doesNotMatch(functionText("run"), /ElMessageBox\.alert|refreshParseQueue/);
  assert.match(functionText("finalizeUploadBatch"), /ElMessageBox\.alert/);
  assert.match(functionText("finalizeUploadBatch"), /new Set\(queueIds\)/);
  assert.match(functionText("duplicateBatchMessage"), /个数据均重复/);
  assert.match(vueSource, /locatedDuplicateIds\.has\(f\.id\)/);
  assert.match(functionText("parseStatusText"), /等待集合.*received.*expected/s);
  assert.match(functionText("databaseCollectionToQueueItem"), /collectionReceivedCount:\s*receivedCount/);
  assert.match(functionText("databaseCollectionToQueueItem"), /集合 \$\{receivedCount\}\/\$\{expectedCount\}/);
  assert.match(vueSource, /class="tbl parse-tbl"/);
  assert.match(vueSource, /\.parse-tbl \.pin-l \{ right: 112px; \}/);
  assert.match(vueSource, /scrollbar-gutter: stable/);
});

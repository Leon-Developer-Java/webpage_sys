import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "@babel/parser";

const source = readFileSync(new URL("../src/api.js", import.meta.url), "utf8");
const functions = new Set(["catalogRequest", "apiError", "getDisplayResources", "getDisplayResource"]);
const script = parse(source, { sourceType: "module" }).program.body
  .map(node => node.type === "ExportNamedDeclaration" ? node.declaration : node)
  .filter(node => node?.type === "FunctionDeclaration" && functions.has(node.id.name))
  .map(node => source.slice(node.start, node.end)).join("\n");

function client(authedFetch) {
  const context = vm.createContext({ authedFetch, URLSearchParams, UPLOAD_BASE: "http://test.invalid" });
  vm.runInContext(script, context);
  return context;
}

test("catalog connection errors identify the unavailable service", async () => {
  const api = client(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(api.getDisplayResources("CMA"), /test\.invalid/);
});

test("catalog requests preserve parameters and backend error details", async () => {
  const urls = [];
  const api = client(async url => {
    urls.push(url);
    return { ok: false, status: 403, json: async () => ({ code: 403, detail: "denied" }) };
  });
  await assert.rejects(api.getDisplayResources("Radar", { limit: 20, offset: 10 }), /denied/);
  const params = new URL(urls[0]).searchParams;
  assert.equal(params.get("data_type"), "Radar");
  assert.equal(params.get("limit"), "20");
  assert.equal(params.get("offset"), "10");
});

test("non-JSON proxy errors include their HTTP status", async () => {
  const api = client(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError(); } }));
  await assert.rejects(api.getDisplayResource("test-file"), /HTTP 502/);
});

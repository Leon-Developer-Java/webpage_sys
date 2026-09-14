import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/views/Agent.vue", import.meta.url), "utf8");

test("session persistence restores the active conversation and keeps large model payloads out of local storage", () => {
  assert.match(source, /activeSessionId: activeId\.value/);
  assert.match(source, /const requestedActiveId = Array\.isArray\(parsed\) \? "" : parsed\.activeSessionId/);
  assert.match(source, /watch\(activeId, \(\) => save\(\)\)/);
  assert.match(source, /onMounted\(\(\) => \{\s*\/\/ Rewrite legacy array storage[\s\S]*?save\(\);/);
  assert.match(source, /function compactMessageForStorage\(message\)/);
  assert.match(source, /icingModel: message\.icingModel \? \{ \.\.\.message\.icingModel, result: null \} : null/);
  assert.match(source, /const active = sessions\.value\.find\(session => session\.id === activeId\.value\)/);
  assert.match(source, /msgs: active\.msgs\.slice\(-48\)/);
  assert.match(source, /Agent conversation history was not saved locally/);
  assert.doesNotMatch(source, /localStorage\.removeItem\(SKEY\)/);
});

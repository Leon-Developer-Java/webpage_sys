import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/views/Login.vue", import.meta.url), "utf8");

test("login and registration keep independent credentials", () => {
  assert.match(source, /const loginForm = reactive\(\{ username: "", password: "" \}\)/);
  assert.match(source, /const registerForm = reactive\(\{/);
  assert.match(source, /activeForm = computed\(\(\) => tab\.value === "login" \? loginForm : registerForm\)/);
  assert.doesNotMatch(source, /const form = reactive\(\{/);
});

test("ordinary users can navigate to the upload page", () => {
  const app = readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
  const router = readFileSync(new URL("../src/router.js", import.meta.url), "utf8");
  assert.match(app, /<router-link to="\/upload">数据上传<\/router-link>/);
  assert.doesNotMatch(router, /\["\/upload",\s*"\/agent"/);
});

import { mergeConfig } from "vite";
import { dirname, resolve } from "node:path";
import config from "./vite.config.js";

export default mergeConfig(config, {
  resolve: process.env.WRF_UI_TEST_BUNDLE ? { alias: [
    { find: /^@zhihuiqixiang\/wrf-ui\/status$/, replacement: resolve(dirname(process.env.WRF_UI_TEST_BUNDLE), "status.js") },
    { find: /^@zhihuiqixiang\/wrf-ui$/, replacement: process.env.WRF_UI_TEST_BUNDLE },
  ] } : {},
  cacheDir: process.env.WRF_AUTH_TEST_CACHE_DIR
    ? `${process.env.WRF_AUTH_TEST_CACHE_DIR}/vue`
    : "node_modules/.vite-agentscope-auth-test",
});

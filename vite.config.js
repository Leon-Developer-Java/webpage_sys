import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  resolve: { alias: process.env.WRF_UI_SOURCE_TEST === "1" ? [{find:/^@zhihuiqixiang\/wrf-ui\/status$/,replacement:new URL("./packages/wrf-ui/src/runLabels.js", import.meta.url).pathname},{find:/^@zhihuiqixiang\/wrf-ui$/,replacement:new URL("./packages/wrf-ui/src/index.js", import.meta.url).pathname}] : {} },
  optimizeDeps: { exclude: ['@zhihuiqixiang/wrf-ui'] },
  server: {
    port: parseInt(process.env.PORT) || 5177,
    host: "127.0.0.1",
    proxy: {
      "/api/upload": "http://127.0.0.1:8003",
      "/api/catalog": "http://127.0.0.1:8003",
    },
  },
  plugins: [vue({template:{compilerOptions:{isCustomElement:tag=>tag.startsWith('wrf-')}}})]
});

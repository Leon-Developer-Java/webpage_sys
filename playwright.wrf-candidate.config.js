import { defineConfig } from "@playwright/test";
import base from "./playwright.wrf.config.js";

// Use the staged bundle and a task-owned cache without changing live installs.
export default defineConfig({ ...base, webServer: {
  ...base.webServer,
  command: "npm run dev -- --config vite.agentscope-auth-test.config.js --port 5198 --strictPort",
} });

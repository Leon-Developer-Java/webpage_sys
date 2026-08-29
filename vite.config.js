import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  server: { port: parseInt(process.env.PORT) || 5177, host: "127.0.0.1" },
  plugins: [vue()]
});

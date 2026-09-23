import { createRouter, createWebHistory } from "vue-router";
import Overview from "./views/Overview.vue";
import Upload from "./views/Upload.vue";
import AgentScope from "./views/AgentScope.vue";
import Model from "./views/Model.vue";
import Login from "./views/Login.vue";
import Era5History from "./views/Era5History.vue";
import WrfStudio from "./views/WrfStudio.vue";

const routes = [
  { path: "/", component: Overview },
  { path: "/upload", component: Upload },
  { path: "/agent", component: AgentScope },
  { path: "/agent/wrf-evidence", component: () => import('./views/WrfEvidence.vue') },
  { path: "/model", component: Model },
  { path: "/login", component: Login },
  { path: "/era5-history", component: Era5History },
  { path: "/wrf", component: WrfStudio },
  { path: "/wrf/new", component: WrfStudio },
  { path: "/wrf/high-resolution", component: WrfStudio },
  // 保留旧链接兼容，直接进入独立的高分辨率任务页。
  { path: "/downscale", redirect: "/wrf/high-resolution" },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(to => {
  if (to.path === "/login" || to.path === "/era5-history") return true;
  if (!localStorage.getItem("token")) return "/login";
  const user = JSON.parse(localStorage.getItem("user") || "null");
  if ((["/agent", "/agent/wrf-evidence", "/model", "/wrf"].includes(to.path) || to.path.startsWith("/wrf/")) && (user?.role ?? 0) < 2) return "/";
  return true;
});

export default router;

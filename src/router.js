import { createRouter, createWebHistory } from "vue-router";
import Overview from "./views/Overview.vue";
import Upload from "./views/Upload.vue";
import Agent from "./views/Agent.vue";
import Login from "./views/Login.vue";

const routes = [
  { path: "/", component: Overview },
  { path: "/upload", component: Upload },
  { path: "/agent", component: Agent },
  { path: "/login", component: Login },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(to => {
  if (to.path === "/login") return true;
  if (!localStorage.getItem("token")) return "/login";
  const user = JSON.parse(localStorage.getItem("user") || "null");
  if ((to.path === "/upload" || to.path === "/agent") && (user?.role ?? 0) < 2) return "/";
  return true;
});

export default router;

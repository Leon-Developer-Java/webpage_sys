import { createRouter, createWebHistory } from "vue-router";
import Overview from "./views/Overview.vue";
import Upload from "./views/Upload.vue";
import Agent from "./views/Agent.vue";

const routes = [
  { path: "/", component: Overview },
  { path: "/upload", component: Upload },
  { path: "/agent", component: Agent },
];

export default createRouter({ history: createWebHistory(), routes });

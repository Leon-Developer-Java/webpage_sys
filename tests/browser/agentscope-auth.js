import { createApp, h, ref } from "vue";
import router from "../../src/router.js";

// Match the production router-first entry to avoid a fixture-only cycle.
const { default: AgentScope } = await import("../../src/views/AgentScope.vue");
const { authedFetch, ensureFreshToken, getToken, getUser } = await import("../../src/api.js");

const refreshes = {};
const requests = {};
window.authFixture = {
  ready: true,
  apply(token, user) {
    if (token) localStorage.setItem("token", token);
    else localStorage.removeItem("token");
    if (user) localStorage.setItem("user", JSON.stringify(user));
    else localStorage.removeItem("user");
    window.dispatchEvent(new Event("weather-auth-changed"));
  },
  beginRefresh(id) {
    refreshes[id] = "pending";
    void ensureFreshToken().then(
      () => { refreshes[id] = "done"; },
      () => { refreshes[id] = "error"; },
    );
  },
  beginRequest(id, method = "GET") {
    requests[id] = { state: "pending" };
    void authedFetch("/__fixture__/protected", {
      method,
      ...(method === "POST" ? { body: JSON.stringify({ source: "original-user-intent" }) } : {}),
    }).then(async response => {
      requests[id] = { state: "done", status: response.status, data: await response.json() };
    }).catch(error => {
      requests[id] = { state: "error", message: error.message };
    });
  },
  state() {
    return { user: getUser(), hasToken: Boolean(getToken()), refreshes: { ...refreshes }, requests: { ...requests } };
  },
};

const apiOnly = new URLSearchParams(location.search).has("api-only");
createApp({
  render: () => h("main", { style: "height:100vh;display:grid" }, [
    apiOnly ? h("p", "Authentication transport fixture") : h(AgentScope),
  ]),
}).provide("theme", ref(true)).use(router).mount("#fixture");

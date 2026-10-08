import { api } from "./api.js";
import { make, icon, toast as pushToast, el } from "./ui.js";
import * as dashboard from "./views/dashboard.js";
import * as board from "./views/board.js";
import * as deploys from "./views/deploys.js";
import * as preuat from "./views/preuat.js";
import * as scans from "./views/scans.js";
import * as testing from "./views/testing.js";
import * as secrets from "./views/secrets.js";
import * as settings from "./views/settings.js";

const VIEWS = { dashboard, board, deploys, preuat, scans, testing, secrets, settings };

const NAV = [
  ["Overview", [["dashboard", "Dashboard", "grid"]]],
  ["Delivery", [["board", "Board", "board"], ["deploys", "Deploys", "bolt"]]],
  ["Release", [["preuat", "Pre-UAT", "box"]]],
  ["Quality", [["scans", "Scans", "shield"], ["testing", "Testing", "check"]]],
  ["Infrastructure", [["secrets", "Secrets", "key"]]],
  ["Admin", [["settings", "Settings", "gear"]]],
];

const dom = {
  nav: document.querySelector("[data-nav]"),
  scope: document.querySelector("[data-scope]"),
  view: document.querySelector("[data-view]"),
  title: document.querySelector("[data-title]"),
  subtitle: document.querySelector("[data-subtitle]"),
  who: document.querySelector("[data-who]"),
  stream: document.querySelector("[data-stream]"),
  toasts: document.querySelector("[data-toasts]"),
  refresh: document.querySelector("[data-refresh]"),
};

const state = {
  me: null,
  project: "all",
  recent: [],
  rendering: null,
};

const can = (permission) => !!state.me && state.me.permissions.includes(permission);

function parseHash() {
  const [path, search] = location.hash.slice(2).split("?");
  const [view, tab] = (path || "dashboard").split("/");
  return {
    view: VIEWS[view] ? view : "dashboard",
    tab: tab || null,
    q: Object.fromEntries(new URLSearchParams(search || "")),
  };
}

function ctxFor(route) {
  const set = (patch) => {
    const next = { ...route, ...patch };
    const query = new URLSearchParams(next.q).toString();
    location.hash = `#/${next.view}${next.tab ? `/${next.tab}` : ""}${query ? `?${query}` : ""}`;
  };
  return {
    me: state.me,
    project: state.project,
    tab: route.tab,
    q: route.q,
    now: Date.now(),
    can,
    setTab: (tab) => set({ tab }),
    setQ: (patch) => set({ q: { ...route.q, ...patch } }),
    reload,
    toast: (message, kind) => pushToast(dom.toasts, message, kind),
    recent: () => state.recent.slice(),
  };
}

async function reload() {
  const route = parseHash();
  if (state.rendering) return state.rendering;
  state.rendering = (async () => {
    const module = VIEWS[route.view];
    dom.title.textContent = module.meta.title;
    dom.subtitle.textContent = module.meta.subtitle;
    dom.nav.querySelectorAll(".nav-item").forEach((b) => {
      if (b.dataset.target === route.view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    try {
      const node = await module.render(ctxFor(route));
      dom.view.replaceChildren(node);
      dom.view.classList.remove("enter");
      void dom.view.offsetWidth;
      dom.view.classList.add("enter");
    } catch (err) {
      dom.view.replaceChildren(make("p", `callout ${err.status === 403 ? "warn" : "bad"}`, [
        icon(err.status === 403 ? "shield" : "alert"),
        make("span", null, `${module.meta.title}: ${err.message}`),
      ]));
    } finally {
      state.rendering = null;
    }
  })();
  return state.rendering;
}

function buildNav() {
  dom.nav.replaceChildren();
  for (const [group, items] of NAV) {
    dom.nav.appendChild(make("p", "nav-group", group));
    for (const [view, label, iconName] of items) {
      const node = make("button", "nav-item", [icon(iconName), document.createTextNode(label)], { type: "button" });
      node.dataset.target = view;
      node.addEventListener("click", () => { location.hash = `#/${view}`; });
      dom.nav.appendChild(node);
    }
  }
}

function setStream(kind, text) {
  dom.stream.className = `stream${kind ? ` ${kind}` : ""}`;
  dom.stream.lastElementChild.textContent = text;
}

function remember(event, payload) {
  const at = new Date().toISOString().slice(11, 19);
  const detail = payload && (payload.releaseTag || payload.ticket || payload.env || payload.code || "")
    ? JSON.stringify(payload).slice(0, 140) : "";
  state.recent.unshift({ at, kind: event, detail });
  state.recent = state.recent.slice(0, 40);
}

function connect() {
  const source = new EventSource("/api/stream");
  source.onopen = () => setStream("on", "live");
  source.onerror = () => setStream("bad", "reconnecting");
  for (const kind of ["ticket", "approval", "refused", "promotion", "heartbeat"]) {
    source.addEventListener(kind, (e) => {
      let payload = null;
      try { payload = JSON.parse(e.data); } catch { /* a heartbeat carries no body */ }
      if (kind === "heartbeat") return;
      remember(kind, payload);
      setStream("on", kind === "refused" ? "refusal streamed" : "live");
      if (["dashboard", "board", "preuat", "deploys"].includes(parseHash().view)) reload();
    });
  }
}

async function boot() {
  const me = await api.get("/api/auth/whoami");
  if (!me || !me.email) { location.href = "/login.html"; return; }
  state.me = me;

  dom.who.replaceChildren(
    el("b", null, me.role),
    el("span", null, me.email),
  );
  dom.refresh.appendChild(icon("refresh"));
  dom.refresh.addEventListener("click", () => { reload(); });
  document.querySelector("[data-signout]").addEventListener("click", async () => {
    await api.post("/api/auth/logout").catch(() => null);
    location.href = "/login.html";
  });

  const { projects } = await api.get("/api/projects");
  dom.scope.replaceChildren(make("option", null, "All projects", { value: "all" }),
    ...projects.map((p) => make("option", null, p.displayName, { value: p.id })));
  dom.scope.value = state.project;
  dom.scope.addEventListener("change", async () => {
    state.project = dom.scope.value;
    await api.post("/api/scope", { project: state.project }).catch(() => null);
    reload();
  });

  buildNav();
  window.addEventListener("hashchange", reload);
  connect();
  await reload();
}

boot().catch((err) => {
  if (err.status !== 401) {
    dom.view.replaceChildren(el("p", "callout bad", `startup failed: ${err.message}`));
  }
});

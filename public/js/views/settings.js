import { api } from "../api.js";
import { make, panel, badge, table, button, callout, stamp, duration, icon } from "../ui.js";
import { kv } from "../parts.js";

export const meta = { title: "Settings", subtitle: "Projects, roles, pipeline keys, the audit trail and self-reported health" };

const TABS = [["projects", "Projects"], ["access", "Users & roles"], ["keys", "Pipeline keys"], ["audit", "Audit log"], ["health", "Health"]];

export async function render(ctx) {
  const tab = ctx.tab || "projects";
  const bar = make("div", "tabs", null, { role: "tablist" });
  for (const [id, text] of TABS) {
    const node = make("button", "tab", text, { type: "button", role: "tab", "aria-selected": String(id === tab) });
    node.addEventListener("click", () => ctx.setTab(id));
    bar.appendChild(node);
  }
  const body = {
    projects: listProjects, access, keys, audit, health,
  }[tab](ctx);
  return make("div", null, [bar, make("div", "stack", [await body])]);
}

async function listProjects() {
  const { projects } = await api.get("/api/projects");
  const columns = [
    { head: "Project", className: "mono name", render: (p) => p.id },
    { head: "Display name", render: (p) => p.displayName },
    { head: "Services", className: "num", render: (p) => p.services },
    { head: "Repos", className: "num", render: (p) => p.repos },
    { head: "Pipelines", className: "num", render: (p) => p.pipelines },
    { head: "Created", className: "mono nowrap", render: (p) => stamp(p.createdAt) },
  ];
  return panel("Projects", {
    sub: `${projects.length} configured`,
    flush: true,
    body: table(columns, projects),
    note: "The project filter in the sidebar scopes every view to one row of this table.",
  });
}

async function access(ctx) {
  let payload;
  try {
    payload = await api.get("/api/users");
  } catch (err) {
    if (err.status !== 403) throw err;
    return callout("bad", "shield", make("span", null, [
      make("b", null, "403: user:read belongs to admin. "),
      `You are signed in as ${ctx.me.role}. The list of who holds which role is itself access information, so it is gated rather than tidied away.`,
    ]));
  }

  const { users, matrix } = payload;
  const roles = [...new Set(Object.values(matrix).flat())];
  const userColumns = [
    { head: "Email", className: "mono name", render: (u) => u.email },
    { head: "Role", render: (u) => badge(u.role, "mono") },
    { head: "Permissions", className: "num", render: (u) => Object.keys(matrix).filter((p) => matrix[p].includes(u.role)).length },
  ];
  const policyColumns = [
    { head: "Permission", className: "mono name", render: (row) => row.permission },
    ...roles.map((role) => ({
      head: role,
      render: (row) => (row.holders.includes(role)
        ? make("span", "chip on", "granted")
        : make("span", "chip", "no")),
    })),
  ];
  const rows = Object.keys(matrix).map((permission) => ({ permission, holders: matrix[permission] }));

  return make("div", "stack", [
    panel("Accounts", {
      sub: "identity without credential material",
      flush: true,
      body: table(userColumns, users),
      note: "Salts and digests are never serialised to this view: a directory listing has no reason to carry the thing that proves a password.",
    }),
    panel("Access policy", {
      sub: `${rows.length} permissions · ${roles.length} roles`,
      flush: true,
      body: table(policyColumns, rows),
      note: "The matrix is the server's own table, read back over the API. Editing the UI cannot widen a right, because the UI is rendering the policy rather than defining it.",
    }),
  ]);
}

async function keys(ctx) {
  const box = make("div");
  const rotate = async (event) => {
    const btn = event.target.closest("button");
    btn.disabled = true;
    try {
      const { key, note } = await api.post("/api/admin/keys/rotate");
      box.replaceChildren(callout("warn", "key", make("span", null, [
        make("b", null, "Shown once. "),
        `${key}. ${note}. It is stored as a SHA-256 digest, so this response is the only place the plaintext has ever existed.`,
      ])));
      ctx.toast("pipeline key rotated", "ok");
    } catch (err) {
      box.replaceChildren(callout("bad", "shield", err.message));
      btn.disabled = false;
    }
  };

  return make("div", "stack", [
    callout("", "info", make("span", null, [
      "Machine callers, the pipeline job and the board bot, present a key instead of a session. ",
      make("b", null, "Two digests are accepted during a rotation"),
      " so a release window never has to wait for a human.",
    ])),
    panel("Rotation", {
      body: make("div", "stack", [
        make("div", "inline-fields", [
          button("Rotate pipeline key", { kind: "primary", iconName: "refresh", disabled: !ctx.can("key:rotate"), onClick: rotate }),
          !ctx.can("key:rotate") && make("span", "dim", "key:rotate belongs to admin."),
        ]),
        box,
      ]),
    }),
  ]);
}

async function audit(ctx) {
  let entries;
  try {
    ({ entries } = await api.get("/api/admin/audit?limit=120"));
  } catch (err) {
    if (err.status !== 403) throw err;
    return callout("bad", "shield", make("span", null, [
      make("b", null, "403: audit:read. "),
      "A developer can see the board and every refusal on it, but not the trail of everyone else's actions.",
    ]));
  }
  const columns = [
    { head: "When", className: "mono nowrap", render: (e) => stamp(e.at) },
    { head: "Kind", render: (e) => badge(e.kind, ["refused", "login-failed", "conflict", "key-rotated"].includes(e.kind) ? "bad" : "mono") },
    { head: "Actor", className: "mono", render: (e) => e.actor || e.email || "system" },
    { head: "Subject", className: "mono", render: (e) => e.ticket || e.releaseTag || e.path || e.project || "" },
    { head: "Detail", render: (e) => make("span", "dim", e.code || e.reason || e.env || e.result || e.role || "") },
  ];
  return panel("Audit log", {
    sub: `${entries.length} most recent entries, append-only JSONL`,
    flush: true,
    body: entries.length ? table(columns, entries.slice().reverse(), { scroll: true })
      : make("div", "empty", [icon("inbox", 26), make("p", "n", "Nothing recorded yet")]),
    note: "Refusals are written with the same care as approvals. Six months later, the question is what a person was shown when they clicked.",
  });
}

async function health() {
  const h = await api.get("/api/health");
  return make("div", "stack", [
    panel("Process", {
      body: kv([
        ["Status", h.ok ? "serving" : "degraded"],
        ["Uptime", duration(h.uptimeSeconds)],
        ["Stream subscribers", String(h.subscribers)],
        ["Runtime dependencies", "express"],
        ["Build step", "none, the browser loads these modules directly"],
      ]),
    }),
    panel("Store", {
      sub: "row counts read back from disk on this request",
      body: kv(Object.entries(h.collections).map(([k, v]) => [k, String(v)])),
      note: "If a collection file were corrupt, this page would fail rather than show a green tick: the counts come from parsing it.",
    }),
  ]);
}

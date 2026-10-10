import { api, scoped } from "../api.js";
import { make, panel, badge, button, table, select, stamp, duration, callout, icon } from "../ui.js";
import { filters, kv } from "../parts.js";

export const meta = { title: "Deployments", subtitle: "History, the promotion ladder, and the live event stream" };

const TABS = [["history", "History"], ["promote", "Promote"], ["monitoring", "Monitoring"]];
const ENVS = [["sit", "SIT"], ["uat", "UAT"], ["prod", "PROD"]];

export async function render(ctx) {
  const tab = ctx.tab || "history";
  const body = tab === "history" ? await history(ctx) : tab === "promote" ? await promote(ctx) : monitoring(ctx);
  const tabs = make("div", "tabs", null, { role: "tablist" });
  for (const [id, text] of TABS) {
    const node = make("button", "tab", text, { type: "button", role: "tab", "aria-selected": String(id === tab) });
    node.addEventListener("click", () => ctx.setTab(id));
    tabs.appendChild(node);
  }
  return make("div", null, [tabs, body]);
}

async function history(ctx) {
  const env = ctx.q.env || "all";
  const days = ctx.q.days || "30";
  const { total, deployments } = await api.get(
    `${scoped("/api/deployments", ctx.project)}&env=${env}&days=${days}&limit=200`);

  const columns = [
    { head: "When", className: "mono nowrap", render: (d) => stamp(d.at) },
    { head: "Service", className: "name", render: (d) => d.service },
    { head: "Environment", render: (d) => badge(d.env, d.env === "prod" ? "bad" : d.env === "uat" ? "warn" : "info") },
    { head: "Version", className: "mono", render: (d) => d.version },
    { head: "Result", render: (d) => badge(d.result) },
    { head: "Duration", className: "num", render: (d) => duration(d.durationSeconds) },
    { head: "Pipeline", className: "mono", render: (d) => d.pipeline },
    { head: "Actor", className: "mono", render: (d) => d.actor },
  ];

  return make("div", "stack", [
    callout("", "info", make("span", null, [
      make("b", null, "Deployment history. "),
      "Every row was written by the promotion endpoint or by a pipeline presenting an API key. The board keeps no separate record.",
    ])),
    filters([
      select("Environment", [["all", "All environments"], ...ENVS], env, (v) => ctx.setQ({ env: v })),
      select("Window", [["7", "Last 7 days"], ["30", "Last 30 days"], ["84", "Since the fixtures begin"]], days, (v) => ctx.setQ({ days: v })),
      make("span", "count", `${total} deployment(s), showing ${deployments.length}`),
    ]),
    panel(null, { flush: true, body: deployments.length
      ? table(columns, deployments, { scroll: true })
      : make("div", "empty", [icon("inbox", 26), make("p", "n", "No deployments in this window"), make("p", "dim", "Widen the filter, or promote a ticket from the Board view.")]) }),
  ]);
}

async function promote(ctx) {
  const [{ tickets }, { ladder }] = await Promise.all([api.get("/api/tickets"), api.get("/api/promotions")]);
  const eligible = tickets.filter((t) => t.phase === "merged" || t.phase === "deployed");
  const env = ctx.q.env || "sit";
  const target = eligible.find((t) => t.id === ctx.q.ticket) || eligible[0];

  const note = make("div", "stack");
  const run = async () => {
    note.replaceChildren();
    try {
      const entry = await api.post(`/api/promotions/${env}`, { ticket: target.id });
      note.appendChild(callout("", "check", `Recorded ${entry.releaseTag} in ${entry.env} at ${entry.actor}.`));
      ctx.toast(`${entry.releaseTag} → ${entry.env}`, "ok");
    } catch (err) {
      note.appendChild(callout("bad", "alert", err.refused || err.message));
      ctx.toast(err.refused || err.message, "bad");
    }
  };

  const allowed = ctx.can(`deploy:${env}`);
  return make("div", "stack", [
    callout("warn", "alert", make("span", null, [
      "A rung opens only when the same release tag has already succeeded one level below, and never to the person who ran that lower rung. ",
      make("b", null, "The form below cannot bypass that. Try it, and the refusal is the point."),
    ])),
    panel("Promote a release tag", {
      sub: ladder.join(" → "),
      body: make("div", "stack", [
        make("div", "inline-fields", [
          select("Ticket", eligible.length ? eligible.map((t) => [t.id, `#${t.id} ${t.title}`]) : [["", "nothing is merged yet"]],
            target ? target.id : "", (v) => ctx.setQ({ ticket: v })),
          select("Target environment", ENVS, env, (v) => ctx.setQ({ env: v })),
          button("Promote", { kind: "primary", iconName: "up", disabled: !target || !allowed, onClick: run }),
        ]),
        target && make("div", "table-wrap", table([
          { head: "Service", className: "name", render: (t) => t.service },
          { head: "Phase", render: (t) => badge(t.phase) },
          { head: "Release tag", className: "mono", render: (t) => t.releaseTag },
          { head: "Revision", className: "num", render: (t) => t.revision },
          { head: "Approvals", className: "num", render: (t) => Object.keys(t.approvals || {}).filter((k) => k !== "_last").length },
        ], [target])),
        !allowed && callout("bad", "shield", `Your role cannot deploy to ${env.toUpperCase()}. The button is disabled because the server would answer 403, and the console does not pretend otherwise.`),
        note,
      ]),
    }),
  ]);
}

function monitoring(ctx) {
  const recent = ctx.recent();
  return make("div", "split", [
    panel("Live event stream", {
      sub: "server-sent events, one connection per tab",
      body: recent.length
        ? make("div", "log", recent.map((e) => make("div", null, [
          make("span", "t", e.at), " ", make("span", e.kind === "refused" ? "bad" : "k", e.kind),
          " ", make("span", null, e.detail),
        ])))
        : make("div", "log", make("div", "t", "waiting for the next event…")),
      note: "Refusals stream too: an operator should see a guard fire without opening the audit file.",
    }),
    panel("Server", { sub: "self-reported, not a static ok", body: health(ctx) }),
  ]);
}

function health(ctx) {
  const box = make("div", "dim", "loading");
  api.get("/api/health").then((h) => {
    box.replaceChildren(kv([
      ["Status", h.ok ? "serving" : "degraded"],
      ["Uptime", duration(h.uptimeSeconds)],
      ["Stream subscribers", h.subscribers],
      ["Services", h.collections.services],
      ["Deployments recorded", h.collections.deployments],
      ["Tickets", h.collections.tickets],
      ["Scan rows", h.collections.scans],
      ["Secret paths", h.collections.secrets],
    ]));
  }).catch((err) => { box.textContent = err.message; });
  return box;
}

import { api, scoped } from "../api.js";
import { make, panel, badge, button, table, metric, callout, stamp, icon } from "../ui.js";
import { LAYERS } from "../parts.js";

export const meta = { title: "Pre-UAT review", subtitle: "The release gate: only drifted versions reach this list" };

const TABS = [["review", "Current review"], ["history", "Release history"]];

export async function render(ctx) {
  const tab = ctx.tab || "review";
  const bar = make("div", "tabs", null, { role: "tablist" });
  for (const [id, text] of TABS) {
    const node = make("button", "tab", text, { type: "button", role: "tab", "aria-selected": String(id === tab) });
    node.addEventListener("click", () => ctx.setTab(id));
    bar.appendChild(node);
  }
  return make("div", null, [bar, tab === "review" ? await review(ctx) : await history(ctx)]);
}

async function review(ctx) {
  const { plan } = await api.get(scoped("/api/plans", ctx.project));
  const ready = plan.filter((p) => p.gate === "ready");
  const blocked = plan.filter((p) => p.gate === "blocked");

  const note = make("div");
  const promote = (row) => async (event) => {
    const btn = event.target.closest("button");
    btn.disabled = true;
    try {
      const entry = await api.post("/api/promotions/uat", { ticket: row.ticket.id });
      note.replaceChildren(callout("", "check", `${entry.releaseTag} recorded in uat. The version table updates on the next stream event.`));
      ctx.toast(`${entry.releaseTag} → uat`, "ok");
    } catch (err) {
      const why = err.refused || err.message;
      note.replaceChildren(callout("bad", "alert", why));
      ctx.toast(why, "bad");
      btn.disabled = false;
    }
  };

  const columns = [
    { head: "Service", className: "name", render: (r) => r.name },
    { head: "Project", render: (r) => r.project },
    { head: "UAT now", className: "mono", render: (r) => r.from || "never" },
    { head: "SIT waiting", className: "mono", render: (r) => r.to },
    { head: "Ticket", className: "mono", render: (r) => (r.ticket ? `#${r.ticket.id} ${r.ticket.phase}` : "none") },
    { head: "Gate", render: (r) => badge(r.gate) },
    { head: "Why", render: (r) => (r.blockers.length ? make("span", "dim", r.blockers.join(" · ")) : make("span", "dim", "all conditions met")) },
    { head: "", render: (r) => (r.gate === "ready" && r.ticket
      ? button("Promote", { small: true, kind: "primary", iconName: "up", disabled: !ctx.can("deploy:uat"),
        title: ctx.can("deploy:uat") ? "Open the UAT rung for this tag" : "deploy:uat belongs to ops - your role cannot open this rung", onClick: promote(r) })
      : "") },
  ];

  return make("div", "stack", [
    make("div", "metrics", [
      metric("Services to deploy", plan.length, "version drift detected"),
      metric("Ready", ready.length, "traceable and gate-clean", "ok"),
      metric("Blocked", blocked.length, "missing a ticket or a passing gate", "warn"),
      metric("Approval layers", LAYERS.length, "all five before a merge"),
    ]),
    callout("warn", "alert", make("span", null, [
      make("b", null, "Nothing here is optional. "),
      "A row with no ticket cannot be promoted even if its versions differ, because the control plane would be shipping an untraceable artifact.",
    ])),
    panel("Services to deploy", {
      sub: `${plan.length} service(s) with version changes`,
      flush: true,
      body: plan.length
        ? table(columns, plan)
        : make("div", "empty", [icon("check", 26), make("p", "n", "SIT and UAT are in step"), make("p", "dim", "There is nothing to review for this project right now.")]),
    }),
    note,
  ]);
}

async function history(ctx) {
  const { ledger } = await api.get("/api/promotions");
  const columns = [
    { head: "When", className: "mono nowrap", render: (e) => stamp(e.at) },
    { head: "Release tag", className: "mono name", render: (e) => e.releaseTag },
    { head: "Environment", render: (e) => badge(e.env, e.env === "prod" ? "bad" : e.env === "uat" ? "warn" : "info") },
    { head: "Result", render: (e) => badge(e.result) },
    { head: "Actor", className: "mono", render: (e) => e.actor },
    { head: "Reason", className: "dim", render: (e) => e.reason || "" },
  ];
  return make("div", "stack", [
    panel("Release ledger", {
      sub: `${ledger.length} entries · append-only`,
      flush: true,
      body: ledger.length
        ? table(columns, ledger, { scroll: true })
        : make("div", "empty", [icon("inbox", 26), make("p", "n", "No promotions recorded yet"), make("p", "dim", "Run npm run seed, or promote a ticket from the board.")]),
      note: "This table is the ladder. Deleting a row does not un-deploy anything, which is why the file is written atomically and never edited in place.",
    }),
  ]);
}

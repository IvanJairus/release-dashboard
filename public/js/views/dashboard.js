import { api, scoped } from "../api.js";
import { make, panel, metric, badge, table, detailRow, stamp, duration, ago } from "../ui.js";
import { frequencyChart, parityChart, legend } from "../charts.js";

export const meta = { title: "Dashboard", subtitle: "Version drift and deploy health across every environment" };

export async function render(ctx) {
  const data = await api.get(scoped("/api/overview", ctx.project));
  const s = data.stats;

  const metrics = make("div", "metrics", [
    metric("Services", s.services, `${s.projects} projects`),
    metric("Success rate", `${s.successRate}%`, `${s.deploys - s.failedWindow} of ${s.deploys} deploys`, "ok"),
    metric("SIT ≠ UAT", s.drifted, `${s.neverPromoted} never promoted`, "warn"),
    metric("Deploys", s.deploys, `${s.deploysWindow} in the last 30 days`),
    metric("Median deploy", duration(s.medianSeconds), `p90 ${duration(s.p90Seconds)}`),
  ]);

  const freq = panel("Deployment frequency", {
    sub: "last 12 weeks, by ISO week",
    right: legend([["", "success"], ["fail", "failed"]]),
    body: frequencyChart(data.frequency),
  });

  const parity = panel("Version parity", {
    sub: "how much of each project is actually in step",
    right: legend([["ok", "in step"], ["warn", "drifted"], ["info", "never promoted"]]),
    body: parityChart(data.versions),
  });

  const columns = [
    { head: "Service", className: "name", render: (r) => r.name },
    { head: "Project", render: (r) => r.project },
    { head: "SIT", className: "mono", render: (r) => r.sit },
    { head: "UAT", className: "mono", render: (r) => r.uat },
    { head: "PROD", className: "mono", render: (r) => r.prod },
    { head: "State", render: (r) => badge(r.state === "same" ? "in step" : r.state === "diff" ? "drift" : "new",
      r.state === "same" ? "ok" : r.state === "diff" ? "warn" : "info") },
    { head: "Deployed to SIT", render: (r) => make("span", "mono nowrap", ago(r.deployedAt, ctx.now)) },
  ];

  const rows = data.versions;
  const grid = panel("Version comparison", {
    sub: `${rows.length} services · click a row for the artifact trail`,
    flush: true,
    body: table(columns, rows, {
      onRow: (row, tr) => {
        const next = tr.nextElementSibling;
        if (next && next.classList.contains("detail")) { next.remove(); tr.setAttribute("aria-expanded", "false"); return; }
        tr.parentElement.querySelectorAll("tr.detail").forEach((d) => d.remove());
        tr.parentElement.querySelectorAll("tr.row-toggle").forEach((d) => d.setAttribute("aria-expanded", "false"));
        const gate = data.gates.find((g) => g.service === row.id);
        tr.after(detailRow([
          ["Repository", `${row.project}/${row.id}`],
          ["Artifact", `${row.artifact} · ${row.artifact === "web" ? "bundle" : "container image"}`],
          ["SonarQube gate", gate ? gate.sonar : "not scanned"],
          ["Coverage", gate ? `${gate.coverage}%` : "—"],
          ["Critical image findings", gate ? gate.trivyCritical : "—"],
          ["UAT running since", stamp(row.deployedAt)],
        ]));
        tr.setAttribute("aria-expanded", "true");
      },
    }),
    note: "The release plan is generated from this table alone: a service whose SIT version equals its UAT version cannot be added to a plan.",
  });

  return make("div", "stack", [metrics, make("div", "chart-grid", [freq, parity]), grid]);
}

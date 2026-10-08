import { api, scoped } from "../api.js";
import { make, panel, badge, table, metric, callout, ago } from "../ui.js";
import { passBar } from "../charts.js";

export const meta = { title: "Scans", subtitle: "SonarQube quality gates, image findings and the coverage they block on" };

export async function render(ctx) {
  const { scans } = await api.get(scoped("/api/scans", ctx.project));
  const failed = scans.filter((s) => s.sonar.qualityGate === "failed").length;
  const warned = scans.filter((s) => s.sonar.qualityGate === "warn").length;
  const criticals = scans.reduce((n, s) => n + s.trivy.critical, 0);

  const columns = [
    { head: "Service", className: "name", render: (s) => s.service },
    { head: "Project", render: (s) => s.project },
    { head: "Quality gate", render: (s) => badge(s.sonar.qualityGate) },
    { head: "Coverage", render: (s) => passBar(s.sonar.coverage, 100, { okAt: 80, warnAt: 60 }) },
    { head: "Blockers", className: "num", render: (s) => s.sonar.blockers },
    { head: "Criticals", className: "num", render: (s) => s.sonar.criticals },
    { head: "Bugs", className: "num", render: (s) => s.sonar.bugs },
    { head: "Image critical", className: "num", render: (s) => (s.trivy.critical ? make("b", "mono", s.trivy.critical) : make("span", "mono", "0")) },
    { head: "Image high", className: "num", render: (s) => s.trivy.high },
    { head: "Image", className: "mono", render: (s) => s.trivy.image },
    { head: "Scanned", render: (s) => make("span", "mono nowrap", ago(s.sonar.scannedAt, ctx.now)) },
  ];

  return make("div", "stack", [
    make("div", "metrics", [
      metric("Scanned services", scans.length, "sonar and trivy, per service"),
      metric("Gates passed", scans.length - failed - warned, `${warned} with warnings`, "ok"),
      metric("Gates failed", failed, "these cannot reach UAT", failed ? "warn" : ""),
      metric("Critical findings", criticals, "across all images", criticals ? "warn" : "ok"),
    ]),
    callout("", "info", make("span", null, [
      "The pre-UAT review reads this table. A failed quality gate or a non-zero critical image finding removes a service from the promotion list, ",
      make("b", null, "and the review says which one it was."),
    ])),
    panel("Quality and security gates", {
      sub: "one row per service, refreshed by the scan job",
      flush: true,
      body: table(columns, scans),
      note: "Coverage is shown as a bar against 100, not as a bare number, so a 61% service is recognisable without reading every cell.",
    }),
  ]);
}

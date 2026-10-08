import { api, scoped } from "../api.js";
import { make, panel, badge, table, metric, stamp, icon } from "../ui.js";
import { passBar } from "../charts.js";

export const meta = { title: "Testing", subtitle: "Regression suites and device runs recorded against each environment" };

export async function render(ctx) {
  const { testRuns } = await api.get(scoped("/api/test-runs", ctx.project));
  const cases = testRuns.reduce((n, r) => n + r.total, 0);
  const passed = testRuns.reduce((n, r) => n + r.passed, 0);
  const rate = cases ? ((passed / cases) * 100).toFixed(1) : "0";

  const columns = [
    { head: "Suite", className: "name", render: (r) => r.suite },
    { head: "Service", render: (r) => r.service },
    { head: "Environment", render: (r) => badge(r.env, r.env === "uat" ? "warn" : "info") },
    { head: "Device", className: "mono", render: (r) => r.device || "—" },
    { head: "Cases", className: "num", render: (r) => r.total },
    { head: "Passed", className: "num", render: (r) => r.passed },
    { head: "Pass rate", render: (r) => passBar(r.passed, r.total) },
    { head: "Duration", className: "num", render: (r) => `${Math.floor(r.durationSeconds / 60)}m ${r.durationSeconds % 60}s` },
    { head: "Run", className: "mono nowrap", render: (r) => stamp(r.at) },
  ];

  if (!testRuns.length) {
    return make("div", "stack", [
      panel("Test runs", {
        body: make("div", "empty", [
          icon("inbox", 26),
          make("p", "n", "No recordings for this project"),
          make("p", "dim", "Suites are recorded per service; switch the project filter or open a service that has a journey."),
        ]),
      }),
    ]);
  }

  return make("div", "stack", [
    make("div", "metrics", [
      metric("Suites", testRuns.length, "recorded against SIT and UAT"),
      metric("Cases", cases, `${passed} passed`),
      metric("Pass rate", `${rate}%`, "across the recorded runs", rate === "100.0" ? "ok" : "warn"),
      metric("Environments", new Set(testRuns.map((r) => r.env)).size, "covered by automation"),
    ]),
    panel("Recorded runs", {
      sub: "device and API suites, newest first",
      flush: true,
      body: table(columns, testRuns.slice().sort((a, b) => (a.at < b.at ? 1 : -1))),
      note: "A failing suite is recorded, not deleted: the pass rate above counts the run that failed, which is the only version of this number that means anything.",
    }),
  ]);
}

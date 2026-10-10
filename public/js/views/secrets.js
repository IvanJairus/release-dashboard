import { api, scoped } from "../api.js";
import { make, panel, badge, table, metric, callout, stamp, duration } from "../ui.js";

export const meta = { title: "Secrets", subtitle: "Vault paths, rotation age and who last touched them. Never values." };

export async function render(ctx) {
  let secrets;
  try {
    ({ secrets } = await api.get(scoped("/api/secrets", ctx.project)));
  } catch (err) {
    if (err.status !== 403) throw err;
    return make("div", "stack", [
      callout("bad", "shield", make("span", null, [
        make("b", null, `403: this view needs secret:read. `),
        `Your role (${ctx.me.role}) is not in that list, and the server said so rather than returning an empty table. Reading credential paths is a different decision from reading a version number, so it is a different permission name.`,
      ])),
      panel("What your role can read", {
        body: make("p", "dim", "Deployments, versions, scans, test runs and the board. Everything on this page is derived from the same records, so a developer is not blind. They simply cannot enumerate what a vault holds."),
      }),
    ]);
  }

  const overdue = secrets.filter((s) => s.overdue).length;
  const due = secrets.filter((s) => s.dueSoon).length;
  const oldest = secrets.reduce((m, s) => Math.max(m, s.ageDays), 0);

  const columns = [
    { head: "Path", className: "mono name", render: (s) => s.path },
    { head: "Type", render: (s) => badge(s.type, "mono") },
    { head: "Environment", render: (s) => badge(s.env, s.env === "prod" ? "bad" : s.env === "uat" ? "warn" : "info") },
    { head: "Version", className: "num", render: (s) => s.version },
    { head: "Updated", className: "mono nowrap", render: (s) => stamp(s.updatedAt) },
    { head: "By", className: "mono", render: (s) => s.updatedBy },
    { head: "Age", className: "num", render: (s) => `${s.ageDays}d` },
    { head: "Rotate every", className: "num", render: (s) => `${s.rotationDays}d` },
    { head: "Status", render: (s) => (s.overdue
      ? badge(`overdue ${-s.remainingDays}d`, "bad")
      : s.dueSoon ? badge(`due in ${s.remainingDays}d`, "warn") : badge("in policy", "ok")) },
  ];

  return make("div", "stack", [
    make("div", "metrics", [
      metric("Paths", secrets.length, "metadata only, values stay in vault"),
      metric("Overdue", overdue, "past their rotation window", overdue ? "warn" : "ok"),
      metric("Due within 30 days", due, "plan the rotation now", due ? "warn" : ""),
      metric("Oldest", `${oldest}d`, "days since anything was written"),
    ]),
    callout("warn", "key", make("span", null, [
      "There is no endpoint in this application that returns a secret value. ",
      make("b", null, "The board is not the store"),
      ", so a compromised dashboard cannot leak a credential it never held.",
    ])),
    panel("Secret ledger", {
      sub: "sorted by how close each path is to its rotation deadline",
      flush: true,
      body: table(columns, secrets),
      note: "Rotation age is derived from the recorded timestamp, never from a flag someone might have forgotten to clear.",
    }),
  ]);
}

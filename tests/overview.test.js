"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { versionRows, stats, frequency, releasePlan, rotationStatus, isoWeek } = require("../src/services/OverviewService.js");

const svc = (id, project, sit, uat, prod) => ({
  id, name: `${id}-service`, project, artifact: "jar",
  envs: {
    sit: { version: sit, deployedAt: "2026-10-01T10:00:00.000Z" },
    uat: uat ? { version: uat, deployedAt: "2026-09-20T10:00:00.000Z" } : null,
    prod: prod ? { version: prod, deployedAt: "2026-09-10T10:00:00.000Z" } : null,
  },
});

const SERVICES = [svc("ledger", "payments", "2.4.1", "2.4.0", "2.4.0"), svc("portal", "digital", "3.11.0", null, null),
  svc("settlement", "payments", "2.3.9", "2.3.9", "2.3.8")];

const deploy = (at, result = "success", durationSeconds = 90, env = "sit") =>
  ({ at, result, durationSeconds, env, service: "ledger", version: "v2.4.1" });

test("a service with no UAT row is new, not drifted", () => {
  const rows = versionRows(SERVICES);
  assert.deepEqual(rows.map((r) => r.state), ["diff", "new", "same"]);
  assert.equal(rows[1].uat, null);
});

test("success rate counts deploys, not services", () => {
  const s = stats([deploy("2026-10-08T00:00:00.000Z"), deploy("2026-10-08T00:00:00.000Z"),
    deploy("2026-10-08T00:00:00.000Z", "failed")], SERVICES);
  assert.equal(s.deploys, 3);
  assert.equal(s.successRate, 66.7);
  assert.equal(s.medianSeconds, 90);
  assert.equal(s.drifted, 2);
  assert.equal(s.neverPromoted, 1);
  assert.equal(s.projects, 2);
});

test("an empty store yields null rather than a division by zero", () => {
  assert.equal(stats([], []).successRate, null);
  assert.equal(frequency([]).every((b) => b.total === 0), true);
});

test("frequency buckets are contiguous, so a quiet week reads as zero and not as missing", () => {
  const buckets = frequency([deploy("2026-10-08T00:00:00.000Z"), deploy("2026-10-08T00:00:00.000Z", "failed")], 4);
  assert.equal(buckets.length, 4);
  assert.equal(buckets.at(-1).total, 2);
  assert.equal(buckets.at(-1).failed, 1);
  assert.equal(buckets.slice(0, -1).reduce((n, b) => n + b.total, 0), 0);
  assert.match(buckets.at(-1).week, /^\d{4}-W\d{2}$/);
});

test("iso week rolls over the year boundary the same way the calendar does", () => {
  assert.deepEqual(isoWeek(Date.UTC(2026, 0, 1)), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek(Date.UTC(2027, 0, 1)), { year: 2026, week: 53 });
});

const SCANS = [{ service: "ledger", sonar: { qualityGate: "passed" }, trivy: { critical: 0 } },
  { service: "portal", sonar: { qualityGate: "failed" }, trivy: { critical: 2 } }];

test("a plan row lists every reason it is blocked, not just the first", () => {
  const tickets = [{ id: "455", service: "ledger", phase: "merged", releaseTag: "v2.4.1" }];
  const plan = releasePlan(SERVICES, tickets, SCANS);
  assert.deepEqual(plan.map((p) => p.service), ["portal", "ledger"], "blocked rows sort first, and an in-step service is not on the list at all");
  const portal = plan.find((p) => p.service === "portal");
  assert.equal(portal.gate, "blocked");
  assert.deepEqual(portal.blockers, ["sonar quality gate failed", "2 critical image finding(s)", "no ticket to trace this change to"]);
  assert.equal(plan.find((p) => p.service === "ledger").gate, "ready");
});

test("a merged ticket is not enough: the phase has to be one the ladder accepts", () => {
  const plan = releasePlan(SERVICES, [{ id: "1", service: "ledger", phase: "in-review", releaseTag: null }], SCANS);
  assert.deepEqual(plan.find((p) => p.service === "ledger").blockers, ["ticket #1 is in-review"]);
});

test("rotation is derived from the recorded timestamp", () => {
  const now = Date.parse("2026-10-09T00:00:00.000Z");
  const aged = [{ name: "a", rotationDays: 90, updatedAt: new Date(now - 100 * 86400000).toISOString() },
    { name: "b", rotationDays: 90, updatedAt: new Date(now - 65 * 86400000).toISOString() },
    { name: "c", rotationDays: 90, updatedAt: new Date(now - 10 * 86400000).toISOString() }];
  const rows = rotationStatus(aged, now);
  assert.deepEqual(rows.map((r) => r.name), ["a", "b", "c"], "the most overdue surfaces first");
  assert.equal(rows[0].overdue, true);
  assert.equal(rows[1].dueSoon, true);
  assert.equal(rows[2].overdue || rows[2].dueSoon, false);
});

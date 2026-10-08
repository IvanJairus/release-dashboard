"use strict";

/*
  Everything the console shows is derived here rather than stored, because a
  number that is written down can disagree with the record it claims to
  summarise. The fixtures stay the single source of truth; these functions are
  pure, so "97% success rate" is a calculation a test can reproduce.
*/

const DAY = 86400000;

const stateOf = (svc) => {
  if (!svc.envs.uat) return "new";
  return svc.envs.uat.version === svc.envs.sit.version ? "same" : "diff";
};

function versionRows(services) {
  return services.map((svc) => ({
    id: svc.id,
    name: svc.name,
    project: svc.project,
    artifact: svc.artifact,
    sit: svc.envs.sit.version,
    uat: svc.envs.uat ? svc.envs.uat.version : null,
    prod: svc.envs.prod ? svc.envs.prod.version : null,
    state: stateOf(svc),
    deployedAt: svc.envs.sit.deployedAt,
  }));
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (pos - low));
}

function stats(deployments, services) {
  const durations = deployments.filter((d) => d.result === "success").map((d) => d.durationSeconds).sort((a, b) => a - b);
  const ok = durations.length;
  const rows = versionRows(services);
  const latest = deployments.reduce((m, d) => (d.at > m ? d.at : m), "");
  const since = Date.parse(latest) - 30 * DAY;
  const window = deployments.filter((d) => Date.parse(d.at) >= since);
  return {
    services: services.length,
    projects: new Set(services.map((s) => s.project)).size,
    deploys: deployments.length,
    deploysWindow: window.length,
    failedWindow: window.filter((d) => d.result === "failed").length,
    successRate: deployments.length ? Number(((ok / deployments.length) * 100).toFixed(1)) : null,
    medianSeconds: quantile(durations, 0.5),
    p90Seconds: quantile(durations, 0.9),
    drifted: rows.filter((r) => r.state !== "same").length,
    neverPromoted: rows.filter((r) => r.state === "new").length,
  };
}

const isoWeek = (ms) => {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const first = Date.UTC(thursday.getUTCFullYear(), 0, 4);
  const week = 1 + Math.round((thursday - first) / (7 * DAY));
  return { year: thursday.getUTCFullYear(), week };
};

function frequency(deployments, weeks = 12) {
  const buckets = new Map();
  const latest = deployments.reduce((m, d) => Math.max(m, Date.parse(d.at)), 0);
  for (let i = weeks - 1; i >= 0; i--) {
    const { year, week } = isoWeek(latest - i * 7 * DAY);
    const key = `${year}-W${String(week).padStart(2, "0")}`;
    buckets.set(key, { week: key, total: 0, failed: 0, byEnv: { sit: 0, uat: 0, prod: 0 } });
  }
  for (const d of deployments) {
    const { year, week } = isoWeek(Date.parse(d.at));
    const key = `${year}-W${String(week).padStart(2, "0")}`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.total += 1;
    bucket.byEnv[d.env] += 1;
    if (d.result === "failed") bucket.failed += 1;
  }
  return [...buckets.values()];
}

/*
  A release plan is generated from version drift and nothing else. That is the
  property that makes it trustworthy: a service that did not change cannot ride
  along into UAT because someone had the tab open.
*/
function releasePlan(services, tickets, scans) {
  const byService = new Map(scans.map((s) => [s.service, s]));
  const open = new Map(tickets.map((t) => [t.service, t]));
  return versionRows(services)
    .filter((r) => r.state !== "same")
    .map((r) => {
      const scan = byService.get(r.id);
      const ticket = open.get(r.id);
      const blockers = [];
      if (scan && scan.sonar.qualityGate === "failed") blockers.push("sonar quality gate failed");
      if (scan && scan.trivy.critical > 0) blockers.push(`${scan.trivy.critical} critical image finding(s)`);
      if (!ticket) blockers.push("no ticket to trace this change to");
      else if (ticket.phase !== "merged" && ticket.phase !== "deployed") blockers.push(`ticket #${ticket.id} is ${ticket.phase}`);
      return {
        service: r.id,
        name: r.name,
        project: r.project,
        from: r.uat,
        to: r.sit,
        state: r.state,
        ticket: ticket ? { id: ticket.id, phase: ticket.phase, releaseTag: ticket.releaseTag } : null,
        gate: blockers.length ? "blocked" : "ready",
        blockers,
      };
    })
    .sort((a, b) => (a.gate === b.gate ? a.name.localeCompare(b.name) : a.gate === "blocked" ? -1 : 1));
}

// Rotation is only useful if the board says which credential is about to go
// stale, so the answer is derived from the recorded timestamp, not a flag.
function rotationStatus(secrets, now = Date.now()) {
  return secrets.map((s) => {
    const age = Math.floor((now - Date.parse(s.updatedAt)) / DAY);
    const remaining = s.rotationDays - age;
    return { ...s, ageDays: age, remainingDays: remaining, overdue: remaining < 0, dueSoon: remaining >= 0 && remaining <= 30 };
  }).sort((a, b) => a.remainingDays - b.remainingDays);
}

class OverviewService {
  constructor({ repo, clock }) {
    this.repo = repo;
    this.clock = clock || (() => Date.now());
  }

  async collections(project) {
    const [projects, services, deployments, tickets, scans, testRuns, secrets] = await Promise.all([
      this.repo.read("projects", { projects: [] }),
      this.repo.read("services", { services: [] }),
      this.repo.read("deployments", { deployments: [] }),
      this.repo.read("tickets", { tickets: [] }),
      this.repo.read("scans", { scans: [] }),
      this.repo.read("test-runs", { testRuns: [] }),
      this.repo.read("secrets", { secrets: [] }),
    ]);
    if (!project || project === "all") {
      return { projects: projects.projects, services: services.services, deployments: deployments.deployments,
        tickets: tickets.tickets, scans: scans.scans, testRuns: testRuns.testRuns, secrets: secrets.secrets };
    }
    const inProject = (x) => x.project === project;
    const ids = new Set(services.services.filter(inProject).map((s) => s.id));
    return {
      projects: projects.projects.filter(inProject),
      services: services.services.filter(inProject),
      deployments: deployments.deployments.filter((d) => ids.has(d.service)),
      tickets: tickets.tickets.filter((t) => ids.has(t.service)),
      scans: scans.scans.filter(inProject),
      testRuns: testRuns.testRuns.filter((t) => ids.has(t.service)),
      secrets: secrets.secrets.filter(inProject),
    };
  }

  async dashboard(project) {
    const c = await this.collections(project);
    return {
      stats: stats(c.deployments, c.services),
      versions: versionRows(c.services),
      frequency: frequency(c.deployments),
      gates: c.scans.map((s) => ({
        service: s.service,
        sonar: s.sonar.qualityGate,
        trivyCritical: s.trivy.critical,
        coverage: s.sonar.coverage,
      })),
    };
  }

  async plan(project) {
    const c = await this.collections(project);
    return releasePlan(c.services, c.tickets, c.scans);
  }

  async secretLedger(project) {
    const c = await this.collections(project);
    return rotationStatus(c.secrets, this.clock());
  }
}

module.exports = { OverviewService, versionRows, stats, frequency, releasePlan, rotationStatus, stateOf, isoWeek };

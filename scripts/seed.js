"use strict";

/*
  Every value below is invented. The names, ids, dates and counts exist to show
  the shapes the real system moves; none of them came from a production board.
  Generation is seeded rather than random so a reseed is a no-op and a test can
  assert on the fixtures - see README, "What is deliberately absent".
*/
const fs = require("node:fs");
const path = require("node:path");
const { buildRecord, ApiKeyStore } = require("../src/auth/JsonAuthProvider.js");

const DATA = path.join(__dirname, "..", "data");
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "change-me-demo";
const DEMO_KEY = process.env.DEMO_API_KEY || "demo-key-change-me";

// Midnight, so every generated row is in the past no matter when the seed runs:
// a fixture dated tomorrow renders as "overdue -1 days" and looks broken.
const DAY = 86400000;
const ANCHOR = Date.now() - (Date.now() % DAY);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261009);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const at = (ms) => new Date(ANCHOR - Math.round(ms)).toISOString();

const ROLES = [
  { email: "dev@example.com", role: "dev" },
  { email: "qa@example.com", role: "approver" },
  { email: "ops@example.com", role: "ops" },
  { email: "admin@example.com", role: "admin" },
];

const PROJECTS = [
  { id: "payments", displayName: "Payments Core" },
  { id: "retail", displayName: "Retail Channels" },
  { id: "digital", displayName: "Digital Experience" },
  { id: "distribution", displayName: "Field Distribution" },
];

// name, project, stack, artifact, SIT, UAT, PROD - a null UAT means the service
// has never been promoted, which is a different fact from "same version".
const CATALOG = [
  ["ledger", "payments", "maven", "jar", "2.4.1", "2.4.0", "2.4.0"],
  ["reconciliation", "payments", "maven", "jar", "2.4.1", null, null],
  ["settlement", "payments", "maven", "jar", "2.3.9", "2.3.9", "2.3.8"],
  ["statements", "retail", "gradle", "jar", "1.9.4", "1.9.2", "1.9.2"],
  ["limit-engine", "retail", "gradle", "jar", "1.9.4", "1.9.4", "1.9.4"],
  ["fee-calculator", "retail", "maven", "jar", "0.14.2", "0.14.1", "0.14.1"],
  ["portal", "digital", "npm", "web", "3.11.0", "3.10.4", "3.10.4"],
  ["auth", "digital", "npm", "web", "3.11.0", null, null],
  ["notification", "digital", "gradle", "jar", "1.2.105", "1.2.105", "1.2.103"],
  ["content", "digital", "npm", "web", "1.2.94", "1.2.90", "1.2.90"],
  ["field-app-android", "distribution", "gradle", "apk", "5.7.2", "5.7.1", "5.7.1"],
  ["field-app-ios", "distribution", "xcode", "ipa", "5.7.2", "5.7.2", null],
  ["device-enrolment", "distribution", "maven", "jar", "0.9.8", "0.9.8", "0.9.8"],
  ["route-planner", "distribution", "python", "wheel", "0.4.1", "0.3.9", "0.3.9"],
];

const SERVICES = CATALOG.map(([id, project, stack, artifact, sit, uat, prod], i) => ({
  id,
  name: `${id}-service`,
  project,
  stack,
  artifact,
  repo: `${project}/${id}`,
  owners: [project],
  envs: {
    sit: { version: sit, deployedAt: at((i % 9) * DAY + 5 * 3600000) },
    uat: uat ? { version: uat, deployedAt: at((i % 9) * DAY + 4 * DAY) } : null,
    prod: prod ? { version: prod, deployedAt: at((i % 9) * DAY + 9 * DAY) } : null,
  },
}));

const created = (iso) => [{ action: "created", actor: "dev@example.com", at: iso }];

const TICKETS = [
  { id: "471", title: "feat: nightly ledger reconciliation", service: "ledger", phase: "intake",
    branch: null, mergeRequest: null, releaseTag: null, approvals: {}, revision: 1, watermarks: [],
    history: created(at(30 * DAY)) },
  { id: "468", title: "fix: timeout on statement export", service: "statements", phase: "in-review",
    branch: "fix/468-statement-timeout", mergeRequest: "mr/118", releaseTag: null,
    approvals: { team: "dev@example.com", business: "qa@example.com", product: "qa@example.com",
      architecture: "qa@example.com", _last: "qa@example.com" },
    revision: 6, watermarks: ["openMergeRequest@2"], history: created(at(26 * DAY)) },
  { id: "455", title: "chore: portal bundle budget", service: "portal", phase: "merged",
    branch: "chore/455-budget", mergeRequest: "mr/101", releaseTag: "v3.11.0",
    approvals: { team: "dev@example.com", business: "qa@example.com", product: "qa@example.com",
      architecture: "qa@example.com", engineering: "ops@example.com", _last: "ops@example.com" },
    revision: 9, watermarks: ["merge@9"], history: created(at(34 * DAY)) },
];

/*
  Deploy durations sit in the range the real jobs measure: a VM deploy runs
  19-199 s with a median near 90 s. The shape is borrowed, the rows are not.
*/
function buildDeployments() {
  const out = [];
  const actors = { sit: ["dev@example.com", "ops@example.com"], uat: ["ops@example.com"], prod: ["ops@example.com"] };
  for (let day = 0; day < 84; day++) {
    const perDay = day < 70 ? int(1, 3) : int(0, 2);
    for (let n = 0; n < perDay; n++) {
      const svc = pick(SERVICES);
      const env = pick(["sit", "sit", "sit", "uat", "prod"]);
      const failed = rnd() < 0.035;
      const version = env === "sit" ? svc.envs.sit.version
        : env === "uat" ? (svc.envs.uat || svc.envs.sit).version
        : (svc.envs.prod || svc.envs.uat || svc.envs.sit).version;
      out.push({
        id: `d-${String(out.length + 1).padStart(4, "0")}`,
        at: at(day * DAY + n * 3 * 3600000 + int(0, 2) * 60000),
        env,
        service: svc.id,
        version: `v${version}`,
        actor: pick(actors[env]),
        result: failed ? "failed" : "success",
        durationSeconds: failed ? int(19, 60) : int(24, 190),
        pipeline: `${svc.project}/${svc.id} #${int(400, 980)}`,
        ticket: rnd() < 0.6 ? String(int(400, 471)) : null,
        reason: failed ? pick(["health check timed out", "artifact not found in repository", "ansible rollback triggered"]) : null,
      });
    }
  }
  return out;
}

const SCANS = SERVICES.map((svc, i) => ({
  service: svc.id,
  project: svc.project,
  sonar: {
    qualityGate: i % 7 === 3 ? "failed" : i % 5 === 2 ? "warn" : "passed",
    blockers: i % 7 === 3 ? 2 : 0,
    criticals: i % 5 === 2 ? 1 : 0,
    coverage: Number((58 + ((i * 7) % 34) + rnd() * 3).toFixed(1)),
    duplicated: Number((1 + ((i * 3) % 6) + rnd()).toFixed(1)),
    bugs: (i * 5) % 9,
    scannedAt: at((i % 5) * 3600000),
  },
  trivy: {
    critical: i % 6 === 4 ? 3 : 0,
    high: (i * 3) % 11,
    medium: (i * 7) % 24,
    image: `${svc.project}/${svc.id}:v${svc.envs.sit.version}`,
    scannedAt: at((i % 5) * 3600000 + 900000),
  },
}));

const TEST_RUNS = SERVICES.slice(0, 9).map((svc, i) => ({
  id: `run-${1200 + i}`,
  service: svc.id,
  suite: svc.artifact === "web" ? "portal-journey" : svc.artifact === "apk" || svc.artifact === "ipa" ? "mobile-smoke" : "api-regression",
  env: i % 4 === 0 ? "uat" : "sit",
  total: 18 + (i * 5) % 30,
  passed: 18 + (i * 5) % 30 - (i % 6 === 2 ? 3 : 0),
  durationSeconds: 90 + i * 23,
  at: at(i * 7 * 3600000),
  device: svc.artifact === "apk" || svc.artifact === "ipa" ? `emulator-api-${30 + (i % 4)}` : null,
}));

/*
  Secret metadata only. A value never reaches this file, the API or the browser;
  the board exists to answer "what expires, who changed it, when was it last
  rotated" without ever being the thing that holds the credential.
*/
// service, secret name, type, env
const SECRET_CATALOG = [
  ["ledger", "ledger-db", "database", "sit"], ["ledger", "ledger-db", "database", "uat"], ["ledger", "ledger-db", "database", "prod"],
  ["portal", "portal-oauth", "oauth", "sit"], ["portal", "portal-oauth", "oauth", "prod"],
  ["notification", "notification-smtp", "smtp", "sit"], ["notification", "notification-smtp", "smtp", "uat"],
  ["field-app-android", "android-keystore", "keystore", "prod"], ["field-app-ios", "ios-provisioning", "keystore", "sit"],
  ["statements", "statements-jdbc", "database", "sit"], ["statements", "statements-jdbc", "database", "prod"],
  ["settlement", "settlement-sftp", "sftp", "uat"], ["settlement", "settlement-sftp", "sftp", "prod"],
  ["auth", "auth-signing-key", "signing", "sit"], ["auth", "auth-signing-key", "signing", "prod"],
  ["content", "content-cdn-key", "api", "sit"], ["route-planner", "map-provider-key", "api", "sit"],
  ["limit-engine", "limit-engine-cache", "cache", "uat"],
];

const byId = new Map(SERVICES.map((s) => [s.id, s]));
const SECRETS = SECRET_CATALOG.map(([service, name, type, env], i) => {
  const svc = byId.get(service);
  return {
    mount: "kv",
    path: `${env}/${svc.project}/${name}`,
    name,
    service,
    project: svc.project,
    type,
    env,
    version: 1 + (i % 6),
    updatedAt: at((i * 11) * DAY),
    updatedBy: pick(["ops@example.com", "admin@example.com"]),
    rotationDays: type === "database" ? 90 : type === "signing" ? 180 : 365,
  };
});

/*
  The ladder is durable, so the reference ships with a history: every tag that
  is already in an upper environment has a row below it, signed by someone other
  than the person who ran the previous rung. Remove these rows and the console
  still refuses to promote - the guard reads the ledger, not the fixture count.
*/
function buildPromotions() {
  const LADDER = ["sit", "uat", "prod"];
  const hands = ["ops@example.com", "admin@example.com"];
  const out = [];
  for (const [i, svc] of SERVICES.entries()) {
    const highest = new Map();
    const bump = (version, env, when) => {
      const seen = highest.get(version);
      if (!seen || LADDER.indexOf(env) > LADDER.indexOf(seen.env)) highest.set(version, { env, when });
    };
    bump(svc.envs.sit.version, "sit", svc.envs.sit.deployedAt);
    if (svc.envs.uat) bump(svc.envs.uat.version, "uat", svc.envs.uat.deployedAt);
    if (svc.envs.prod) bump(svc.envs.prod.version, "prod", svc.envs.prod.deployedAt);
    for (const [version, reached] of highest) {
      const top = LADDER.indexOf(reached.env);
      for (let level = 0; level <= top; level++) {
        out.push({
          releaseTag: `v${version}`,
          env: LADDER[level],
          actor: hands[(i + level) % 2],
          at: new Date(Date.parse(reached.when) - (top - level) * 2 * DAY).toISOString(),
          result: "success",
        });
      }
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

fs.mkdirSync(DATA, { recursive: true });
const save = (name, value) =>
  fs.writeFileSync(path.join(DATA, `${name}.json`), JSON.stringify(value, null, 2) + "\n");

save("users", { users: ROLES.map((u) => buildRecord(u.email, u.role, DEMO_PASSWORD)) });
save("projects", { projects: PROJECTS.map((p) => ({
  ...p,
  createdAt: at(int(120, 400) * DAY),
  repos: int(0, 9),
  pipelines: int(1, 3),
})) });
save("services", { services: SERVICES });
save("tickets", { tickets: TICKETS });
const deployments = buildDeployments();
save("deployments", { deployments });
save("scans", { scans: SCANS });
save("test-runs", { testRuns: TEST_RUNS });
save("secrets", { secrets: SECRETS });
save("promotions", { ledger: buildPromotions() });

fs.writeFileSync(path.join(DATA, "runtime.env.example"), [
  "# values come from the secret manager at runtime; nothing here is a real credential",
  "SESSION_SECRET=<openssl rand -hex 32>",
  "USERS_FILE=./data/users.json",
  "# digest of the caller's key, never the key itself: node -e \"...ApiKeyStore.digest(process.env.KEY)\"",
  "API_KEY_DIGESTS=<64 hex characters>",
  "DATA_DIR=./data",
  "",
].join("\n"));

console.log(`seeded ${PROJECTS.length} projects, ${SERVICES.length} services, ${deployments.length} deployments,`);
console.log(`${TICKETS.length} tickets, ${SCANS.length} scans, ${TEST_RUNS.length} test runs, ${SECRETS.length} secret paths, ${ROLES.length} users`);
console.log(`demo key: ${DEMO_KEY}`);
console.log(`its digest, for API_KEY_DIGESTS: ${ApiKeyStore.digest(DEMO_KEY)}`);

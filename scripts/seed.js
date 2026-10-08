"use strict";

/*
  Every value below is invented. The names, ids, dates and counts exist to show
  the shapes the real system moves; none of them came from a production board.
  See README, "What is deliberately absent".
*/
const fs = require("node:fs");
const path = require("node:path");
const { buildRecord, ApiKeyStore } = require("../src/auth/JsonAuthProvider.js");

const DATA = path.join(__dirname, "..", "data");
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "change-me-demo";
const DEMO_KEY = process.env.DEMO_API_KEY || "demo-key-change-me";

const ROLES = [
  { email: "dev@example.com", role: "dev" },
  { email: "qa@example.com", role: "approver" },
  { email: "ops@example.com", role: "ops" },
  { email: "admin@example.com", role: "admin" },
];

const SERVICES = [
  { id: "ledger", name: "ledger-service", stack: "maven", artifact: "jar", owners: ["payments"] },
  { id: "statements", name: "statements-api", stack: "gradle", artifact: "jar", owners: ["retail"] },
  { id: "portal", name: "customer-portal", stack: "npm", artifact: "web", owners: ["digital"] },
  { id: "field-app", name: "field-app-android", stack: "gradle", artifact: "apk", owners: ["distribution"] },
  { id: "field-app-ios", name: "field-app-ios", stack: "xcode", artifact: "ipa", owners: ["distribution"] },
];

const created = (at) => [{ action: "created", actor: "dev@example.com", at }];

const TICKETS = [
  { id: "471", title: "feat: nightly ledger reconciliation", service: "ledger", phase: "intake",
    branch: null, mergeRequest: null, releaseTag: null, approvals: {}, revision: 1, watermarks: [],
    history: created("2026-03-02T09:10:00.000Z") },
  { id: "468", title: "fix: timeout on statement export", service: "statements", phase: "in-review",
    branch: "fix/468-statement-timeout", mergeRequest: "mr/118", releaseTag: null,
    approvals: { team: "dev@example.com", business: "qa@example.com", product: "qa@example.com",
      architecture: "qa@example.com", _last: "qa@example.com" },
    revision: 6, watermarks: ["openMergeRequest@2"], history: created("2026-03-04T02:15:00.000Z") },
  { id: "455", title: "chore: portal bundle budget", service: "portal", phase: "merged",
    branch: "chore/455-budget", mergeRequest: "mr/101", releaseTag: "v2.4.1",
    approvals: { team: "dev@example.com", business: "qa@example.com", product: "qa@example.com",
      architecture: "qa@example.com", engineering: "ops@example.com", _last: "ops@example.com" },
    revision: 9, watermarks: ["merge@9"], history: created("2026-02-27T08:00:00.000Z") },
];

fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, "users.json"),
  JSON.stringify({ users: ROLES.map((u) => buildRecord(u.email, u.role, DEMO_PASSWORD)) }, null, 2) + "\n");
fs.writeFileSync(path.join(DATA, "services.json"), JSON.stringify({ services: SERVICES }, null, 2) + "\n");
fs.writeFileSync(path.join(DATA, "tickets.json"), JSON.stringify({ tickets: TICKETS }, null, 2) + "\n");
fs.writeFileSync(path.join(DATA, "runtime.env.example"), [
  "# values come from the secret manager at runtime; nothing here is a real credential",
  "SESSION_SECRET=<openssl rand -hex 32>",
  "USERS_FILE=./data/users.json",
  "# digest of the caller's key, never the key itself: node -e \"...ApiKeyStore.digest(process.env.KEY)\"",
  "API_KEY_DIGESTS=<64 hex characters>",
  "DATA_DIR=./data",
  "",
].join("\n"));

console.log(`seeded ${SERVICES.length} services, ${TICKETS.length} tickets, ${ROLES.length} users`);
console.log(`demo key: ${DEMO_KEY}`);
console.log(`its digest, for API_KEY_DIGESTS: ${ApiKeyStore.digest(DEMO_KEY)}`);

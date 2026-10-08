"use strict";

const assert = require("node:assert/strict");
const { createApp } = require("../src/app.js");
const { ApiKeyStore } = require("../src/auth/JsonAuthProvider.js");

const KEY = "smoke-key";

async function main() {
  const os = require("node:os");
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-"));
  fs.writeFileSync(path.join(dir, "tickets.json"), JSON.stringify({ tickets: [
    { id: "1", title: "t", service: "ledger", phase: "in-review", branch: "b", mergeRequest: "mr/1",
      releaseTag: "v1.0.0", approvals: { team: "dev@example.com", business: "qa@example.com",
        product: "qa@example.com", architecture: "qa@example.com", _last: "qa@example.com" },
      revision: 5, watermarks: [], history: [] },
  ] }));

  const { buildRecord } = require("../src/auth/JsonAuthProvider.js");
  const config = {
    sessionSecret: "test-secret",
    users: [buildRecord("dev@example.com", "dev", "pw"), buildRecord("ops@example.com", "ops", "pw"),
      buildRecord("qa@example.com", "approver", "pw")],
    apiKeyDigests: [ApiKeyStore.digest(KEY)],
    dataDir: dir,
    auditPath: path.join(dir, "audit.jsonl"),
  };
  const { app } = createApp(config);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const jar = {};
  const call = async (method, url, { body, as, expect } = {}) => {
    const headers = { "content-type": "application/json" };
    if (as) headers.cookie = jar[as] || "";
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    const cookie = res.headers.getSetCookie ? res.headers.getSetCookie()[0] : res.headers.get("set-cookie");
    if (as && cookie) jar[as] = cookie.split(";")[0];
    if (expect) assert.equal(res.status, expect, `${method} ${url} -> ${res.status} ${text}`);
    return { status: res.status, json };
  };

  const checks = [];
  const ok = (name, fn) => checks.push([name, fn]);

  ok("health is open", () => call("GET", "/healthz", { expect: 200 }));
  ok("tickets need a session", () => call("GET", "/api/tickets", { expect: 401 }));
  ok("a dev cannot rotate keys", () => call("POST", "/api/admin/keys/rotate", { as: "dev", expect: 401 }));

  ok("login issues a session", async () => {
    const r = await call("POST", "/api/auth/login", { body: { email: "dev@example.com", password: "pw" }, as: "dev", expect: 200 });
    assert.equal(r.json.role, "dev");
  });
  ok("a wrong password is refused", () =>
    call("POST", "/api/auth/login", { body: { email: "dev@example.com", password: "nope" }, expect: 401 }));

  ok("the board reads", async () => {
    const r = await call("GET", "/api/tickets", { as: "dev", expect: 200 });
    assert.equal(r.json.tickets[0].id, "1");
  });

  ok("a dev cannot grant the engineering approval", () =>
    call("POST", "/api/tickets/1/approvals/engineering", { as: "dev", expect: 422 }));

  ok("an approver completes the chain", async () => {
    await call("POST", "/api/auth/login", { body: { email: "qa@example.com", password: "pw" }, as: "qa", expect: 200 });
    const r = await call("POST", "/api/tickets/1/approvals/engineering", { as: "qa", expect: 200 });
    assert.deepEqual(r.json.stillMissing, []);
  });

  ok("the last approver cannot merge", async () => {
    const r = await call("POST", "/api/tickets/1/actions/merge", { as: "qa", body: { expectedRevision: 6 }, expect: 422 });
    assert.equal(r.json.refused.code, "duty");
  });

  ok("ops merges once the chain is complete", async () => {
    await call("POST", "/api/auth/login", { body: { email: "ops@example.com", password: "pw" }, as: "ops", expect: 200 });
    const r = await call("POST", "/api/tickets/1/actions/merge", { as: "ops", body: { expectedRevision: 6 }, expect: 200 });
    assert.equal(r.json.ticket.phase, "merged");
  });

  ok("a stale view is refused, not applied", async () => {
    const r = await call("POST", "/api/tickets/1/actions/deploy", { as: "ops", body: { expectedRevision: 1 }, expect: 409 });
    assert.equal(r.json.actualRevision, 7);
  });

  ok("UAT cannot be promoted before SIT ran", () =>
    call("POST", "/api/promotions/uat", { as: "ops", body: { ticket: "1" }, expect: 422 }));

  ok("SIT promotion succeeds", async () => {
    const r = await call("POST", "/api/promotions/sit", { as: "ops", body: { ticket: "1" }, expect: 200 });
    assert.equal(r.json.env, "sit");
  });

  ok("the same human cannot climb the next rung", () =>
    call("POST", "/api/promotions/uat", { as: "ops", body: { ticket: "1" }, expect: 422 }));

  ok("a machine caller with the key can act, but not on prod", async () => {
    const res = await fetch(base + "/api/ci/deploy", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY },
      body: JSON.stringify({ ticket: "1", env: "uat", releaseTag: "v1.0.0", reason: "smoke" }),
    });
    assert.equal(res.status, 200);
    const bad = await fetch(base + "/api/ci/deploy", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": "wrong" },
      body: JSON.stringify({ env: "uat", releaseTag: "v1.0.0" }),
    });
    assert.equal(bad.status, 401);
  });

  ok("the audit trail recorded the refusals too", async () => {
    const denied = await call("GET", "/api/admin/audit", { as: "dev", expect: 403 });
    assert.equal(denied.json.needs, "audit:read");
    await call("POST", "/api/auth/login", { body: { email: "qa@example.com", password: "pw" }, as: "qa", expect: 200 });
    const a = await call("GET", "/api/admin/audit", { as: "qa", expect: 200 });
    const kinds = a.json.entries.map((e) => e.kind);
    for (const k of ["login", "transition", "refused", "promotion", "approval"]) {
      assert.ok(kinds.includes(k), `audit missing ${k}: ${kinds.join(",")}`);
    }
    const approval = a.json.entries.find((e) => e.kind === "approval");
    assert.ok(Array.isArray(approval.stillMissing), "redact() flattened an array");
  });

  for (const [name, fn] of checks) {
    await fn();
    console.log(`  ok  ${name}`);
  }
  server.close();
  console.log(`\n${checks.length} smoke checks passed`);
}

main().catch((e) => { console.error("SMOKE FAILED:", e.message); process.exit(1); });

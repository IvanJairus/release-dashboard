"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { allows, ROLES, missingApprovalsFor } = require("../src/middleware/rbac.js");
const { buildRecord, verify, JsonAuthProvider, ApiKeyStore } = require("../src/auth/JsonAuthProvider.js");
const { PromotionService, LADDER } = require("../src/services/PromotionService.js");
const { RateLimiter } = require("../src/middleware/rateLimiter.js");
const { sign, unsign } = require("../src/middleware/auth.js");
const { redact } = require("../src/services/AuditService.js");

test("no role holds every approval layer", () => {
  for (const role of ROLES) {
    assert.ok(missingApprovalsFor(role).length > 0, `${role} can approve all five layers`);
  }
});

test("only ops deploys, only an admin rotates keys", () => {
  assert.equal(allows("dev", "deploy:prod"), false);
  assert.equal(allows("ops", "deploy:prod"), true);
  assert.equal(allows("ops", "key:rotate"), false);
  assert.equal(allows("admin", "key:rotate"), true);
  assert.equal(allows("admin", "deploy:prod"), false);
});

test("an unknown permission is denied rather than allowed", () => {
  assert.equal(allows("admin", "reality:edit"), false);
});

test("a stored record verifies its password and nothing else", () => {
  const record = buildRecord("a@example.com", "dev", "correct horse");
  assert.equal(record.hash.length, 128);
  assert.ok(!JSON.stringify(record).includes("correct horse"));
  assert.equal(verify(record, "correct horse"), true);
  assert.equal(verify(record, "Correct horse"), false);
});

test("a login for an unknown address costs the same work", async () => {
  const provider = new JsonAuthProvider([buildRecord("known@example.com", "dev", "pw")]);
  const t0 = process.hrtime.bigint();
  assert.equal(await provider.login("known@example.com", "wrong"), null);
  const known = Number(process.hrtime.bigint() - t0);
  const t1 = process.hrtime.bigint();
  assert.equal(await provider.login("ghost@example.com", "wrong"), null);
  const ghost = Number(process.hrtime.bigint() - t1);
  // Same order of magnitude: the response time does not say which addresses exist.
  assert.ok(ghost > known / 3 && ghost < known * 6, `known=${known} ghost=${ghost}`);
});

test("the store keeps a digest, so a leaked file is not a leaked key", () => {
  const raw = "super-secret-value";
  const store = new ApiKeyStore([ApiKeyStore.digest(raw)]);
  assert.equal(store.check(raw), true);
  assert.equal(store.check("guess"), false);
  assert.equal(store.check(undefined), false);
  store.rotate("next");
  assert.equal(store.check(raw), false);
});

const ticket = (tag) => ({ id: "9", phase: "merged", releaseTag: tag, approvals: {} });

async function promotionWith(ledger = []) {
  const written = [];
  const svc = new PromotionService({
    ledger,
    audit: { write: async (r) => written.push(r) },
    clock: () => "2026-03-09T00:00:00.000Z",
  });
  return { svc, written };
}

test("the ladder refuses to be skipped", async () => {
  const { svc } = await promotionWith();
  await assert.rejects(() => svc.promote(ticket("v1.0.0"), "prod", "ops@example.com"), (e) => e.code === "ladder");
  await assert.rejects(() => svc.promote(ticket("v1.0.0"), "uat", "ops@example.com"), (e) => e.code === "ladder");
});

test("an untagged release cannot be promoted at all", async () => {
  const { svc } = await promotionWith();
  await assert.rejects(() => svc.promote(ticket(null), "sit", "ops@example.com"), (e) => e.code === "untagged");
});

test("climbing a rung needs a different human each time", async () => {
  const ledger = [];
  const { svc, written } = await promotionWith(ledger);
  await svc.promote(ticket("v1.0.0"), "sit", "ops@example.com");
  await assert.rejects(() => svc.promote(ticket("v1.0.0"), "uat", "ops@example.com"), (e) => e.code === "duty");
  await svc.promote(ticket("v1.0.0"), "uat", "qa@example.com");
  await svc.promote(ticket("v1.0.0"), "prod", "ops@example.com");
  assert.deepEqual(svc.status("v1.0.0").map((s) => s.ran), [true, true, true]);
  assert.equal(written.length, 3);
});

test("a re-run of a rung is skipped, not duplicated", async () => {
  const { svc } = await promotionWith();
  await svc.promote(ticket("v1.0.0"), "sit", "ops@example.com");
  const again = await svc.promote(ticket("v1.0.0"), "sit", "other@example.com");
  assert.equal(again.skipped, true);
});

test("a failed run is not evidence for the next rung", async () => {
  const { svc } = await promotionWith();
  await svc.recordFailure(ticket("v1.0.0"), "sit", "ops@example.com", "health check");
  await assert.rejects(() => svc.promote(ticket("v1.0.0"), "uat", "qa@example.com"), (e) => e.code === "ladder");
  const retry = await svc.promote(ticket("v1.0.0"), "sit", "ops@example.com");
  assert.equal(retry.result, "success");
  assert.equal((await svc.promote(ticket("v1.0.0"), "uat", "qa@example.com")).env, "uat");
});

test("the ladder is sit, uat, prod", () => {
  assert.deepEqual(LADDER, ["sit", "uat", "prod"]);
});

test("a burst is limited and recovers with time", () => {
  let now = 0;
  const limiter = new RateLimiter({ capacity: 3, refillPerSecond: 1, now: () => now });
  assert.equal(limiter.take("a").allowed, true);
  assert.equal(limiter.take("a").allowed, true);
  assert.equal(limiter.take("a").allowed, true);
  const denied = limiter.take("a");
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 1);
  now += 1500;
  assert.equal(limiter.take("a").allowed, true);
  assert.equal(limiter.take("b").allowed, true);
});

test("a session token is tamper-evident and expires", () => {
  const secret = "s";
  const token = sign({ email: "a@example.com", role: "dev", issuedAt: Date.now() }, secret);
  assert.equal(unsign(token, secret, 1000).role, "dev");
  assert.equal(unsign(token + "x", secret, 1000), null);
  assert.equal(unsign(token, "other-secret", 1000), null);
  const old = sign({ email: "a@example.com", role: "dev", issuedAt: Date.now() - 60000 }, secret);
  assert.equal(unsign(old, secret, 1000), null);
});

test("secrets are redacted without flattening the shape", () => {
  const out = redact({ kind: "login", password: "hunter2", nested: { token: "t", list: [1, 2] } });
  assert.equal(out.password, "[redacted]");
  assert.equal(out.nested.token, "[redacted]");
  assert.deepEqual(out.nested.list, [1, 2]);
});

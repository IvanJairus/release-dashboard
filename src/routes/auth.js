"use strict";

const express = require("express");
const { COOKIE, sign } = require("../middleware/auth.js");
const { permissionsFor } = require("../middleware/rbac.js");

const MAX_AGE_MS = 8 * 60 * 60 * 1000;

/*
  Login is the only endpoint that accepts unauthenticated writes, so it carries
  its own throttle: five attempts per identity, independent of the general rate
  limiter, because a locked-out engineer should still be able to read the board.
*/
function build({ auth, secret, audit, limiter }) {
  const router = express.Router();

  router.post("/login", async (req, res) => {
    const email = String((req.body || {}).email || "");
    const budget = limiter.take(`login:${email}`);
    if (!budget.allowed) {
      res.set("Retry-After", String(budget.retryAfterSeconds));
      await audit.write({ kind: "login-throttled", email });
      return res.status(429).json({ error: "too many attempts", retryAfterSeconds: budget.retryAfterSeconds });
    }
    const principal = await auth.login(email, (req.body || {}).password);
    if (!principal) {
      await audit.write({ kind: "login-failed", email });
      return res.status(401).json({ error: "invalid credentials" });
    }
    const token = sign({ ...principal, issuedAt: Date.now() }, secret);
    res.setHeader("Set-Cookie",
      `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_MS / 1000}`);
    await audit.write({ kind: "login", email: principal.email, role: principal.role });
    return res.json({ email: principal.email, role: principal.role });
  });

  router.post("/logout", (req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  // The console renders from this list rather than from a copy of the role
  // table, so a permission granted server-side shows up without a second edit.
  router.get("/whoami", (req, res) => {
    if (!req.principal) return res.json(null);
    res.json({ ...req.principal, permissions: permissionsFor(req.principal.role) });
  });
  return router;
}

module.exports = { build };

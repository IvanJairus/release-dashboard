"use strict";

const express = require("express");
const crypto = require("node:crypto");
const { requirePermission } = require("../middleware/auth.js");

function build({ keys, audit, limiter }) {
  const router = express.Router();

  router.get("/audit", requirePermission("audit:read"), async (req, res, next) => {
    try { res.json({ entries: await audit.read(Number(req.query.limit) || 200) }); } catch (e) { next(e); }
  });

  /*
    Rotation returns the new key exactly once - it is stored only as a digest,
    so this response is the only place the plaintext ever exists. The previous
    key keeps working until the next rotation, which is what makes rotating
    during a release window possible at all.
  */
  router.post("/keys/rotate", requirePermission("key:rotate"), async (req, res, next) => {
    try {
      const raw = crypto.randomBytes(24).toString("base64url");
      keys.rotate(raw);
      await audit.write({ kind: "key-rotated", actor: req.principal.email });
      res.json({ key: raw, note: "shown once; store it in the secret manager" });
    } catch (e) { next(e); }
  });

  router.get("/limiter", requirePermission("audit:read"), (req, res) => {
    res.json({ trackedPrincipals: limiter.sweep() });
  });

  return router;
}

module.exports = { build };

"use strict";

const express = require("express");
const { requirePermission } = require("../middleware/auth.js");
const { stamp } = require("../domain/watermark.js");

/*
  The UI and the board bot call the same two endpoints. `expectedRevision`
  belongs on every write: the caller states which version of the ticket it was
  looking at, and a stale view is refused instead of silently overwriting the
  person who moved the card one second earlier.
*/
function build({ tickets, audit }) {
  const router = express.Router();

  router.get("/", requirePermission("ticket:read"), async (req, res, next) => {
    try { res.json({ tickets: await tickets.all() }); } catch (e) { next(e); }
  });

  router.get("/:id", requirePermission("ticket:read"), async (req, res, next) => {
    try {
      const t = await tickets.find(req.params.id);
      if (!t) return res.status(404).json({ error: "not found" });
      res.json({ ticket: t });
    } catch (e) { next(e); }
  });

  router.post("/:id/actions/:action", requirePermission("ticket:comment"), async (req, res, next) => {
    try {
      const { expectedRevision, watermark } = req.body || {};
      const current = await tickets.find(req.params.id);
      if (!current) return res.status(404).json({ error: "not found" });
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        await audit.write({ kind: "conflict", ticket: current.id, actor: req.principal.email,
          expected: expectedRevision, actual: current.revision });
        return res.status(409).json({ error: "stale view", actualRevision: current.revision });
      }
      const result = await tickets.act({
        id: req.params.id, action: req.params.action,
        actor: req.principal.email, role: req.principal.role,
        watermark: watermark || stamp(req.params.action, current.revision),
      });
      res.status(result.applied ? 200 : 422).json(result);
    } catch (e) { next(e); }
  });

  router.post("/:id/approvals/:layer", requirePermission("ticket:comment"), async (req, res, next) => {
    try {
      const result = await tickets.approve({
        id: req.params.id, layer: req.params.layer,
        actor: req.principal.email, role: req.principal.role,
      });
      res.json(result);
    } catch (e) { next(e); }
  });

  return router;
}

module.exports = { build };

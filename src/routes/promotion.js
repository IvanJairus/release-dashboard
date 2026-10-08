"use strict";

const express = require("express");
const { requirePermission } = require("../middleware/auth.js");
const { LADDER } = require("../services/PromotionService.js");

function build({ tickets, promotion }) {
  const router = express.Router();

  router.get("/", requirePermission("ticket:read"), async (req, res, next) => {
    try {
      await promotion.loaded;
      res.json({ ladder: LADDER, ledger: promotion.ledger });
    } catch (e) { next(e); }
  });

  /*
    Promotion is the one place where a machine is allowed to act on a human's
    decision, so the permission name carries the environment: passing
    deploy:prod is a different fact from passing deploy:sit, and the audit says
    which one was used.
  */
  router.post("/:env", (req, res, next) => {
    const env = req.params.env;
    if (!LADDER.includes(env)) return res.status(400).json({ error: "unknown environment" });
    return requirePermission(`deploy:${env}`)(req, res, async () => {
      try {
        const ticket = await tickets.find(req.body.ticket);
        if (!ticket) return res.status(404).json({ error: "not found" });
        const result = await promotion.promote(ticket, env, req.principal.email);
        res.status(result.skipped ? 208 : 200).json(result);
      } catch (e) { next(e); }
    });
  });

  return router;
}

module.exports = { build };

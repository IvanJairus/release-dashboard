"use strict";

const express = require("express");
const { requirePermission } = require("../middleware/auth.js");
const { PERMISSIONS } = require("../middleware/rbac.js");
const { LADDER } = require("../services/PromotionService.js");

/*
  Read side of the console. One collection loader behind every view keeps the
  project filter in a single place: a row that appears under "Payments Core"
  must be impossible to see under another project, and that is easier to
  guarantee when only one function decides what belongs to a project.
*/
function build({ overview, audit, events, auth, startedAt }) {
  const router = express.Router();
  const project = (req) => String(req.query.project || "all");

  router.get("/overview", requirePermission("release:read"), async (req, res, next) => {
    try { res.json(await overview.dashboard(project(req))); } catch (e) { next(e); }
  });

  router.get("/deployments", requirePermission("release:read"), async (req, res, next) => {
    try {
      const c = await overview.collections(project(req));
      const env = req.query.env;
      const days = Number(req.query.days) || 0;
      const cutoff = days ? Date.now() - days * 86400000 : 0;
      const rows = c.deployments
        .filter((d) => (!env || env === "all" ? true : d.env === env))
        .filter((d) => (cutoff ? Date.parse(d.at) >= cutoff : true))
        .sort((a, b) => (a.at < b.at ? 1 : -1));
      const limit = Math.min(Number(req.query.limit) || 50, 500);
      res.json({ total: rows.length, deployments: rows.slice(0, limit) });
    } catch (e) { next(e); }
  });

  router.get("/plans", requirePermission("release:read"), async (req, res, next) => {
    try { res.json({ ladder: LADDER, plan: await overview.plan(project(req)) }); } catch (e) { next(e); }
  });

  router.get("/scans", requirePermission("release:read"), async (req, res, next) => {
    try {
      const c = await overview.collections(project(req));
      res.json({ scans: c.scans });
    } catch (e) { next(e); }
  });

  router.get("/test-runs", requirePermission("release:read"), async (req, res, next) => {
    try { res.json({ testRuns: (await overview.collections(project(req))).testRuns }); } catch (e) { next(e); }
  });

  // Names, paths and ages. There is no route in this app that returns a value,
  // because the board is not the secret store and should not be able to read it.
  router.get("/secrets", requirePermission("secret:read"), async (req, res, next) => {
    try { res.json({ secrets: await overview.secretLedger(project(req)) }); } catch (e) { next(e); }
  });

  router.get("/projects", requirePermission("release:read"), async (req, res, next) => {
    try {
      const c = await overview.collections("all");
      res.json({ projects: c.projects.map((p) => ({
        ...p,
        services: c.services.filter((s) => s.project === p.id).length,
      })) });
    } catch (e) { next(e); }
  });

  router.get("/users", requirePermission("user:read"), (_req, res) => {
    res.json({ users: auth.directory(), matrix: PERMISSIONS });
  });

  /*
    The console shows what the server believes about itself: store files that
    parsed, live subscriber count, and how long the process has been up. A
    control plane whose health page is a static "ok" is not being watched.
  */
  router.get("/health", requirePermission("release:read"), async (_req, res, next) => {
    try {
      const c = await overview.collections("all");
      res.json({
        ok: true,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        subscribers: events.size(),
        collections: {
          services: c.services.length,
          deployments: c.deployments.length,
          tickets: c.tickets.length,
          scans: c.scans.length,
          secrets: c.secrets.length,
        },
      });
    } catch (e) { next(e); }
  });

  // Switching the project filter is the one write every visitor makes; it goes
  // into the same trail as everything else so scope changes are reconstructable.
  router.post("/scope", requirePermission("release:read"), async (req, res, next) => {
    try {
      await audit.write({ kind: "scope", actor: req.principal.email, project: project(req) });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return router;
}

module.exports = { build };

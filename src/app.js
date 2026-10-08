"use strict";

const path = require("node:path");
const express = require("express");

const { JsonFileRepository } = require("./repositories/JsonFileRepository.js");
const { JsonAuthProvider, ApiKeyStore } = require("./auth/JsonAuthProvider.js");
const { AuditService, redact } = require("./services/AuditService.js");
const { EventBus } = require("./services/EventBus.js");
const { TicketService } = require("./services/TicketService.js");
const { PromotionService } = require("./services/PromotionService.js");
const { RateLimiter } = require("./middleware/rateLimiter.js");
const { attachSession } = require("./middleware/auth.js");
const { requireApiKey } = require("./middleware/apiKey.js");
const { requestLogger, line } = require("./middleware/logger.js");
const { Rejected } = require("./domain/ticket.js");

const routes = {
  auth: require("./routes/auth.js"),
  tickets: require("./routes/tickets.js"),
  promotion: require("./routes/promotion.js"),
  events: require("./routes/events.js"),
  admin: require("./routes/admin.js"),
};

function createApp(config) {
  const repo = new JsonFileRepository(config.dataDir);
  const audit = new AuditService({ path: config.auditPath, redact });
  const events = new EventBus();
  const limiter = new RateLimiter();
  const keys = new ApiKeyStore(config.apiKeyDigests);
  const auth = new JsonAuthProvider(config.users);
  const tickets = new TicketService({ repo, audit, events });
  const promotion = new PromotionService({ ledger: [], audit });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(requestLogger());
  app.use(attachSession(config.sessionSecret));

  app.get("/healthz", (req, res) => res.json({ ok: true, clients: events.size() }));
  app.use("/api/auth", routes.auth.build({ auth, secret: config.sessionSecret, audit, limiter }));
  app.use("/api/tickets", routes.tickets.build({ tickets, audit }));
  app.use("/api/promotions", routes.promotion.build({ tickets, promotion }));
  // The CI job posts its own progress; it is a machine caller and never gets a
  // session, so its routes are mounted behind the key rather than the cookie.
  app.use("/api/ci/deploy", requireApiKey(keys), (req, res, next) => {
    promotion.recordFailure({ releaseTag: req.body.releaseTag }, req.body.env, req.principal.email, req.body.reason)
      .then((e) => res.json(e)).catch(next);
  });
  app.use("/api", routes.events.build({ events }));
  app.use("/api/admin", routes.admin.build({ keys, audit, limiter }));

  app.use(express.static(path.join(__dirname, "..", "public"), { index: "index.html" }));

  app.use((err, req, res, next) => {
    if (err instanceof Rejected) return res.status(422).json({ error: err.message, code: err.code });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "malformed json" });
    console.error(line("unhandled", { path: req.originalUrl, err: err.stack || err.message }));
    res.status(500).json({ error: "internal error" });
  });

  return { app, events, services: { tickets, promotion, audit, keys, limiter } };
}

module.exports = { createApp };

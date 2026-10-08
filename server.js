"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createApp } = require("./src/app.js");
const { line } = require("./src/middleware/logger.js");

/*
  Nothing here has a default that would let the server start with an insecure or
  invented identity: a missing session secret, user file or API key digest is a
  startup failure, not a warning. A control plane that boots half-configured is
  worse than one that refuses to boot.
*/
function readConfig(env) {
  const missing = [];
  const need = (name) => {
    if (!env[name]) missing.push(name);
    return env[name];
  };
  const sessionSecret = need("SESSION_SECRET");
  const usersFile = need("USERS_FILE");
  const apiKeyDigests = (env.API_KEY_DIGESTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKeyDigests.length) missing.push("API_KEY_DIGESTS");
  if (missing.length) throw new Error(`refusing to start, missing: ${missing.join(", ")}`);

  return {
    sessionSecret,
    users: JSON.parse(fs.readFileSync(path.resolve(usersFile), "utf8")).users,
    apiKeyDigests,
    dataDir: env.DATA_DIR || path.join(__dirname, "data"),
    auditPath: env.AUDIT_FILE || path.join(__dirname, "data", "audit-log.jsonl"),
    port: Number(env.PORT) || 4173,
  };
}

if (require.main === module) {
  const config = readConfig(process.env);
  const { app, events } = createApp(config);
  const beat = events.heartbeat();
  const server = app.listen(config.port, () => {
    console.log(line("listen", { port: config.port, dataDir: config.dataDir }));
  });
  const stop = () => {
    clearInterval(beat);
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

module.exports = { readConfig };

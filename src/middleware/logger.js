"use strict";

/*
  Every stage logs a line with the ticket it acted on and the decision it made.
  Debugging a release at 2am means grepping for one ticket id, so the prefix is
  the contract and it is never omitted - including on the paths that do nothing.
*/
const NS = "release-dashboard";

function line(event, fields) {
  const kv = Object.entries(fields || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  return `${NS} ${event}${kv ? " " + kv : ""}`;
}

function requestLogger(sink = console) {
  return (req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      sink.log(line("request", {
        method: req.method, path: req.originalUrl, status: res.statusCode,
        actor: req.principal && req.principal.email, ms: Date.now() - started,
      }));
    });
    next();
  };
}

module.exports = { line, requestLogger, NS };

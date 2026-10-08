"use strict";

const crypto = require("node:crypto");
const { allows } = require("./rbac.js");

const COOKIE = "rd_session";

/*
  Sessions are a signed payload in a cookie, not a server-side map: the control
  plane is restarted during its own deploys, and a restart must not log everyone
  out or leak a table of who was signed in.
*/
function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function unsign(token, secret, maxAgeMs) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest();
  const got = Buffer.from(parts[1], "base64url");
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
  if (maxAgeMs && Date.now() - (payload.issuedAt || 0) > maxAgeMs) return null;
  return payload;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function attachSession(secret, maxAgeMs = 8 * 60 * 60 * 1000) {
  return (req, res, next) => {
    req.principal = unsign(parseCookies(req.headers.cookie)[COOKIE], secret, maxAgeMs);
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.principal) return res.status(401).json({ error: "authentication required" });
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.principal) return res.status(401).json({ error: "authentication required" });
    if (!allows(req.principal.role, permission)) {
      return res.status(403).json({ error: "not allowed", needs: permission, role: req.principal.role });
    }
    next();
  };
}

module.exports = { COOKIE, sign, unsign, parseCookies, attachSession, requireAuth, requirePermission };

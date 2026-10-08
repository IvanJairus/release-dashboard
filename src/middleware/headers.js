"use strict";

/*
  The document is a single-origin app: no CDN, no inline script, no frame. The
  policy says so out loud, which is the only way a later dependency that wants
  to phone home fails in review instead of quietly succeeding in production.
*/
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

function securityHeaders() {
  return (req, res, next) => {
    res.set({
      "Content-Security-Policy": CSP,
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
      "Cache-Control": "no-store",
    });
    next();
  };
}

module.exports = { securityHeaders, CSP };

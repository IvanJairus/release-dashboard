"use strict";

/*
  Machine callers send a key in a header. The comparison goes through the
  digest store, so a timing difference never reveals a prefix, and a caller that
  presents both a session and a key is treated as the key - it is the narrower
  identity, and the audit line should not overstate who acted.
*/
function requireApiKey(store, { header = "x-api-key", service = "ci" } = {}) {
  return (req, res, next) => {
    const raw = req.headers[header];
    if (!store.check(raw)) return res.status(401).json({ error: "invalid api key" });
    req.principal = { email: `${service}@machine`, role: service, via: "api-key" };
    next();
  };
}

module.exports = { requireApiKey };

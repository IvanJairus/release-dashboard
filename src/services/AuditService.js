"use strict";

const fs = require("node:fs");

/*
  Append-only, one JSON object per line, never rewritten. A release question
  asked six months later is "who moved this card and what did they see", and
  the answer has to survive the board being edited.
*/
class AuditService {
  constructor({ path, clock, redact }) {
    this.path = path;
    this.clock = clock || (() => new Date().toISOString());
    // Keys, tokens and password material must not reach the log even when a
    // caller passes a whole request body through.
    this.redact = redact || ((v) => v);
  }

  async write(record) {
    const line = JSON.stringify({ at: this.clock(), ...this.redact(record) }) + "\n";
    await fs.promises.appendFile(this.path, line, "utf8");
    return record;
  }

  async read(limit = 200) {
    let raw = "";
    try { raw = await fs.promises.readFile(this.path, "utf8"); } catch { return []; }
    return raw.trim().split("\n").slice(-limit).filter(Boolean).map((l) => JSON.parse(l));
  }
}

const SECRET_KEYS = /^(password|hash|salt|token|secret|apikey|api_key|authorization|cookie)$/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v);
  }
  return out;
}

module.exports = { AuditService, redact };

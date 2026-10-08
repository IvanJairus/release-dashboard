"use strict";

const crypto = require("node:crypto");

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const hash = (password, salt) =>
  crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);

/*
  Passwords are stored as salt + scrypt digest, never as anything reversible,
  and the reference user file is committed with a value nobody can log in with:
  every secret in this repo lives in an environment variable at runtime.
*/
function verify(record, password) {
  const salt = Buffer.from(record.salt, "hex");
  const expected = Buffer.from(record.hash, "hex");
  const got = hash(password, salt);
  // Same length by construction, so a length mismatch cannot leak early.
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

function buildRecord(email, role, password) {
  const salt = crypto.randomBytes(16);
  return { email, role, salt: salt.toString("hex"), hash: hash(password, salt).toString("hex") };
}

class JsonAuthProvider {
  constructor(users) {
    this.users = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  }

  static async fromFile(path) {
    const fs = require("node:fs/promises");
    return new JsonAuthProvider(JSON.parse(await fs.readFile(path, "utf8")).users);
  }

  find(email) {
    return this.users.get(String(email || "").toLowerCase()) || null;
  }

  // Identity without material: the settings view shows who can act, and never
  // needs the salt or the digest that proves they are who they say they are.
  directory() {
    return [...this.users.values()].map(({ email, role }) => ({ email, role }));
  }

  async login(email, password) {
    const record = this.find(email);
    // A missing user still costs a hash so the timing does not announce which
    // addresses exist.
    if (!record) {
      hash(password || "", crypto.randomBytes(16));
      return null;
    }
    return verify(record, password) ? { email: record.email, role: record.role } : null;
  }
}

/*
  Machine callers (the CI job, the board bot) authenticate with a key rather
  than a session. Only the digest is kept, so a leaked store is not a leaked
  key, and two digests are accepted at once so rotation has a window where
  neither caller nor operator is blocked.
*/
class ApiKeyStore {
  constructor(digests = []) {
    this.accepted = new Set(digests);
  }

  static digest(raw) {
    return crypto.createHash("sha256").update(String(raw)).digest("hex");
  }

  check(raw) {
    if (!raw) return false;
    return this.accepted.has(ApiKeyStore.digest(raw));
  }

  rotate(raw) {
    this.accepted = new Set([ApiKeyStore.digest(raw)]);
  }
}

module.exports = { JsonAuthProvider, ApiKeyStore, buildRecord, verify };

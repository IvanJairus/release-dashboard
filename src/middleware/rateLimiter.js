"use strict";

/*
  Token bucket per principal. The board's own CI pollers are the reason this
  exists: a runaway job should get a 429 with a wait time, not a slower server
  for every human on the page.
*/
class RateLimiter {
  constructor({ capacity = 30, refillPerSecond = 5, now = Date.now } = {}) {
    this.capacity = capacity;
    this.refill = refillPerSecond / 1000;
    this.now = now;
    this.buckets = new Map();
  }

  take(principal, cost = 1) {
    const key = principal || "anonymous";
    const t = this.now();
    const b = this.buckets.get(key) || { tokens: this.capacity, at: t };
    b.tokens = Math.min(this.capacity, b.tokens + (t - b.at) * this.refill);
    b.at = t;
    if (b.tokens < cost) {
      this.buckets.set(key, b);
      const need = cost - b.tokens;
      return { allowed: false, retryAfterSeconds: Math.ceil(need / this.refill / 1000) };
    }
    b.tokens -= cost;
    this.buckets.set(key, b);
    return { allowed: true, remaining: Math.floor(b.tokens) };
  }

  // Idle principals are forgotten; a limiter that remembers every IP ever seen
  // is its own memory leak.
  sweep(maxAgeMs = 600000) {
    const cutoff = this.now() - maxAgeMs;
    for (const [k, b] of this.buckets) if (b.at < cutoff) this.buckets.delete(k);
    return this.buckets.size;
  }
}

module.exports = { RateLimiter };

"use strict";

/*
  The board is watched by people and by CI jobs, so every state change is
  published once and delivered over one long-lived connection per client. SSE
  is chosen over a websocket because the traffic is one-way and the reconnect
  semantics are the browser's problem, not ours.
*/
class EventBus {
  constructor({ maxClients = 64, heartbeatMs = 25000 } = {}) {
    this.clients = new Set();
    this.maxClients = maxClients;
    this.heartbeatMs = heartbeatMs;
  }

  size() {
    return this.clients.size;
  }

  add(res) {
    // A stalled client that nobody closed would otherwise leak a socket per
    // page reload, so the oldest one is dropped before the next is accepted.
    if (this.clients.size >= this.maxClients) {
      const oldest = this.clients.values().next().value;
      this.remove(oldest);
    }
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
    return res;
  }

  remove(res) {
    if (res && !res.writableEnded) res.end();
    this.clients.delete(res);
  }

  publish(event) {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) {
      // A dead pipe must not stop the release board for everyone else.
      try { res.write(frame); } catch { this.clients.delete(res); }
    }
    return this.clients.size;
  }

  heartbeat() {
    return setInterval(() => {
      for (const res of this.clients) {
        try { res.write(": keep-alive\n\n"); } catch { this.clients.delete(res); }
      }
    }, this.heartbeatMs);
  }
}

module.exports = { EventBus };

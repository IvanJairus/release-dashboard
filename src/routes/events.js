"use strict";

const express = require("express");

function build({ events }) {
  const router = express.Router();

  router.get("/stream", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    res.flushHeaders && res.flushHeaders();
    events.add(res);
    res.write(`event: hello\ndata: ${JSON.stringify({ clients: events.size() })}\n\n`);
  });

  return router;
}

module.exports = { build };

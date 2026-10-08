"use strict";

/*
  The orchestrator runs on board events, and its own comments are board events.
  Without a break, one deploy trigger becomes an endless loop of itself.

  Every command carries the revision it was computed against. A ticket only
  advances its revision inside a transition, so a command stamped at or below
  the revision that produced it is stale by construction - no clock, no
  coordination service, nothing to expire.
*/

const stamp = (action, revision) => `${action}@${revision}`;

const STAMP = /^(.+)@(\d+)$/;

function parse(stored) {
  const m = STAMP.exec(stored || "");
  return m ? { action: m[1], revision: Number(m[2]) } : null;
}

// Returns null when the command is fresh, or the reason it was dropped.
function evaluate(ticket, watermark) {
  const got = parse(watermark);
  if (!got) return { dropped: "malformed watermark" };
  const current = ticket.revision || 0;
  if (got.revision < current) return { dropped: `stale: issued at r${got.revision}, ticket is at r${current}` };
  const seen = (ticket.watermarks || []).map(parse).filter(Boolean);
  const hit = seen.find((s) => s.action === got.action && s.revision === got.revision);
  if (hit) return { dropped: `duplicate: ${got.action}@${got.revision} already applied` };
  return null;
}

function mark(ticket, watermark) {
  const seen = ticket.watermarks || [];
  // Bounded so a long-lived ticket cannot grow its own history forever; the
  // window only has to be wider than any real retry burst.
  const kept = [...seen, watermark].slice(-50);
  return { ...ticket, watermarks: kept };
}

module.exports = { stamp, parse, evaluate, mark };

"use strict";

/*
  The board is the source of truth, so this module never keeps state of its
  own: a ticket is a plain object, every transition returns a new one, and the
  guards below are the only thing standing between a webhook and a deploy.
*/

const PHASES = ["intake", "in-dev", "in-review", "merged", "deployed"];

const LAYERS = ["team", "business", "product", "architecture", "engineering"];

class Rejected extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Rejected";
    this.code = code;
  }
}

const isTagged = (t) => /^v\d+\.\d+\.\d+$/.test(t.releaseTag || "");

const approvedLayers = (t) =>
  LAYERS.filter((l) => (t.approvals || {})[l]);

const guards = {
  startDevelopment: (t) => t.phase === "intake",
  openMergeRequest: (t) => t.phase === "in-dev" && !!t.branch,

  // A merge request without an MR object is how the incident started; the
  // phase alone is not proof that anything was reviewed.
  merge: (t) => {
    if (t.phase !== "in-review" || !t.mergeRequest) return false;
    return approvedLayers(t).length === LAYERS.length;
  },

  // Promotion is tag-and-merge: an untagged deploy is a guess about what shipped.
  deploy: (t) => t.phase === "merged" && isTagged(t),
};

const NEXT = {
  startDevelopment: "in-dev",
  openMergeRequest: "in-review",
  merge: "merged",
  deploy: "deployed",
};

function transition(ticket, action, actor, now) {
  const guard = guards[action];
  if (!guard) throw new Rejected("unknown-action", `no transition named ${action}`);
  if (!guard(ticket)) {
    throw new Rejected("state", `${action} refused from phase ${ticket.phase}`);
  }
  const approvals = { ...(ticket.approvals || {}) };
  if (action === "merge") {
    // Recorded again at merge time so the chain and the actor are comparable
    // later; the board comments are the human-readable copy of this.
    approvals.merged_by = actor;
  }
  return {
    ...ticket,
    phase: NEXT[action],
    approvals,
    revision: (ticket.revision || 0) + 1,
    updatedAt: now,
    history: [...(ticket.history || []), { action, actor, at: now }],
  };
}

/*
  Segregation of duties: the person who approves the last layer may not be the
  person who merges. Enforced here rather than in the UI because the UI is the
  one thing an automated caller skips.
*/
function assertSeparation(ticket, actor) {
  const last = ticket.approvals && ticket.approvals._last;
  if (last && last === actor) {
    throw new Rejected("duty", "the final approver cannot merge their own approval");
  }
}

function recordApproval(ticket, layer, actor, now) {
  if (!LAYERS.includes(layer)) throw new Rejected("unknown-layer", `no approval layer ${layer}`);
  if (ticket.phase !== "in-review") throw new Rejected("state", `${layer} approval needs in-review`);
  const approvals = { ...(ticket.approvals || {}), [layer]: actor, _last: actor };
  return { ...ticket, approvals, revision: (ticket.revision || 0) + 1, updatedAt: now };
}

const missingApprovals = (t) => LAYERS.filter((l) => !approvedLayers(t).includes(l));

module.exports = { PHASES, LAYERS, Rejected, transition, recordApproval, assertSeparation, missingApprovals, isTagged };

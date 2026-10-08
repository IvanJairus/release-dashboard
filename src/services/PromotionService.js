"use strict";

const { Rejected, isTagged } = require("../domain/ticket.js");

/*
  SIT -> UAT -> PROD is a ladder, not a dropdown. What makes it a control
  rather than a convention is that each rung is proven against the artifact that
  will actually ship: the release tag. A tag that never ran in UAT cannot be
  promoted to PROD even if the ticket says it did, because the ledger - not the
  ticket - is what remembers.
*/
const LADDER = ["sit", "uat", "prod"];

const REQUIRED_PREDECESSOR = { sit: null, uat: "sit", prod: "uat" };

class PromotionService {
  constructor({ ledger, audit, clock }) {
    this.ledger = ledger;
    this.audit = audit;
    this.clock = clock || (() => new Date().toISOString());
  }

  ran(tag, env) {
    return this.ledger.some((e) => e.releaseTag === tag && e.env === env && e.result === "success");
  }

  async promote(ticket, env, actor) {
    if (!LADDER.includes(env)) throw new Rejected("unknown-env", `no environment ${env}`);
    if (!isTagged(ticket)) throw new Rejected("untagged", "promotion needs a release tag");
    if (ticket.phase !== "merged" && ticket.phase !== "deployed") {
      throw new Rejected("state", `${env} promotion needs a merged ticket`);
    }
    const tag = ticket.releaseTag;

    const before = REQUIRED_PREDECESSOR[env];
    if (before && !this.ran(tag, before)) {
      throw new Rejected("ladder", `${tag} never succeeded in ${before}`);
    }
    // The person who deployed the lower environment may not open the next one.
    const prior = this.ledger.find((e) => e.releaseTag === tag && e.env === before);
    if (prior && prior.actor === actor) {
      throw new Rejected("duty", `${actor} deployed ${before} and cannot promote to ${env}`);
    }
    if (this.ran(tag, env)) {
      return { skipped: true, reason: `${tag} already deployed to ${env}` };
    }

    const entry = { releaseTag: tag, env, actor, at: this.clock(), result: "success" };
    this.ledger.push(entry);
    await this.audit.write({ kind: "promotion", ...entry });
    return entry;
  }

  // A failed deploy is still evidence - it is what stops the next rung.
  async recordFailure(ticket, env, actor, reason) {
    const entry = { releaseTag: ticket.releaseTag, env, actor, at: this.clock(), result: "failed", reason };
    this.ledger.push(entry);
    await this.audit.write({ kind: "promotion", ...entry });
    return entry;
  }

  status(tag) {
    return LADDER.map((env) => ({ env, ran: this.ran(tag, env) }));
  }
}

module.exports = { PromotionService, LADDER, REQUIRED_PREDECESSOR };

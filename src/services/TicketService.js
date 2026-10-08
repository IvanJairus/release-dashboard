"use strict";

const { Rejected, transition, recordApproval, assertSeparation, missingApprovals } =
  require("../domain/ticket.js");
const { evaluate, mark } = require("../domain/watermark.js");
const { allows, approvalPermission } = require("../middleware/rbac.js");

/*
  One write path for every caller - the web UI, the CI job and the board bot all
  arrive here. That is the point: the guards are in one place, so there is no
  route that can be reached with weaker rules than the ones a human sees.

  A refusal is a normal result, not an exception that escapes. The caller gets
  the reason and the audit gets the attempt, because "who tried to deploy this"
  is a question with an answer here.
*/
class TicketService {
  constructor({ repo, audit, events, clock }) {
    this.repo = repo;
    this.audit = audit;
    this.events = events;
    this.clock = clock || (() => new Date().toISOString());
  }

  async all() {
    return (await this.repo.read("tickets", { tickets: [] })).tickets;
  }

  async find(id) {
    return (await this.all()).find((t) => t.id === String(id)) || null;
  }

  async save(list) {
    await this.repo.write("tickets", { tickets: list });
    return list;
  }

  async act({ id, action, actor, role, watermark }) {
    const list = await this.all();
    const index = list.findIndex((t) => t.id === String(id));
    if (index < 0) throw new Rejected("not-found", `no ticket ${id}`);
    const ticket = list[index];

    if (watermark) {
      const stale = evaluate(ticket, watermark);
      if (stale) {
        await this.audit.write({ kind: "dropped", ticket: id, action, actor, reason: stale.dropped });
        return { applied: false, dropped: stale.dropped, ticket };
      }
    }

    let next;
    try {
      if (action === "merge") assertSeparation(ticket, actor);
      next = transition(ticket, action, actor, this.clock());
      if (watermark) next = mark(next, watermark);
    } catch (err) {
      if (!(err instanceof Rejected)) throw err;
      await this.audit.write({ kind: "refused", ticket: id, action, actor, code: err.code, reason: err.message });
      this.events && this.events.publish({ type: "refused", ticket: id, action, code: err.code });
      return { applied: false, refused: { code: err.code, message: err.message }, ticket };
    }

    list[index] = next;
    await this.save(list);
    await this.audit.write({ kind: "transition", ticket: id, action, actor, phase: next.phase, revision: next.revision });
    this.events && this.events.publish({ type: "ticket", ticket: id, phase: next.phase, revision: next.revision });
    return { applied: true, ticket: next };
  }

  async approve({ id, layer, actor, role }) {
    if (!allows(role, approvalPermission(layer))) {
      throw new Rejected("duty", `${role} may not grant ${layer} approval`);
    }
    const list = await this.all();
    const index = list.findIndex((t) => t.id === String(id));
    if (index < 0) throw new Rejected("not-found", `no ticket ${id}`);
    const next = recordApproval(list[index], layer, actor, this.clock());
    list[index] = next;
    await this.save(list);
    await this.audit.write({ kind: "approval", ticket: id, layer, actor, stillMissing: missingApprovals(next) });
    this.events && this.events.publish({ type: "approval", ticket: id, layer, actor });
    return { applied: true, ticket: next, stillMissing: missingApprovals(next) };
  }
}

module.exports = { TicketService };

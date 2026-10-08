# Architecture

Six decisions, each with what it bought and what it cost. Written for the person
who has to maintain this after I have moved on — which is the same person who
would otherwise inherit a pile of conventions nobody can name.

## 1. The ticket is the state, not the database row

**Decision.** A release's current phase lives in the ticket, and every transition
returns a new ticket object with its own revision number. There is no second copy
of "where is this release" anywhere else in the system.

**Why it was chosen.** Two records of the same fact drift, and the drift is
invisible until someone asks "why did PROD get this build?". With one record, the
question has one answer.

**What it costs.** Concurrency. Two people editing the same card is now a real
conflict, so every write carries the revision the caller was looking at and a
stale view is refused with `409` rather than silently overwritten.

## 2. Guards belong in the domain, not the UI

**Decision.** `src/domain/ticket.js` holds every rule about what may move. Routes
translate HTTP into a call to the one write path in `TicketService`.

**Why it was chosen.** The UI is the one caller an automated job skips. A rule
that only exists in a button's disabled state is a suggestion.

**What it costs.** Duplication of intent: the client also knows which buttons to
draw, and if the two disagree the server wins and the user sees a refusal. The
refusal is rendered on the card, which is what makes the disagreement visible
instead of mysterious.

## 3. Five approval layers are five separate permissions

**Decision.** `approval:grant:team`, `…business`, `…product`, `…architecture`,
`…engineering` are distinct rights, and the layer a person may sign is decided by
their role — no role holds all five, and the developer role holds only `team`.

**Why it was chosen.** A single "can approve" right turns a five-layer chain into
a formality: one account signs everything and the audit trail looks compliant.
Separating them makes the chain a property of the permission table rather than a
policy document.

**What it costs.** Real releases need five humans, so a small team feels it. The
mitigation is that the layers are named after responsibilities, not job titles, so
one person holding two responsibilities shows up honestly in the audit as two
different grants — and the last-approver-cannot-merge rule still applies.

## 4. The ladder proves the artifact, not the ticket

**Decision.** Promotion from SIT to UAT to PROD is checked against the release
tag: `v1.2.3` may enter UAT only if `v1.2.3` succeeded in SIT, per the ledger.
The ticket's own phase is not evidence.

**Why it was chosen.** Tickets get edited. A tag is content-addressed enough that
"this exact build ran there" is a claim worth enforcing, and it is the claim that
survives a rebase or a cherry-pick.

**What it costs.** A failed run must be recorded too, or the absence of evidence
and the evidence of failure look identical. `recordFailure` exists for that, and
`ran()` deliberately only counts successes.

## 5. A revision-stamped watermark breaks webhook loops

**Decision.** Every command carries `action@revision`. A ticket only advances its
revision inside a transition, so a command stamped at or below the revision that
produced it is stale by construction. Applied stamps are kept in a bounded window
of 50.

**Why it was chosen.** The orchestrator reacts to board events, and its own
comments are board events. The first time that loop ran in production it deployed
the same build repeatedly until someone noticed; the fix had to be stateless,
because a "last seen event id" table is a second thing to get right.

**What it costs.** The stamp is only as good as the revision counter. A code path
that mutates a ticket without incrementing it would defeat the guard, which is why
there is exactly one write path and the domain functions are pure.

## 6. Fail closed at the edges

**Decision.** The server refuses to start without a session secret, a user file
and at least one API key digest. Password verification costs the same work for an
unknown address. Audit records redact secret-shaped keys on the way in. JSON
stores are written to a temp file, synced, then renamed.

**Why it was chosen.** A control plane that boots half-configured will quietly
serve an unauthenticated board, and the outage that follows a corrupt state file
is indistinguishable from a data-loss incident.

**What it costs.** Convenience. `npm start` without environment variables fails,
and the error names the missing variables — which is the intended behaviour, in a
demo repo as much as in production.

## Shape of a request

```
browser / CI job
   |
   v
rate limiter -> session or api key -> rbac permission
   |
   v
TicketService.act()            <- the only write path
   |   watermark?  stale or duplicate -> audit "dropped", return
   |   guard?      refused          -> audit "refused", publish "refused", 422
   v
new ticket (revision + 1) -> atomic file write -> audit "transition"
   |
   v
EventBus.publish -> every open board re-reads
```

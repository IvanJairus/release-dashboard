# Release control plane — reference implementation

A small web application that turns an issue board into a deployment pipeline's
control surface: cards carry the release state, humans approve by layer, machines
deploy by environment, and every decision — including the ones that were refused
— ends up in an append-only audit file.

This is a **reconstruction** of a system I designed and ran in production, not a
copy of it. The production code is not published. Everything here was written
again from the design, with invented data, so the parts worth reviewing — the
guards, the state machine, the permission model — can be read and run.

## The problem in one paragraph

An issue board tells you what people intend. A pipeline tells you what machines
did. When those two are separate systems, the board becomes theatre: a card moves
to "Deployed" because someone remembered to move it, and the release calendar is
a spreadsheet. This app makes the board the authoritative record by refusing to
let a card advance unless the thing that justifies the move is present in the
card itself — a merge request for a merge, a release tag for a deploy, five named
approvals before either.

## Run it

```bash
npm install
npm run seed                       # writes data/*.json (all of it invented)
SESSION_SECRET=$(openssl rand -hex 32) \
  USERS_FILE=./data/users.json \
  API_KEY_DIGESTS=$(node -e "console.log(require('./src/auth/JsonAuthProvider').ApiKeyStore.digest('demo-key-change-me'))") \
  npm start
```

Open <http://localhost:4173> and sign in as `ops@example.com` with the seeded
password `change-me-demo`. The demo password exists so the app is runnable; it is
never read from disk by anything but the seed script.

```bash
npm test             # 30 unit tests, node:test, no test framework
node scripts/smoke.js  # 16 checks against a live server: session, refusal, audit
```

## What is enforced here

Each rule is a guard, and each guard has a test that tries to break it.

| Rule | Where | Proved by |
|---|---|---|
| A phase cannot be skipped | `src/domain/ticket.js` | `a phase cannot be skipped` |
| A merge needs a merge request, not just a card in review | `guards.merge` | `merge is refused when the merge request does not exist` |
| A merge needs all five approval layers | `guards.merge` | `merge is refused while any layer is missing` |
| A deploy needs a well-formed release tag | `guards.deploy` | `deploy needs a release tag, and only a well-formed one` |
| The last approver cannot merge their own approval | `assertSeparation` | `the last approver cannot merge` |
| UAT needs a successful SIT for the same tag; PROD needs UAT | `PromotionService` | `the ladder refuses to be skipped` |
| The person who ran a rung cannot run the next one | `PromotionService.promote` | `climbing a rung needs a different human each time` |
| A failed run is not evidence | `PromotionService.ran` | `a failed run is not evidence for the next rung` |
| A webhook that re-triggers itself is dropped | `src/domain/watermark.js` | `the loop breaker: the event a command caused cannot re-issue it` |
| A stale browser view cannot overwrite a newer one | `routes/tickets.js` | `a stale view is refused, not applied` |
| No role can grant every approval layer | `src/middleware/rbac.js` | `no role holds every approval layer` |
| Passwords are never stored or logged recoverably | `JsonAuthProvider`, `AuditService.redact` | `a stored record verifies its password and nothing else` |
| The server will not boot half-configured | `server.js readConfig` | `refusing to start, missing: …` |

## Layout

```
server.js                        config parsing and startup; fails closed
src/domain/ticket.js             phases, transitions, approval layers, guards
src/domain/watermark.js          idempotency: the loop breaker
src/middleware/rbac.js           15 permissions, 4 roles, no role is a superuser
src/middleware/auth.js           signed-cookie sessions, permission middleware
src/middleware/apiKey.js         machine callers
src/middleware/rateLimiter.js    token bucket per principal
src/middleware/logger.js         one grep-able prefix for every stage
src/auth/JsonAuthProvider.js     scrypt password verification, digest-only API keys
src/services/TicketService.js    the single write path for every caller
src/services/PromotionService.js the environment ladder and its segregation rule
src/services/EventBus.js         SSE fan-out to every open board
src/services/AuditService.js     append-only JSONL, secrets redacted
src/repositories/JsonFileRepository.js  atomic writes via rename
src/routes/                      auth, tickets, promotions, events, admin
public/                          the board: no framework, one EventSource
tests/ scripts/                  30 unit tests + a live-server smoke suite
data/                            synthetic fixtures produced by npm run seed
```

## Numbers, measured rather than remembered

- 1.023 lines of server-side JavaScript, 272 lines of client, 465 lines of tests
  and scripts, across 35 tracked files.
- 21 route handlers. 4 roles, 15 named permissions, 5 approval layers, 3
  environments.
- 30 unit tests pass and 16 smoke checks pass on Node 20 and Node 24.
- One runtime dependency: `express`. Sessions, password hashing, API key digests
  and the token bucket are all `node:crypto`, so the supply chain a reviewer has
  to trust is short on purpose.

## What is deliberately absent

- **No employer.** No company name, hostname, project path, ticket number from a
  real board, or internal URL. `scripts/check-sanitised.sh` fails the build if any
  of those appear, and CI runs it.
- **No real data.** Every service name, ticket, email and date in `data/` is
  invented by `scripts/seed.js`. The shapes are faithful; the values are not.
- **No database.** The production system had one. A JSON store with atomic
  rename keeps this readable and reviewable; the guards, not the storage engine,
  are the point.
- **No UI polish.** The board exists to show a refusal next to the card that
  caused it. It is not a design portfolio piece.

## Licence

Code is MIT; prose is CC BY-NC-ND 4.0. See [LICENSE.md](LICENSE.md).

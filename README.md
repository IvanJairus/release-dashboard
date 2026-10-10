# Release control plane, reference implementation

A small web application that turns an issue board into a deployment pipeline's
control surface: cards carry the release state, humans approve by layer, machines
deploy by environment, and every decision ends up in an append-only audit file,
including the ones that were refused.

This is a **reconstruction** of a system I designed and ran in production, not a
copy of it. The production code is not published. Everything here was written
again from the design, with invented data, so the parts worth reviewing, the guards, the state
machine and the permission model, can be read and run.

## The problem in one paragraph

An issue board tells you what people intend. A pipeline tells you what machines
did. When those two are separate systems, the board becomes theatre: a card moves
to "Deployed" because someone remembered to move it, and the release calendar is
a spreadsheet. This app makes the board the authoritative record by refusing to
let a card advance unless the thing that justifies the move is present in the
card itself: a merge request for a merge, a release tag for a deploy, five named
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
npm test               # 38 unit tests, node:test, no test framework
node scripts/smoke.js  # 25 checks against a live server: session, refusal, audit
```

## What the console shows

Eight views, one page, no framework and no CDN: the browser loads the same ES
modules you can read in `public/js/`, and every number on screen is computed by
the server from the record files on request.

| View | What it answers |
|---|---|
| Dashboard | how many services drift between SIT and UAT, and how often anything deploys |
| Board | which ticket is stuck, and the guard's exact refusal text next to it |
| Deploys | history, a promotion form that cannot skip a rung, and the live event stream |
| Pre-UAT | the release plan, generated from version drift alone, with a reason per block |
| Scans | quality gates and image findings, the inputs the plan refuses to promote |
| Testing | recorded suites and their pass rate |
| Secrets | vault paths, rotation age, and no way to read a value |
| Settings | projects, the account directory, key rotation, the audit trail, self-reported health |

The sidebar's project filter scopes every one of those views through a single
loader, and the access policy is rendered from the server's own permission table
rather than a copy kept in the client.

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
| Reading release data is not reading credential paths | `rbac.js`, `routes/insights.js` | `reading secret paths is a separate right from reading releases` |
| A release plan cannot contain a service that did not change | `OverviewService.releasePlan` | `a plan row lists every reason it is blocked, not just the first` |
| Nothing in the API can return a secret value | `routes/insights.js` | `a secret value reached the API` |
| Passwords are never stored or logged recoverably | `JsonAuthProvider`, `AuditService.redact` | `a stored record verifies its password and nothing else` |
| The server will not boot half-configured | `server.js readConfig` | `refusing to start, missing: …` |

## Layout

```
server.js                        config parsing and startup; fails closed
src/domain/ticket.js             phases, transitions, approval layers, guards
src/domain/watermark.js          idempotency: the loop breaker
src/middleware/rbac.js           18 permissions, 4 roles, no role is a superuser
src/middleware/auth.js           signed-cookie sessions, permission middleware
src/middleware/apiKey.js         machine callers
src/middleware/headers.js        CSP and friends: single-origin, no inline script
src/middleware/rateLimiter.js    token bucket per principal
src/middleware/logger.js         one grep-able prefix for every stage
src/auth/JsonAuthProvider.js     scrypt password verification, digest-only API keys
src/services/TicketService.js    the single write path for every caller
src/services/PromotionService.js the environment ladder and its segregation rule
src/services/OverviewService.js  every number on screen, derived not stored
src/services/EventBus.js         SSE fan-out to every open board
src/services/AuditService.js     append-only JSONL, secrets redacted
src/repositories/JsonFileRepository.js  atomic writes via rename
src/routes/                      auth, tickets, promotions, insights, events, admin
public/                          the console: ES modules, hand-written CSS, SVG charts
tests/ scripts/                  38 unit tests + a live-server smoke suite
data/                            synthetic fixtures produced by npm run seed
```

## Numbers, measured rather than remembered

- 1.399 lines of server-side JavaScript, 1.330 lines of client, 370 lines of CSS
  and 834 lines of tests and scripts, across 65 tracked files.
- 23 route handlers behind a session, plus one key-gated route for machine
  callers. 4 roles, 18 named permissions, 5 approval layers, 3 environments.
- 38 unit tests pass and 25 smoke checks pass on Node 20 and Node 24.
- One runtime dependency: `express`. Sessions, password hashing, API key digests
  and the token bucket are all `node:crypto`, so the supply chain a reviewer has
  to trust is short on purpose. The browser gets no third-party script either:
  the charts are SVG drawn in `public/js/charts.js`.

## What is deliberately absent

- **No employer.** No company name, hostname, project path, ticket number from a
  real board, or internal URL. `scripts/check-sanitised.sh` fails the build if any
  of those appear, and CI runs it.
- **No real data.** Every service name, ticket, email and date in `data/` is
  invented by `scripts/seed.js`. The shapes are faithful; the values are not.
- **No database.** The production system had one. A JSON store with atomic
  rename keeps this readable and reviewable; the guards, not the storage engine,
  are the point.
- **No invented numbers on screen.** The dashboard's success rate, drift count
  and deploy percentiles are computed from `data/*.json` on every request. Change
  a record and the figure moves; that is the difference between a console and a
  mockup.
- **No UI framework.** The console is hand-written CSS and ES modules with no
  build step, because a reviewer should be able to read the file the browser
  runs. It is dense because it is an operator's tool, not a design piece.

## Licence

Code is MIT; prose is CC BY-NC-ND 4.0. See [LICENSE.md](LICENSE.md).

# SupportDesk: project guide for Claude

Customer support web app for existing business clients. Tickets, FAQ/KB deflection, SLA, feedback, three roles.
Built in phases (see "Phase status"); the owner wants to understand the system, so explain _why_ after each phase and stop for a go-ahead.

## Working across sessions (v2, read first)

This project is worked on from two places: the claude.ai chat and Claude Code in the terminal. Neither sees the other's conversation, so the repo is the shared memory:

- `docs/ROADMAP.md`: the plan for Phases 0 and 9-15 with checkboxes. Pick the next unchecked task; tick it when done.
- `docs/SESSION_LOG.md`: at the START of a session read the latest entry; at the END add one (what changed, what is half-done, next step).
- Decisions go to `docs/ASSUMPTIONS.md`; finished phases get a notes section here, like Phases 1-8.
- **Mentor mode (owner's choice, v2):** the owner writes the code and runs the commands. Claude guides step by step, explains the _why_, reviews the owner's work and points out mistakes; do NOT implement tasks unless the owner explicitly asks for that specific piece.

## Stack

- **client/**: React 18 (plain JS), Vite, React Router 7, TanStack Query, React Hook Form, Tailwind v4. Tests: Vitest + RTL.
- **server/**: Node 20+ (22 in Docker), Express 4 (ES modules, plain JS), Prisma 6 + PostgreSQL 16, Zod, Pino, Helmet, express-rate-limit. Tests: Jest + Supertest.
- **Infra**: Docker Compose Postgres. npm workspaces monorepo. One ESLint flat config + Prettier at the root.

## Commands (run from repo root)

| Command                           | What it does                                            |
| --------------------------------- | ------------------------------------------------------- |
| `npm run setup`                   | install, start DB, migrate, seed (first time)           |
| `npm run dev`                     | DB + API (:4000) + web (:5173)                          |
| `npm test`                        | server + client tests                                   |
| `npm run lint` / `npm run format` | ESLint / Prettier                                       |
| `npm run db:migrate`              | `prisma migrate dev`                                    |
| `npm run db:seed` / `db:reset`    | reseed (destructive) / reset DB                         |
| `npm run db:up` / `db:down`       | start / stop Postgres container                         |
| `npm run build` / `npm start`     | build client / migrate + run API (serves `CLIENT_DIST`) |
| `npm run test:coverage`           | tests with coverage thresholds                          |
| `npm run docs:openapi`            | regenerate `docs/openapi.json` (a test fails if stale)  |

## Folder structure

```
server/
  prisma/            schema.prisma, migrations/, seed.js
  src/
    config/env.js    Zod-validated env; the ONLY place that reads process.env
    lib/             prisma client, logger, AppError helpers, tokens, password, mailer, scope, scopedDb, access
    middleware/      validate, errorHandler, rateLimit, auth (authenticate, requireRole, requireProject, csrfGuard)
    routes/          URL -> controller wiring, mounted in routes/index.js under /api/v1
    controllers/     HTTP only: read req, call service, shape res
    services/        business rules; the only layer that talks to Prisma
    validators/      Zod schemas per feature
    utils/           asyncHandler etc.
  tests/             Jest + Supertest
client/src/
  api/client.js      fetch wrapper (ApiError)
  context/           AuthContext (stub until Phase 2), ToastContext
  layouts/           PublicLayout, AppLayout (role-aware nav)
  lib/navigation.js  nav per role (UI hint only; server is the authority)
  pages/, components/, routes.jsx
docs/ASSUMPTIONS.md  defaults chosen where the brief was open
```

## Conventions

- Layering: routes -> controllers -> services -> Prisma. Controllers never touch Prisma; services never touch `req/res`.
- Every route validates body/query/params with Zod via `validate()`; handlers are wrapped in `asyncHandler`.
- Errors: throw `AppError` helpers from `lib/errors.js`. Response shape is always `{ error: { code, message, details } }`.
- Out-of-scope resources return **404, not 403**.
- Comments explain _why_, not _what_. No TypeScript. ESM everywhere (`import`, `.js` extensions on relative imports).
- API is REST under `/api/v1`.

## Tenant isolation (built in Phase 2: the critical rule)

One place enforces it, in three small pieces:

1. `server/src/lib/scope.js` `buildScope()`: pure function turning (role, memberships, active project) into `scope.projectIds` (`null` = all, `[]` = nothing). CUSTOMER: active project only, if member. SUPPORT: active project, or `ALL` = all assigned. ADMIN: `ALL` = everything, or one project.
2. `middleware/auth.js` `authenticate`: verifies JWT, RELOADS the user + memberships every request (deactivation/membership removal is instant), sets `req.auth = { user, scope }` and `req.db`.
3. `lib/scopedDb.js` `scopedDb(scope)`: Prisma `$extends` client that ANDs the scope into every read/update/delete on tenant models (ticket, ticketMessage, attachment, ticketEvent, feedback, faqArticle, faqCategory, kbSearchLog, cannedReply, notification), checks project on create, hides INTERNAL_NOTE messages (and their attachments) from customers, and forbids `upsert`.

Rules for contributors:

- Tenant data is ONLY accessed through `req.db` (never bare `prisma` for those models). Out-of-scope = `null` -> `notFound()` -> 404.
- Never `include`/`select` `messages`, `attachments` or `events` from a ticket for customers (the guard throws): query the scoped model instead. Extension hooks cannot see nested reads/writes, so do not use nested writes on tenant models.
- New tenant model? Add a rule to `RULES` in `scopedDb.js` AND an isolation test in `tests/isolation.test.js`.
- `requireProject` on any route that touches tenant data; `requireRole(...)` for role-only routes.

## Auth model

- Access JWT (15 min, `sub`, `pid`) in memory on the client; role is NOT read from the token. Refresh token = opaque random, SHA-256 hashed in DB, httpOnly cookie `sd_refresh` (Path `/api/v1/auth`), rotated on every use, reuse of a rotated token revokes the family. Cookie endpoints (`/auth/refresh`, `/auth/logout`) need header `X-Requested-With: SupportDesk` + allowed Origin.
- Login: generic errors, timing-equalised unknown-user path, lockout after 5 failures with exponential backoff (423), status errors (pending/unverified/deactivated) only revealed after a correct password.
- `pid` claim: a project id, `ALL` (admin/support), or null (must pick). Single-project users are auto-selected; others see the picker. `lastProjectId` is remembered and restored on refresh.
- Single-use hashed tokens: email verification (24h), password reset (1h), invitations (7d).

## API so far (`/api/v1`)

`GET /auth/organizations` · `POST /auth/register|verify-email|resend-verification|login|forgot-password|reset-password|accept-invite` · `GET /auth/invitations/:token` · `POST /auth/refresh|logout` (CSRF) · `GET /auth/me` · `POST /auth/select-project` · `PATCH /users/me` · `POST /users/me/password` · `POST /invitations` (admin) · `GET /tickets/:id`, `/attachments/:id`, `/faq/articles/:id` (minimal scoped reads; grown in Phases 4-5).

## Admin API (Phase 3, `/api/v1/admin`, ADMIN only)

All routes sit behind `authenticate + requireRole('ADMIN')` in `routes/admin.routes.js`. These models (organization, project, user, invitation) are administrative, not tenant data, so services use base `prisma`; the role gate is the protection. Every mutation calls `audit()` (in the same transaction).

- `organizations` GET/POST, GET/PATCH `:id` (archiving cascades to its projects)
- `projects` GET/POST, GET/PATCH `:id` (key immutable), POST `:id/members`, DELETE `:id/members/:userId`
- `users` GET/POST, GET/PATCH `:id`, PUT `:id/projects`, POST `:id/deactivate|reactivate|unlock|approve|reject`
- `invitations` GET/POST, DELETE `:id`
- List contract: `?page&limit(<=100)&sort&dir&q` + filters, response `{ items, page, limit, total, totalPages }`; sort fields are whitelisted (`lib/pagination.js`).
- Membership rules live in `project.service.js assertCanJoin`: only SUPPORT/CUSTOMER have memberships; customers only join projects of their own organization. Changing a user's role or organization clears memberships and revokes sessions.
- Safety: admins cannot change/deactivate themselves; last-active-admin check; rejected registrations are kept as DEACTIVATED; approval requires a verified email.

## FAQ / knowledge base (Phase 4, `/api/v1/faq`)

All routes: `authenticate + requireProject`, everything via `req.db`. Customers see PUBLISHED articles of the active project + published global ones; staff also see drafts within their scope.

- **Search** (`services/faq.service.js`): `FaqArticle.searchVector` is a GENERATED tsvector (question weight A, answer B, 'english' config) + GIN index, created in the `faq_search` migration. `buildTsQuery` keeps only letters/digits (no operator injection) and prefix-matches the last word. `/search` = all words, `/suggest` = any word. Raw SQL only returns ranked ids; rows are then read through the scoped client, so SQL mistakes cannot widen access.
- **Prisma + generated column:** the schema declares `searchVector Unsupported("tsvector")? @default(dbgenerated(...))` with the exact normalised expression, so `prisma migrate diff` reports no drift. If you ever change the expression, update both the migration and that `dbgenerated` string. Prefer `npx prisma migrate deploy` in scripts: `migrate dev` can hang in non-interactive shells.
- **Markdown:** stored raw, rendered on the server (`lib/markdown.js`: marked + DOMPurify on jsdom with an allow-list: no images/iframes/scripts/handlers, only http(s)/mailto links, h1 demoted). The client injects only `answerHtml` via `<RichHtml>`. (`sanitize-html` was replaced in Phase 8: advisories, and its ESM-only htmlparser2 broke Jest.)
- **Analytics:** `KbSearchLog` rows are written for CUSTOMER searches only (`/search` always, `/suggest` only with `log=true`), deduped per user+query for 60s; `POST /search-logs/:id/click` sets `clickedArticleId`; `faq.service.markTicketCreated()` is for the Phase 5 ticket service. `GET /manage/search-insights` powers the "Search gaps" tab.
- **Votes:** `FaqVote` (one per user per article); counters on FaqArticle move atomically in a transaction. Customers only.
- **Management** (`/manage/*`, SUPPORT/ADMIN): create/edit/delete articles and categories, markdown preview, config. Global content (`projectId: null`) is admin-only and needs "All projects". Optional approval flow: admin setting `faqRequireApproval` (`/admin/settings`); when on, support can only draft.
- `FaqSuggestions` (components) is ready for the Phase 5 new-ticket subject field.

## Tickets (Phase 5, `/api/v1/tickets`, `/attachments`, `/canned-replies`, `/categories`)

All routes: per-route guard `authenticate + requireProject` (NOT `router.use`: the router is mounted at `/`, a router-level guard would turn unknown URLs into 401s), everything through `req.db`.

- **State machine** (`lib/ticketStateMachine.js`, pure, exhaustively unit-tested): actors STAFF / CUSTOMER / SYSTEM. OPEN, IN_PROGRESS, WAITING_ON_CUSTOMER, REOPENED, RESOLVED, CLOSED (terminal). Services must call `assertTransition()`; never compare statuses ad hoc. Customers: close their own ticket, reopen a RESOLVED one within `reopenWindowDays` (setting, default 7); staff can always reopen. Side effects go through the SYSTEM actor (customer reply on WAITING_ON_CUSTOMER -> IN_PROGRESS; staff public reply on OPEN/REOPENED -> IN_PROGRESS; merge -> CLOSED).
- **Numbers:** `Project.ticketSeq` incremented by one atomic UPDATE inside the creation transaction (row lock = no duplicates, gap-free); `@@unique([projectId, sequence])` backs it up. Creation uses NESTED writes (messages/events/attachments inside `ticket.create`) because scoped child-create hooks check the parent ticket via the base client, which cannot see an uncommitted ticket.
- **Visibility:** customers see all tickets of their active project; internal notes (and their attachments) and non-status events are filtered by the scoped models / `CUSTOMER_EVENTS`. Customers may only change the status of tickets THEY raised. Customers cannot create INTERNAL_NOTE, set priority URGENT, or assign.
- **Every change** writes a `TicketEvent` (names, not ids, in from/to values for assignee/category) and status changes/merges also write a `SYSTEM` message. `firstResponseAt` = first PUBLIC staff reply. TODO(phase 6) markers show where notifications and SLA pause/resume plug in.
- **Attachments** (`middleware/upload.js`): extension + MIME allow-list, 10 MB / 5 files, random UUID names in `UPLOAD_DIR` (never served statically), magic-byte sniffing, cleanup of files from failed requests, downloads only via `GET /attachments/:id/download` (scoped lookup, `Content-Disposition: attachment`, `nosniff`). The client downloads with `apiBlob()` because the bearer token is needed.
- **Merge:** same project only; source becomes CLOSED with `mergedIntoId`; both tickets get a SYSTEM message + MERGED event; messages are not moved.
- **Assignment:** assignee must be an ACTIVE admin or support member of the ticket's project; bulk assign is all-or-nothing (any out-of-scope/invalid ticket aborts everything).
- **Canned replies:** GLOBAL (admin-managed), PROJECT, PERSONAL; visibility is a rule inside `scopedDb`; edit rights in `cannedReply.service.js`.
- Ticket text is plain text (React escapes it); only FAQ answers are markdown/HTML.

## SLA, notifications, feedback, jobs (Phase 6)

- **SLA** (`lib/sla.js`, pure + unit-tested; `services/sla.service.js` policy lookup): tickets store ABSOLUTE due dates. Policy = project override > global row > `DEFAULT_SLA`. Set at creation, recomputed from `createdAt` on priority change (flags cleared). `WAITING_ON_CUSTOMER` pauses (`slaPausedAt`); leaving it (customer reply, staff resolve/close, merge) calls `slaPatchForTransition()` which pushes both due dates out and accumulates `slaPausedSeconds`. ANY code that changes ticket status must merge `slaPatchForTransition(ticket, to, now)` into its update. `slaState()` gives OK/WARNING (<=25% of the window left)/BREACHED/PAUSED/MET/MET_LATE/NONE. SLA is returned to STAFF only (`ticket.sla`); customers never get due dates.
- **Jobs** (`jobs/`, node-cron, started from `server.js` only when `JOBS_ENABLED`, never by `createApp`, so tests do not start timers): `runSlaCheck` every minute (flags WARNING/BREACHED once per ticket via a conditional `updateMany` claim, writes `SLA_*` events, notifies assignee or project support, breach also admins) and `runAutoClose` hourly (RESOLVED older than `autoCloseAfterDays` -> CLOSED through the state machine as SYSTEM). Both run once at startup to catch up. Run jobs on ONE instance if you scale out (the claims make duplicates harmless, not free).
- **Notifications** (`services/notification.service.js`): `notify()` never throws. Rules: nobody is notified of their own action; internal notes notify nobody (there is no call for them); prefs `emailOnReply|emailOnStatusChange|emailOnAssignment|inApp` (defaults all true) switch email vs in-app independently; ticket confirmation and SLA alerts are transactional (always emailed). Recipients: created -> creator; assigned -> assignee; public reply -> other side (customer reply goes to the assignee only); status change -> creator (staff acted) or assignee (customer acted); resolved -> creator with `?rate=1` link; merge -> duplicate's creator. Bulk assignment = one email, one in-app row per ticket. API: `/notifications` (list, unread filter), `/unread-count`, `POST /:id/read`, `/read-all`; per-user, no project required.
- **Feedback:** `POST /tickets/:id/feedback` (creator only, RESOLVED/CLOSED with `resolvedAt`, not merged). One row per ticket, editable for `feedbackEditWindowHours` (default 24) from creation, then 409 `FEEDBACK_LOCKED`. DB `CHECK` 1..5 (`feedback_rating_check` migration). Visible to staff and the creator only (`ticket.feedback`, `ticket.canRate`). Reopening records a `REOPENED` event (the "reopened instead of rating" signal); an existing rating survives a reopen.
- **Admin config** (`/admin/categories`, `/admin/sla-policies`, `/admin/settings`): categories are deactivated, never deleted; SLA changes affect new tickets and priority changes only; settings validated (reopen/auto-close 1-90 days, feedback window 1-168 h) and audited.
- **Seed:** tickets get due dates from the default targets, so a fresh `npm run dev` immediately shows two overdue tickets flagged by the startup job.

## Reports, export, audit viewer (Phase 7)

- **Reports** (`/api/v1/reports/{overview,csat,deflection}` admin-only, `/me` staff): `services/report.service.js`. These are raw-SQL aggregates (date bucketing, percentiles, FILTER counts) so they BYPASS the scoped Prisma client. **`lib/scopeSql.js` is therefore the isolation boundary for reports**: `reportProjectIds(scope, ?projectId)` (a project outside the scope, or nonexistent, is 404) + `projectCondition(ids, column)` must appear in EVERY report query. `tests/reports.test.js` mutation-checks this (removing the condition fails tests). Never interpolate user input into the SQL; only whitelisted literals go through `Prisma.raw`.
- **Definitions** (also in ASSUMPTIONS): UTC whole days `[from, to)` (max 366 days, default 30; weekly buckets above 92 days, zero days filled in `bucketKeys`); merged duplicates excluded; first response = tickets CREATED in the period and answered; resolution time = tickets RESOLVED in the period minus `slaPausedSeconds`; SLA compliance = tickets created in the period whose clock reached a verdict (paused / closed-unanswered / not yet due are excluded); reopen rate = REOPENED events / resolution events in the period; CSAT by `Feedback.createdAt` in the period, grouped by CURRENT assignee/category/project.
- **FAQ deflection** reuses `faqManage.service.searchInsights` (scoped client), now with `deflected` (read an article, no ticket) and `deflectionRate`; accepts `{ days }` or `{ from, to }`.
- **CSV export** `GET /tickets/export.csv` (staff, scoped client, same filters as the queue via `buildTicketWhere` plus `from`/`to` created dates): size check BEFORE streaming (413 `EXPORT_TOO_LARGE`, limit `EXPORT_MAX_ROWS`, default 20000), then keyset batches of 500 with backpressure; `lib/csv.js` quotes per RFC 4180, prefixes `'` to cells starting with `= + - @ TAB CR` (CSV injection), adds a BOM; no message text, internal notes or feedback comments; every export writes a `tickets.export` audit entry.
- **Audit viewer** `GET /admin/audit-logs` (+ `/filters`): admin-only and read-only (no write routes exist); filters actor/action prefix/entity/date range/text; metadata is displayed as JSON text.
- **Charts** (`components/charts.jsx`, tokens in `index.css` `.viz`): hand-rolled SVG following the dataviz skill: 2px lines, 10% area wash, 8px end-dots with a 2px surface ring, hairline solid grid, legend for 2 series, pointer AND keyboard (arrow keys) readout, table twin (`<details>`), single-color `BarList` for nominal categories. Series colours (blue/orange) were validated with the skill's `validate_palette.js` (light mode; the app has no dark theme). Filters live in ONE row above the blocks (`ReportFilters`); each block (`ReportSection`) has its own loading/error/retry and dims (not flashes) while refetching.

## Hardening, docs, deployment (Phase 8)

- **Route registry:** `routes/mounts.js` is the single list of mounted routers; `docs/routeTable.js` walks the live Express app, `docs/openapi.js` builds OpenAPI 3.0 from those routes plus the Zod schemas (route metadata is attached by `validate()`, `authenticate`, `upload`). `tests/routeMatrix.test.js` asserts every route's auth behaviour (anonymous 401 unless on the explicit public list, wrong role denied, project required); `tests/openapi.test.js` fails if a route is undocumented or `docs/openapi.json` is stale. **Adding a route: guard it per route, add its Zod schema through `validate()`, run `npm run docs:openapi`.**
- **Config:** every env var lives in `config/env.js`, with production-only rules (real distinct JWT secrets, https `CLIENT_URL`, explicit https CORS origins). `TRUST_PROXY` defaults to 0; set it to the real proxy count. Table of variables: `docs/DEPLOYMENT.md`.
- **Serving:** `createApp({ clientDist })`, `spa.js` serves `client/dist` when `CLIENT_DIST` is set (assets cached 1 year, missing assets and `/api/*` are real 404s, other paths get `index.html`). `server.js` owns timeouts, crash handlers, graceful shutdown and the jobs; `createApp` has no side effects (tests rely on that).
- **Observability:** request id (`X-Request-Id`), pino-http with scrubbed serializers (`lib/logger.js` `redactUrl` hides tokens in URLs), readiness `/health/ready` returns 503 without the DB.
- **Hardening done:** DOMPurify sanitiser, nodemailer/node-cron upgrades, `escapeLike` for search, JWT `iss`/`aud`, password byte-length cap (bcrypt truncates at 72 bytes), per-route guards. Full list and accepted risks: `docs/SECURITY.md`.
- **Docker:** multi-stage `Dockerfile` (client build -> prod deps -> runtime as non-root under tini), `docker/entrypoint.sh` runs `prisma migrate deploy` then the server. The `server/node_modules` copy is needed because npm does not hoist every package (node-cron lives there).
- **Client resilience/a11y:** `ErrorBoundary`, `RouteAnnouncer` (focus + live region on navigation), skip links, mobile menu in `AppLayout`, in-app 404, network-error mapping in `api/client.js`, axe tests in `test/A11y.test.jsx`. Scroll containers (`.overflow-x-auto`) are `position: relative` in `index.css` so `.sr-only` text inside tables cannot stretch the page. Details: `docs/ACCESSIBILITY.md`.
- **Test rules learned:** never run two test processes at once (shared `supportdesk_test` DB); in Jest ESM import `jest` from `@jest/globals`; after Prettier reformats code, re-check any scripted regex edits actually applied.

## Client admin UI conventions

`components/ui.jsx` (Modal on native `<dialog>`, ConfirmDialog instead of `window.confirm`, Pagination, Badge, QueryState = loading/error+retry/empty, table helpers); `lib/query.js` (`useList`, `qs`, debounce); `lib/useAdminMutation.js` (mutation + toast + invalidation). New list pages should reuse these.

## Key decisions

See `docs/ASSUMPTIONS.md` (and `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/ACCESSIBILITY.md`). Headlines: Priority is an enum; per-project atomic ticket counter; tokens stored hashed; refresh rotation with reuse detection; FTS via generated tsvector (Phase 4).

## Phase status

1. Foundation: **done** (this commit)
2. Auth, roles, scoping, project selection: **done**
3. Projects/orgs/users admin + approvals: **done**
4. FAQ/KB: **done**
5. Tickets: **done**
6. SLA, notifications, feedback: **done**
7. Dashboards, reports, audit viewer: **done**
8. Hardening, docs, deployment notes: **done**

## Dev credentials

All seeded users: password `Passw0rd!dev`. See README.

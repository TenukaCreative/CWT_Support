# SupportDesk

A customer-support web app for existing business clients. Customers pick a project, search the FAQ, raise and track tickets and rate the support. Support staff work the queue. Admins manage organisations, projects and users, and watch the numbers.

- **Three roles:** `ADMIN`, `SUPPORT`, `CUSTOMER`, with strict organisation and project isolation enforced in one place on the server.
- **Stack:** React 18 + Vite + React Router + TanStack Query + React Hook Form + Tailwind; Express (ESM) + Prisma + PostgreSQL; JWT access token + rotating httpOnly refresh cookie; Zod validation. Tests: Jest + Supertest (server), Vitest + Testing Library (client).

> Status: all 8 phases are complete. Contributor and architecture notes for people (and AI assistants) are in [`CLAUDE.md`](CLAUDE.md).

## Contents

1. [Quick start](#quick-start)
2. [Try the three journeys](#try-the-three-journeys)
3. [Architecture](#architecture)
4. [Folder structure](#folder-structure)
5. [Key decisions](#key-decisions)
6. [Features by area](#features-by-area)
7. [Testing](#testing)
8. [API documentation](#api-documentation)
9. [Security](#security)
10. [Accessibility](#accessibility)
11. [Production deployment](#production-deployment)
12. [Scripts](#scripts)
13. [More documentation](#more-documentation)

## Quick start

Prerequisites: Node 20+ (22 recommended), Docker.

```bash
npm run setup     # install deps, start Postgres (Docker), run migrations, seed demo data
npm run dev       # Postgres + API (http://localhost:4000) + web (http://localhost:5173)
```

`setup` expects `server/.env`; copy `server/.env.example` to `server/.env` first if it does not exist. Open http://localhost:5173. In development, emails (verification, reset, invitations, notifications) are **printed in the API console** (look for `[dev mail]`).

### Seed credentials (development only)

Password for every account: `Passw0rd!dev`

| Email                   | Role                        | Projects                          |
| ----------------------- | --------------------------- | --------------------------------- |
| `admin@supportdesk.dev` | ADMIN                       | all                               |
| `sam@supportdesk.dev`   | SUPPORT                     | ACME-WEB, ACME-APP                |
| `riley@supportdesk.dev` | SUPPORT                     | ACME-WEB, GLX-PORTAL              |
| `alice@acme.example`    | CUSTOMER                    | ACME-WEB, ACME-APP (two projects) |
| `bob@acme.example`      | CUSTOMER                    | ACME-WEB                          |
| `carol@globex.example`  | CUSTOMER                    | GLX-PORTAL                        |
| `dave@globex.example`   | CUSTOMER (pending approval) | none yet                          |

Two organisations (Acme Corp, Globex Inc), three projects, FAQ articles, and about 45 tickets in every status over the last 8 weeks (with ratings and two overdue tickets) are seeded. **Never run the seed against production.**

## Try the three journeys

End-to-end flow the app is built around (also automated in `server/tests/journey.test.js`):

1. **Customer:** register -> verify email -> (admin approves) -> log in -> pick a project -> search the Help Center -> raise a ticket (FAQ suggestions appear while typing the subject).
2. **Support:** open the ticket queue -> assign it to yourself -> reply publicly / add an internal note -> mark it waiting on the customer (SLA clock pauses) -> resolve.
3. **Customer:** gets a notification -> rates the resolution (1-5 stars).
4. **Admin:** the dashboard shows the new ticket, SLA compliance and the rating; the audit log shows administrative actions; the ticket list exports to CSV.

Quick manual run: log in as `alice@acme.example`, create a ticket in ACME-WEB; log in as `sam@supportdesk.dev`, reply and resolve it; back as Alice, rate it; as `admin@supportdesk.dev` look at the dashboard.

## Architecture

```
Browser (React SPA)
   |  /api/v1  (JSON, Bearer access token; refresh cookie only on /api/v1/auth)
   v
Express:  helmet -> CORS allow-list -> request id/logging -> rate limits -> routes
   routes -> controllers (HTTP only) -> services (business rules) -> Prisma -> PostgreSQL
                                   \-> scoped Prisma client (tenant isolation)
   cron jobs (in the same process): SLA check every minute, auto-close hourly
   uploads: local disk, served only through the authenticated, scoped API
```

In development Vite serves the client and proxies `/api` to Express. In production the API serves the built client itself (`CLIENT_DIST`), so there is one origin and no CORS.

### How the pieces fit

- **Layering.** Routes wire URLs to controllers; controllers touch only `req`/`res`; services hold the rules and are the only code that talks to the database. Every route validates input with Zod (`validate()`), and every failure becomes one error shape: `{ "error": { "code", "message", "details" } }`.
- **Tenant isolation (the critical rule).** `buildScope()` turns the user's role, memberships and active project into the set of project ids a request may touch. `authenticate` re-reads the user on every request, and tenant data is accessed **only** through `req.db`, a Prisma client extension that adds the scope to every query. Out-of-scope records are a 404. Raw-SQL reports use `lib/scopeSql.js` for the same guarantee. A route-matrix test proves every route is guarded.
- **Auth.** Short-lived JWT in memory + opaque refresh token (hashed in the database, rotated each use, reuse revokes the session family). The role is read from the database each request, not from the token.
- **Ticket state machine.** All status changes pass through one pure, exhaustively tested table (`lib/ticketStateMachine.js`) with separate rules for staff, customer and system actors. SLA due dates are stored as absolute timestamps and pause while a ticket waits on the customer.
- **FAQ search.** PostgreSQL full text search over a generated `tsvector` column with a GIN index; stemming and prefix matching as you type; only ranked ids come from raw SQL and the rows are then loaded through the scoped client.
- **Notifications.** One `notify()` function decides recipients and channels (in-app and email, per user preference) and never throws, so a mail failure cannot break a ticket action.
- **Reports.** Live SQL aggregates with documented cohort definitions (`docs/ASSUMPTIONS.md`); hand-built SVG charts with keyboard access and a table alternative.

## Folder structure

```
.
├── server/
│   ├── prisma/             schema.prisma, migrations/, seed.js
│   ├── scripts/            generate-openapi.js
│   ├── src/
│   │   ├── config/env.js   Zod-validated env: the ONLY place that reads process.env
│   │   ├── lib/            prisma, logger, errors, tokens, password, mailer, scope, scopedDb, scopeSql,
│   │   │                   ticketStateMachine, sla, csv, markdown, pagination
│   │   ├── middleware/     authenticate/requireRole/requireProject, validate, upload, rateLimit, errors
│   │   ├── routes/         URL -> controller wiring; mounts.js is the single list of mounted routers
│   │   ├── controllers/    HTTP only
│   │   ├── services/       business rules (the only layer that uses Prisma)
│   │   ├── validators/     Zod schemas per feature
│   │   ├── jobs/           SLA check, auto-close (node-cron, started by server.js only)
│   │   ├── docs/           route table + OpenAPI generator
│   │   ├── app.js          createApp(): middleware + routes (no side effects, test friendly)
│   │   ├── spa.js          serves the built client in production
│   │   └── server.js       process entry: listen, jobs, timeouts, graceful shutdown
│   └── tests/              Jest + Supertest (separate supportdesk_test database)
├── client/
│   └── src/
│       ├── api/            fetch wrapper (ApiError, token refresh, network error mapping)
│       ├── context/        auth, toasts
│       ├── layouts/        PublicLayout, AppLayout (role-aware navigation)
│       ├── components/     shared UI (ui.jsx, Field, charts, ErrorBoundary, RouteAnnouncer, ...)
│       ├── pages/          public, admin, faq, tickets, reports
│       ├── lib/            navigation, query helpers, route titles
│       └── test/           Vitest + Testing Library + axe
├── docs/                   ASSUMPTIONS, DEPLOYMENT, SECURITY, ACCESSIBILITY, openapi.json
├── docker/entrypoint.sh    runs migrations then starts the server
├── Dockerfile              production image (API + web)
├── docker-compose.yml      development PostgreSQL
├── docker-compose.prod.example.yml
└── CLAUDE.md               contributor guide and conventions
```

## Key decisions

The full list with reasoning (what the brief left open and what was chosen) is in [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md). The ones that shape everything:

- **One isolation layer, 404 for out-of-scope.** Reduces "did every query remember the filter?" to "is every route using `req.db`?", which is tested.
- **Server is the authority.** Role-aware navigation is a hint; every route checks again.
- **Refresh rotation with reuse detection**, tokens stored hashed, generic auth errors, lockout.
- **Plain-text tickets, sanitised markdown only for staff-written FAQ.** User content cannot inject markup.
- **Absolute SLA due dates with explicit pause accounting**, wall-clock hours (no business calendars in v1).
- **Priority is a fixed enum**; its SLA targets are configurable.
- **Jobs inside the API process**, safe to duplicate, switchable per instance.
- **Uploads on local disk behind an authenticated download route**; swap the storage engine for object storage when scaling out.
- **Hand-built charts** instead of a chart library: no dependency, full control over keyboard and table access.

## Features by area

**Authentication and users.** Register (customer) -> email verification -> admin approval (or invitation), login with project picker, switch project from the header, password reset, profile and notification preferences, lockout and rate limits.

**Admin.** Organisations, projects (immutable key, member management), users (create, invite, role/organisation, project assignment, deactivate/reactivate/unlock), pending approvals, categories, per-priority SLA targets (global and per project), settings (reopen window, auto-close days, feedback window, FAQ approval), audit log (read-only), dashboard and CSV export.

**Help Center / FAQ.** Search with stemming and as-you-type matching, categories, helpful votes, "create a ticket" fallback, quick search on the dashboard. Staff manage articles (live markdown preview, optional approval flow), categories, and see a "Search gaps" report of searches that found nothing.

**Tickets.** Customers: new ticket with live FAQ suggestions, attachments (type, size and content checks), project ticket list with filters, conversation, public replies, close, reopen within 7 days. Staff: queue with filters, sorting, saved views, bulk assign, "My tickets", internal notes, canned replies (global, project, personal), status/priority/category/assignee, merge duplicates, full history, SLA panel.

**SLA, notifications, feedback.** Countdown/overdue badges for staff (customers never see SLA data); a per-minute check flags at-risk and breached tickets once and notifies the right people; in-app bell and email with per-user preferences; star rating after resolution, editable for 24 hours.

**Reports.** Admin dashboard (created/resolved, backlog, first response, resolution time, SLA compliance, CSAT by agent/project/category/month, reopen rate, volume, status mix, FAQ deflection), "My stats" for support, CSV export (formula-safe, row-capped, audit-logged), audit log viewer.

## Testing

```bash
npm test               # server (Jest) + client (Vitest)
npm run test:coverage  # the same with coverage thresholds
npm run lint           # ESLint
npm run format:check   # Prettier
```

At the time of writing: **528 server tests** and **172 client tests**, all passing; statement coverage about 99 % (server) and 97 % (client). Server tests use a separate `supportdesk_test` database on the same Docker Postgres (created and migrated automatically), so development data is never touched. **Do not run two test runs at once**: they share that database.

What the suites prove:

| Suite                                                       | Proves                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `isolation.test.js`, `scope.test.js`                        | A user of one organisation or project cannot read or change another's tickets, messages, attachments, FAQs, notifications, canned replies. |
| `routeMatrix.test.js`                                       | Every registered route rejects anonymous users and the wrong role, and unknown URLs are 404s.                                              |
| `reports.test.js`                                           | Raw-SQL reports are scoped (and fail if the scope condition is removed).                                                                   |
| `auth.test.js`, `hardening.test.js`                         | Token rotation and reuse detection, lockout, CSRF guard, production config rules, log redaction, timeouts.                                 |
| `journey.test.js`                                           | The full register -> approve -> ticket -> reply -> resolve -> rate -> dashboard flow across all three roles.                               |
| `ticketStateMachine.test.js`, `sla.test.js`, `jobs.test.js` | Allowed and forbidden transitions, SLA pause/resume maths, job claims.                                                                     |
| `client/src/test/A11y.test.jsx`                             | axe-core finds no WCAG A/AA violations on the main screens of every role.                                                                  |

## API documentation

The OpenAPI 3.0 document is **generated from the live routes and their Zod schemas**, so it cannot drift: `docs/openapi.json` (regenerate with `npm run docs:openapi`; a test fails if it is stale). While running the API outside production it is also served at `/api/v1/openapi.json` (set `EXPOSE_API_DOCS=true` to serve it in production). Import it into Swagger UI, Postman or Insomnia.

## Security

Summary (details, tests and the Phase 8 review findings: [`docs/SECURITY.md`](docs/SECURITY.md)):

- Central tenant/project isolation, 404 for out-of-scope, proven by tests including a route-matrix test.
- Short-lived JWT, rotating hashed refresh tokens in an httpOnly cookie, CSRF header + Origin check on cookie endpoints, lockout, rate limits.
- Zod validation on every route, escaped search patterns, parameterised SQL, server-side sanitised markdown, upload allow-lists with content sniffing, formula-safe CSV.
- Helmet, CORS allow-list, no-store API responses, log redaction, validated config that refuses insecure production settings.
- No secrets in the repository.

## Accessibility

Target WCAG 2.2 AA. Skip links, route announcements, labelled forms, keyboard-operable dialogs and charts, colour never the only signal, reduced-motion support, an axe test over the main screens, and a mobile navigation menu. What is automated and what still needs a human pass: [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md).

## Production deployment

Short version (everything, including the environment variable table, reverse proxy, backups and scaling: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)):

```bash
cp server/.env.production.example app.env       # fill in secrets, CLIENT_URL, CORS_ORIGINS, SMTP_*
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
docker compose -f docker-compose.prod.example.yml up -d --build
```

- One container serves the API and the web app; it applies migrations on start (`prisma migrate deploy`).
- Put a TLS-terminating reverse proxy in front and set `TRUST_PROXY` to the number of proxies.
- Required: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (different, 32+ chars), an `https://` `CLIENT_URL` and `CORS_ORIGINS`. Configure SMTP or nobody receives email.
- Without Docker: `npm ci && npm run build`, set `CLIENT_DIST` to `client/dist` and the variables above, then `npm start`.
- Health: `GET /api/v1/health` (liveness), `GET /api/v1/health/ready` (readiness, 503 when the database is down).

## Scripts

| Command                                   | Purpose                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| `npm run setup`                           | install, start DB, migrate, seed (first time)          |
| `npm run dev`                             | database + API + web with reload                       |
| `npm test` / `npm run test:coverage`      | all tests / with coverage                              |
| `npm run lint` / `npm run format[:check]` | ESLint / Prettier                                      |
| `npm run build`                           | build the client into `client/dist`                    |
| `npm start`                               | apply migrations, start the API (serves `CLIENT_DIST`) |
| `npm run db:migrate / db:seed / db:reset` | dev migrations / reseed (destructive) / reset          |
| `npm run db:up / db:down`                 | start / stop the development Postgres container        |
| `npm run docs:openapi`                    | regenerate `docs/openapi.json`                         |

## More documentation

- [`CLAUDE.md`](CLAUDE.md): conventions, isolation rules for contributors, per-phase technical notes
- [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md): every default chosen where the brief was open
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md)
- [`docs/openapi.json`](docs/openapi.json): API reference

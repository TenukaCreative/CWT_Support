# Security notes

What protects SupportDesk, where it lives, how it is tested, and what was found and fixed in the Phase 8 review. The server is the only authority: every client-side hint (hidden buttons, role-aware navigation) is cosmetic.

## 1. Tenant isolation (the most important property)

| Layer                  | Where                         | What it guarantees                                                                                                               |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Scope                  | `lib/scope.js` `buildScope()` | Pure function: role + memberships + active project -> the set of project ids this request may touch (`null` = all, `[]` = none). |
| Authentication         | `middleware/auth.js`          | Reloads the user and memberships on **every** request, so deactivation or removal from a project takes effect immediately.       |
| Scoped database client | `lib/scopedDb.js`             | Prisma `$extends` client that ANDs the scope into every read/update/delete on tenant models and checks the project on create.    |
| Raw SQL reports        | `lib/scopeSql.js`             | `reportProjectIds` + `projectCondition` are the isolation boundary for aggregate queries that bypass the Prisma client.          |

Out-of-scope or nonexistent resources both return **404**, never 403, so ids cannot be probed. Customers additionally never receive internal notes, SLA data, or other customers' private fields.

Tests: `tests/isolation.test.js` (cross-organisation and cross-project reads, writes, attachments, FAQ, notifications, canned replies), `tests/scope.test.js`, `tests/reports.test.js` (mutation-checks that removing the SQL condition fails), `tests/routeMatrix.test.js`.

### Route matrix test

`tests/routeMatrix.test.js` walks **every route registered on the Express app** (from the generated route table), and for each one asserts: unauthenticated requests get 401 (or the route is on an explicit public allow-list), a customer cannot call staff or admin routes, support cannot call admin routes, and a customer with no active project cannot reach project routes. A new route that forgets its guard fails this test. A route added to the public list needs a deliberate edit in review.

## 2. Authentication and sessions

- Passwords: bcrypt, byte-length validated (bcrypt silently ignores bytes after 72), minimum strength rules, unknown-user logins take the same time as wrong-password ones, generic error text, lockout with exponential backoff after 5 failures (423). Account status (pending, unverified, deactivated) is revealed only after a correct password.
- Access token: 15-minute JWT (`HS256`, `iss`/`aud` verified) carrying the user id and active project. **The role is read from the database every request, never from the token.** The token lives in memory in the browser (not in localStorage).
- Refresh token: opaque random value, stored only as a SHA-256 hash, in an `httpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `/api/v1/auth`. Rotated on every use; reuse of an already-rotated token revokes the whole token family. Logout and password change/reset revoke sessions.
- CSRF: the cookie endpoints (`/auth/refresh`, `/auth/logout`) require the `X-Requested-With: SupportDesk` header and an allowed `Origin`. Every other endpoint authenticates with the bearer token, which a cross-site request cannot attach.
- Email verification, password reset and invitations use single-use, hashed, expiring tokens (24 h, 1 h, 7 days). Reset and "resend verification" responses do not reveal whether an email exists.
- Rate limits (`middleware/rateLimit.js`): 300 requests/minute per IP overall, 20 per 15 minutes on auth endpoints, 60 per 10 minutes per user on content creation. Set `TRUST_PROXY` correctly or these key on the proxy's address.

## 3. Input, output and content safety

- Every route validates body, query and params with Zod. Unknown fields are stripped, list sorting uses whitelists, `LIKE` search terms are escaped (`escapeLike`; `%` and `_` are literals), SQL is parameterised (the few raw queries use tagged templates; only whitelisted literals go through `Prisma.raw`).
- Ticket and message text is **plain text**; React escapes it. Only staff-authored FAQ articles use markdown, rendered **on the server** and sanitised with DOMPurify (jsdom) using an allow-list: no scripts, images, iframes or event handlers, only `http(s)`/`mailto` links. The client injects only that sanitised string.
- Uploads: extension and MIME allow-list, magic-byte sniffing, size and count limits, random UUID file names, stored outside any statically served path, downloaded only through the authenticated scoped API with `Content-Disposition: attachment` and `nosniff`. Files from failed requests are cleaned up. Multipart file names are decoded and never used as paths.
- CSV export neutralises spreadsheet formulas (cells starting with `= + - @`, tab or CR get a leading `'`), has a row cap, excludes message bodies and internal notes, and is audit-logged.
- Security headers: Helmet defaults (including a strict CSP for the served app), CORS restricted to an explicit allow-list, `Cache-Control: no-store` on `/api`, JSON body limit 1 MB.

## 4. Configuration and operations

- All configuration is validated at boot; production refuses placeholder or identical JWT secrets, non-https `CLIENT_URL` and wildcard CORS (`config/env.js`). No secrets are in the repository; `.env` files are git-ignored and only `*.example` templates are committed.
- Logs scrub `Authorization`, cookies and tokens embedded in URLs. Every response carries `X-Request-Id`; errors never include stack traces to clients.
- Readiness returns 503 when the database is down; server timeouts are set; unhandled errors log and exit for a clean restart; shutdown is graceful.
- Docker image: multi-stage, production dependencies only, non-root user, `tini`, health check.

## 5. Phase 8 review: findings and fixes

| Finding                                                                                          | Resolution                                                             |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `sanitize-html` / old transitive dependency advisories; pinned version was a workaround for Jest | Replaced by DOMPurify + jsdom; `sanitize-html` removed.                |
| `nodemailer` and `node-cron` had advisories in the versions used                                 | Upgraded (`nodemailer` ^10, `node-cron` ^4).                           |
| `LIKE` wildcards (`%`, `_`) in user search terms were interpreted as patterns                    | Escaped everywhere (`escapeLike`), tests added.                        |
| Production could start with placeholder secrets, http URLs or wildcard CORS                      | Boot-time production rules.                                            |
| Verification/reset/invite tokens could appear in request logs (they are in URLs)                 | `redactUrl` in the logger.                                             |
| JWT had no issuer/audience                                                                       | `iss`/`aud` set and verified.                                          |
| Passwords longer than 72 bytes silently truncated by bcrypt                                      | Byte-length validation.                                                |
| Readiness endpoint returned 200 with the database down                                           | Returns 503.                                                           |
| No server timeouts; crashes could leave the process half-alive                                   | Header/request/keep-alive timeouts, crash handlers, graceful shutdown. |
| Nothing proved that every route is guarded                                                       | Generated route table + `routeMatrix` test.                            |
| Root-mounted routers with router-level guards turned unknown URLs into 401                       | Guards are per route; unknown URLs are real 404s (tested).             |

### Accepted / known residual risks

- `npm audit` still reports advisories in the **Prisma CLI's** dev tooling chain and in **dev-only** packages (test runner, bundler, linters). None of them is in the request path of the production container; the CLI is needed at runtime only to run `migrate deploy`. Re-check `npm audit` at each release and upgrade Prisma when a fixed release is available.
- Rate-limit counters are in process memory (per replica). Use a shared store if you need exact global limits.
- Login and logout events are in the application log but not in the in-app audit log (v1 scope).
- There is no antivirus scan on uploads. If customers may upload files that staff open locally, put a scanner (for example ClamAV) behind `attachment.service.js`.
- Email delivery is fire-and-forget (no outbox/retry); failures are logged.
- Access tokens cannot be revoked before they expire (15 minutes) but role, deactivation and membership are re-read every request, so the practical window is zero for those changes.

## 6. Reporting a vulnerability

Put your contact details here before going live (for example a `security@` address) and ask reporters to disclose privately.

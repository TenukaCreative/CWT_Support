# Assumptions & defaults

Decisions made where the brief left room. Change any of these by telling me; most are cheap to flip.

## Data model

- **Priority is a Prisma enum** (`LOW | MEDIUM | HIGH | URGENT`), not a table. The four levels are fixed in the brief, SLA policies and sorting depend on their order, and an enum gives DB-level validity for free. "Manage priorities" in the admin UI therefore means managing the **SLA targets per priority**, not adding new levels.
- **Ticket numbers**: `Project.ticketSeq` is bumped by one atomic `UPDATE ... SET ticketSeq = ticketSeq + 1` inside the creation transaction. The row lock serialises concurrent creators. `Ticket.sequence` + `@@unique([projectId, sequence])` is a second line of defence. Format: `<KEY>-<4-digit padded>`.
- **Project keys are globally unique** (they prefix ticket numbers, and `Ticket.number` is unique).
- **Global rows use `projectId = null`** for Category, FaqCategory, FaqArticle, SlaPolicy. Postgres treats NULLs as distinct in unique indexes, so uniqueness of global SLA rows is enforced in the service layer.
- **`Attachment.ticketId` is always set** (even when it belongs to a message) so access scoping needs just one join: `attachment -> ticket.projectId`.
- **Refresh tokens and email/reset/invite tokens are stored hashed** (SHA-256), never raw. Refresh tokens carry a `familyId` to support rotation with reuse detection.
- **Login lockout** lives on `User` (`failedLoginCount`, `lockedUntil`); IP rate limiting is separate (`express-rate-limit`).
- **Settings table** holds admin-tunable values (reopen window 7d, auto-close 7d, feedback edit window 24h); code defaults apply when a key is absent.
- **FAQ full-text search**: a generated `tsvector` column + GIN index is added by raw SQL in the Phase 4 migration (Prisma cannot declare it).
- **Feedback rating 1-5** is validated by Zod; a DB `CHECK` constraint is added with the Phase 6 migration.

## Auth & security (implemented in Phase 2)

- Passwords hashed with **bcryptjs** (pure JS, bcrypt-compatible, no native build step), cost 12 in prod.
- Access token 15 min (JWT, `activeProjectId` claim); refresh token 14 days in an httpOnly, SameSite=Lax cookie scoped to `/api/v1/auth`. CSRF: the refresh endpoint also requires a custom header + Origin check.
- Dev uses a Vite proxy so browser and API share an origin.
- Domain auto-join is behind `FEATURE_DOMAIN_AUTOJOIN` (default `false`).

## Tooling

- **npm workspaces** (no pnpm/yarn requirement). `npm run dev` starts Postgres (Docker), API (`node --watch`) and Vite together.
- **Tailwind v4** via the Vite plugin (no `tailwind.config.js`; theme tokens live in `client/src/index.css`).
- **React 18** (stable ecosystem) with React Router 6.
- **Prisma 6** (classic `prisma-client-js`).
- Server uses Node's built-in `--env-file` and `--watch`, so no dotenv/nodemon.
- Jest runs ESM natively (`--experimental-vm-modules`), no Babel.
- One root ESLint flat config + Prettier for both packages.
- Postgres host port is **5432**; if you run a local Postgres on that port, change the mapping in `docker-compose.yml` and `DATABASE_URL`.

## Seed data

- All dev accounts share the password `Passw0rd!dev`. Dev only; the seed refuses to run when `NODE_ENV=production`.
- Besides the 4 customers requested, `dave@globex.example` is seeded as a 5th **PENDING** customer so the approval flow (Phase 3) has something to approve. The 4 active customers are Alice (2 projects), Bob, Carol, plus Dave once approved.

## Phase 2 decisions

- **"All projects" for support too.** The brief gives admins an "All projects" option; support also gets one, restricted to their _assigned_ projects, because the staff queue filters across projects. Customers never get it.
- **Picker every login for multi-project users.** `lastProjectId` is highlighted ("Last used") and restored on page refresh, but a fresh login with several projects always shows the picker, as specified.
- **Public organisation list.** `GET /auth/organizations` returns active organisation names/ids so the register form can offer the "pick your organisation" step. This does expose client names to anonymous visitors; the alternative (typed org code or invite-only) is a one-line change if you prefer.
- **Invitations use random, hashed, expiring tokens** (7 days) rather than JWT-signed links: equally unforgeable, but revocable and single-use because they live in the database.
- **Registration with an open invitation** goes live right after email verification; otherwise the account stays PENDING for admin approval (Phase 3 UI). Domain auto-join (flag, default off) activates matching-domain users with all their organisation's projects.
- **Enumeration resistance:** register/forgot/resend always answer the same. A _locked_ account answers 423 (reveals that the account exists, only after 5 failed attempts); accepted trade-off for usable lockout messages.
- **Single-flight refresh on the client** is required (not an optimisation): parallel refreshes with a rotating token look like theft and end the session.
- **Deployment constraint:** the refresh cookie is `SameSite=Lax`, so the web app and API must be same-site (e.g. `app.example.com` + `api.example.com`, or one origin behind a proxy). Noted again in Phase 8 deployment docs.
- **Cost factor:** bcrypt cost 12 in production, 10 in dev, 4 in tests (speed only).

## Phase 3 decisions

- **Admin-created users never get a password from the admin.** The account is created ACTIVE and email-verified, and the user receives a 72-hour single-use link (the password-reset mechanism) to choose their own password.
- **Rejecting a registration deactivates it instead of deleting it.** The audit trail and the "this email was refused" fact are kept; an admin can still reactivate a verified user.
- **Approval requires a verified email** (the Approve button is disabled with a tooltip otherwise), so an admin cannot approve an address nobody proved they own.
- **Archiving an organization archives its active projects**; restoring the organization does not auto-restore projects (explicit, to avoid reopening something archived on purpose).
- **Role or organization change = memberships cleared + sessions revoked.** Old project access was granted for the old role/organization; the user must log in again and is re-assigned explicitly.
- **Project key is immutable** (ticket numbers embed it) and normalised to upper case.
- **No hard deletes in the admin UI** (organizations, projects, users are archived/deactivated); only pending invitations can be revoked (deleted).
- **Last-admin protection** is defence in depth: self-deactivation and self-role-change are already blocked, and the last active admin additionally cannot be demoted or deactivated by any path.
- Admin list endpoints cap `limit` at 100; the member/project pickers load up to 100 options (enough for v1; swap for async search if you expect more).

## Phase 4 decisions

- **Postgres full-text search with the `english` config** (stemming + stop words). Good for English content; other languages would need a per-article language column. No trigram/fuzzy matching, so typos are not corrected (prefix matching on the last word covers as-you-type).
- **Two search modes.** The Help Center search requires every word; the new-ticket "suggestions" use any-word matching so a long, rambling subject line still finds something.
- **Only customers' searches are analytics.** Staff searching do not pollute "what are customers failing to find". Suggestions are not logged unless asked (`log=true`), so typing a ticket subject does not create a row per keystroke; repeats within 60s count once.
- **Votes are one-per-user and changeable** (a `FaqVote` table instead of anonymous counters), customers only.
- **Markdown, rendered and sanitised on the server.** No images or raw HTML in v1 (blocks tracking pixels and layout abuse); links open in a new tab with `noopener nofollow`. Allow images later by adding `img` with an `https` scheme restriction in `lib/markdown.js`.
- **Global (all-project) content is admin-only**, and only while "All projects" is selected, so an admin cannot create global content by accident while looking at one project.
- **Approval flow is an optional admin setting, default off.** When on, support can create and edit drafts (and edit already-published articles) but cannot move an article to Published.
- **Hard delete for articles and categories** (content, not records of activity), with a confirm dialog and an audit entry. Deleting a category keeps its articles.
- **Article listing for staff uses simple `contains` search**, separate from the ranked customer search, so drafts and exact phrases are always findable when managing content.

## Phase 5 decisions

- **Status rules.** Staff move tickets OPEN/IN_PROGRESS/WAITING_ON_CUSTOMER/REOPENED -> (in progress, waiting, resolved) and RESOLVED -> (reopened, closed); staff cannot close an unresolved ticket directly (resolve first) and **CLOSED is terminal for everyone** (to continue, raise a new ticket). Nobody can set a ticket back to OPEN.
- **Customers can reply on any ticket in their project** (they all belong to the same client project) but can only **close/reopen tickets they raised themselves**.
- **Customers cannot reply to a RESOLVED ticket**; they reopen it explicitly (within the configurable window, default 7 days), which is also the "reopened instead of rating" signal Phase 6 needs. A reply to WAITING_ON_CUSTOMER resumes the ticket automatically.
- **A public staff reply on an OPEN/REOPENED ticket moves it to IN_PROGRESS** automatically, and the first one stamps `firstResponseAt`. Internal notes never change status or first-response time.
- **Customers choose LOW/MEDIUM/HIGH**; URGENT is set by staff during triage.
- **Customers see a reduced history** (created, status changes, reopen, merge); assignment and priority/category changes are internal.
- **Ticket text is plain text**, not markdown/HTML, so user content can never inject markup. Only FAQ articles (staff-authored) use markdown.
- **Merge keeps messages where they are** (no copying or moving between tickets); both tickets get a system note. Merging is irreversible in v1.
- **Assignment targets:** active admins and support staff of the ticket's project. Auto-assignment on reply is intentionally not done (assignment is always an explicit action).
- **Uploads on local disk** (`UPLOAD_DIR`). For multi-server production deployments, swap the storage engine in `middleware/upload.js` and `attachment.service.js` for S3-compatible object storage; nothing else depends on the disk path.
- **Saved views are stored in the browser** (localStorage, per user), not on the server. They are a convenience, not shared team data.
- **FAQ deflection loop:** the New ticket form logs the subject as a search once (on "answered my question" or on submit) and attaches it to the ticket via `searchLogId`, so "searches that ended in a ticket" can be reported in Phase 7.
- Notifications (email/in-app) and SLA due dates/pausing are deliberately Phase 6; the code has `TODO(phase 6)` markers at the exact integration points.

## Phase 6 decisions

- **SLA clock = wall-clock hours** from ticket creation (no business-hours calendars in v1), paused only while `WAITING_ON_CUSTOMER`. Per-priority targets with an optional per-project override; "managing priorities" means editing these targets (priority levels themselves are a fixed enum).
- **Warning threshold = last 25% of the target window**, a single constant (`WARNING_FRACTION`). One warning and one breach flag per ticket (`slaWarnedAt`/`slaBreachedAt`); they are cleared when the priority (and so the targets) change. After a breach there are no repeat alerts and no auto-reassignment (flag + notify only, as specified).
- **Reopening restarts nothing:** a reopened ticket keeps its original due dates (it may already be overdue), and `resolvedAt` is cleared so the resolution clock runs again.
- **Who is alerted:** warning -> the assignee, or all project support if unassigned; breach -> additionally every active admin. SLA alerts are always emailed (they are operational, not preferences) and shown in-app unless the person switched in-app off.
- **Notification rules of thumb:** the actor is never notified; a customer's reply goes to the assignee only (an unassigned ticket just sits in the queue); staff replies go to the person who raised the ticket (not every customer of the project); internal notes and unassigned-ticket replies notify nobody.
- **Email preferences** are the four existing toggles; ticket confirmations and SLA alerts bypass the email toggles on purpose.
- **Email delivery is fire-and-forget** after the database commit: a mail failure is logged and never fails or rolls back the ticket action. There is no retry queue in v1 (add an outbox table + worker if you need guaranteed delivery).
- **Auto-close and reopen window are separate settings** (both default 7 days). Once auto-closed a ticket is CLOSED for good, so in practice the effective reopen window ends at whichever comes first.
- **Feedback:** one rating per ticket by its creator; the edit window runs from when the rating was first given, not from resolution. A rating is allowed after auto-close (CLOSED with a `resolvedAt`) but not for tickets closed without ever being resolved, or merged duplicates. A ticket resolved again after a reopen keeps its first rating.
- **Jobs run inside the API process** for simplicity and are guarded by conditional updates so a second instance cannot double-notify. For larger deployments, run the API instances with `JOBS_ENABLED=false` and one dedicated process with it on.
- **Categories** can be deactivated but not deleted (tickets reference them). Name uniqueness is enforced per scope (global or per project), case-insensitively, in the service because NULL project ids are distinct in Postgres unique indexes.

## Phase 7 decisions

- **Dashboards are admin-only; support get "My stats".** Company-wide views (including CSAT by agent) are management information. An admin's numbers follow the project selected in the header ("All projects" or one project), and a project filter inside that scope narrows further.
- **UTC and whole days.** All ranges are UTC calendar days, `from` and `to` inclusive, at most 366 days (default last 30). Charts use daily buckets up to 92 days and weekly (Monday-start) above that. Local-time reporting would need a per-organisation time zone setting.
- **Wall-clock measures.** First response = created -> first public staff reply. Resolution time = created -> resolved **minus time waiting on the customer** (so agents are not penalised for slow customers). Merged duplicates are excluded everywhere (they are not independent work).
- **Cohorts differ on purpose:** first-response and SLA figures describe tickets _created_ in the period; resolution time and the "resolved" count describe tickets _resolved_ in the period; CSAT describes ratings _given_ in the period; "open now" and the status mix are a snapshot of today, independent of the period.
- **SLA compliance only counts verdicts.** A ticket counts as met or missed once its clock decided it (answered/resolved, or overdue while running). Paused tickets, tickets closed without ever being answered and tickets still inside their target are not in the denominator, so the percentage is never inflated or deflated by undecided tickets.
- **A resolved ticket that is reopened is no longer "resolved"** (its `resolvedAt` is cleared), so it drops out of "resolved" and counts again when it is resolved again. The reopen rate is therefore measured with events: reopen events divided by resolution events in the period.
- **CSAT is grouped by the CURRENT assignee/category/project** of the rated ticket, not by who had it at the time. Small samples are shown with their counts rather than hidden.
- **"Deflected" = a customer search where they opened an article and did not go on to raise a ticket.** It is an upper-bound estimate (we cannot know the problem was truly solved), which is why the number of searches that ended in a ticket is shown beside it.
- **Reports are computed live with SQL aggregates** (no pre-aggregation tables). That is fast for tens of thousands of tickets per project; for much larger volumes add daily rollup tables, the API shape would not change.
- **CSV export:** staff only, exactly the tickets the staff member could see in the queue; capped at `EXPORT_MAX_ROWS` (20,000 by default) with a clear error instead of a partial file; never includes message bodies, internal notes or feedback comments (the rating is included); customer name, email and organisation **are** included, which is why every export is written to the audit log. Cells that could be executed as spreadsheet formulas are prefixed with an apostrophe.
- **The audit log is append-only and only shown to admins.** Recorded today: admin actions on organisations, projects, users, invitations, categories, SLA policies and settings, FAQ content changes, and ticket exports. Login/logout events are not audited in v1 (they are in the application log).
- **Charts are hand-built SVG** rather than a charting library: no extra dependency, and the dataviz rules (thin marks, legend, keyboard and table access) are applied directly. The app is light-theme only, so chart colours are defined for light mode.

## Phase 8 decisions

- **One origin in production.** The API serves the built web app (`CLIENT_DIST`), so there is no cross-origin traffic and the refresh cookie (`SameSite=Lax`, `Secure`, path `/api/v1/auth`) stays first-party. Splitting web and API onto different sites would need a deliberate redesign of cookies and CSRF.
- **`TRUST_PROXY` defaults to 0.** Trusting `X-Forwarded-For` by default would let anyone spoof their IP and dodge rate limits; the operator must state how many proxies sit in front.
- **Production refuses to start on unsafe config** (placeholder or identical JWT secrets, non-https client URL, wildcard or non-https CORS origins) rather than warning.
- **API docs are generated, not hand-written**, and hidden in production unless `EXPOSE_API_DOCS=true`. The document is OpenAPI 3.0 so common tools read it.
- **Markdown sanitiser: DOMPurify on jsdom** replaced sanitize-html (advisories; ESM-only dependency chain). Same allow-list policy.
- **Accepted audit findings:** advisories remaining in the Prisma CLI tooling chain and in dev-only packages (they are not in the production request path); revisit at every release (see `docs/SECURITY.md`).
- **Readiness is separate from liveness.** `/health` says the process is up; `/health/ready` returns 503 when the database is unreachable so orchestrators stop routing traffic.
- **Rate-limit counters stay in memory** (per replica). A shared store is the upgrade path for multi-replica deployments that need exact global limits.
- **No built-in first-admin bootstrap.** The seed is for development only; production creates the first admin with a one-off script or SQL, then invites everyone from the UI (documented in `docs/DEPLOYMENT.md`).
- **Mobile navigation collapses to a menu** below the `md` breakpoint; the app was otherwise already responsive. Wide tables scroll inside their own container.
- **Star ratings use shape plus colour** (filled vs outline) so they do not depend on colour alone.
- **Accessibility target is WCAG 2.2 AA**, verified with axe over the main screens plus the manual checks and open items listed in `docs/ACCESSIBILITY.md`; a screen-reader pass is a pre-launch task for a human.
- **Prisma 6 config location.** The `prisma` block in `server/package.json` (seed command) is deprecated and goes away in Prisma 7; move it to a `prisma.config.ts` when upgrading.

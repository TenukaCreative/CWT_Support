# SupportDesk roadmap: v2 (frontend polish, realistic data, ship it)

Phases 1-8 (backend + functional UI) are done; see `CLAUDE.md` "Phase status".
This file is the **shared plan** between every Claude session (claude.ai chat and Claude Code
in the terminal). Rules:

- Work top to bottom. Tick `[x]` when a task is merged; mark `[~]` when half-done.
- When a phase finishes, add a short "Phase N notes" section to `CLAUDE.md` (like Phases 1-8)
  and record design decisions in `docs/ASSUMPTIONS.md`.
- Every session ends with an entry in `docs/SESSION_LOG.md`.
- The strict project rules in `CLAUDE.md` still apply to everything below.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · 🎓 = what you learn in this phase

---

## Phase 0: Housekeeping (before any new work)

- [x] Add `.gitattributes` (`* text=auto eol=lf`) and renormalise. Right now 66 files show as
      "modified" in git only because of Windows CRLF line endings; the only real change is the
      5433 port in `docker-compose.yml`.
- [x] Commit the current state on `main`; from now on, one branch per phase (`phase-9-design-system`, ...).
- [x] Fix `docs/ASSUMPTIONS.md` Tooling note (still says port 5432; local setup uses 5433).
- [x] Confirm `npm test` is green before starting.
- [x] Fix tests on Windows (cross-env + test DB port 5433)
- [ ] Investigate React warning: duplicate key "u8" in AddMembers (ProjectDetailPage.jsx)

🎓 Git line endings on Windows, branching per feature, small focused commits.

## Phase 9: Design system and app shell

Brand: **Creative Web Technologies (CWT)**, from the company site (see ASSUMPTIONS "v2 decisions").
Deep navy + royal blue, light-blue accent, geometric sans (Poppins-style), light/dark toggle.
The logo is supplied later, so the shell needs a logo slot (`client/public/brand/`) with a text fallback.

- [ ] Confirm exact brand hex values and font from the site CSS (estimates in ASSUMPTIONS until then).
- [ ] Design tokens in `index.css` `@theme`: colour scale, semantic colours (success/warning/danger),
      radius, shadow, font (e.g. Inter), spacing rhythm.
- [ ] Dark mode (token-based, `prefers-color-scheme` + manual toggle remembered per user).
      Re-validate chart colours for dark mode.
- [ ] Icon set (`lucide-react`).
- [ ] Component library in `components/ui/`: Button, Input, Select, Textarea, Checkbox, Badge,
      Card, Table, Tabs, Dropdown menu, Avatar, Tooltip, Skeleton, EmptyState, PageHeader.
      Migrate `ui.jsx` helpers into it without breaking existing tests.
- [ ] New app shell: collapsible sidebar with icons + sections, top bar with project switcher,
      search, notifications, user menu (avatar dropdown instead of the raw "Log out" button).
- [ ] Optional: command palette (Ctrl+K) for navigation and ticket lookup.

🎓 Design tokens, building a component library, dark mode, compound components, accessible menus.

## Phase 9b: UI handoff to Claude Code (2026-11-07)

Details and reference code: `docs/design/README.md`.

- [x] Brand tokens, Inter, sidebar icons, public layout, home page, tables, badges, dashboard tiles, avatars
- [ ] Auth pages in a split-screen `AuthLayout`
- [ ] Top bar avatar menu
- [ ] Page headers/spacing: My tickets, New ticket, Help Center
- [ ] Staff queue styling
- [ ] Admin dashboard and list pages
- [ ] Empty/loading states

## Phase 10: Customer experience

- [ ] Public landing / login pages redesigned (replace the dev "System status" box on `HomePage`).
- [ ] Customer dashboard: open tickets, waiting-on-you, recent activity, quick FAQ search.
- [ ] Help Center: search-first layout, categories as cards, article page with "was this helpful".
- [ ] New ticket: stepper or single smart form, inline FAQ suggestions, drag-and-drop attachments.
- [ ] Ticket detail as a conversation (chat-style timeline, status header, rating prompt).

🎓 UX for forms, optimistic updates in TanStack Query, file drag-and-drop, empty/loading states.

## Phase 11: Staff workspace

- [ ] Queue: dense table, saved views as tabs, filter chips, bulk actions bar, SLA indicators.
- [ ] Ticket workspace: split view (conversation + side panel with properties, customer info, history).
- [ ] Keyboard shortcuts (j/k navigate, r reply, a assign, ? help).
- [ ] Composer: canned-reply picker, internal-note mode clearly distinct, attachment previews.
- [ ] "My stats" page redesign.

🎓 Keyboard-driven UI, URL-as-state for filters, prefetching, pagination patterns.

## Phase 12: Admin

- [ ] Admin dashboard: KPI tiles + charts using the redesigned chart components.
- [ ] Users / Organisations / Projects: consistent table + drawer editing pattern.
- [ ] Settings page split into clear sections (Categories, SLA, General).
- [ ] Audit log: readable diff view of metadata.

🎓 Data-dense layouts, drawers vs modals, dashboard design.

## Phase 13: Real CWT data (clients, projects, staff)

Real data = CWT's actual clients, their projects, CWT support staff. It must NEVER be committed
to git or put in `seed.js` (the repo would then contain client data).

- [ ] Collect the data in a template (`data/onboarding/*.example.csv` committed; filled copies gitignored):
      organisations, projects (name, key, client), CWT staff (support/admin), client users.
- [ ] Admin "Import" page or CLI script `npm run import:clients -- file.csv`: Zod-validated, dry-run
      preview first, idempotent (re-running does not duplicate), audited, sends invitations
      (existing invite flow) instead of setting passwords.
- [ ] Keep the demo seed for dev/tests, but rename demo orgs so they can never be confused with real
      clients; make the seed refuse to run against the production DB (it already refuses in production mode).
- [ ] FAQ starter content: real articles per product/project, written with the team.
- [ ] Better demo seed (full conversations, 6 months history) for local dev and screenshots.

🎓 Separating code from data, privacy of client data, import pipelines, idempotency, dry runs.

## Phase 14: Quality

- [ ] Playwright end-to-end tests for the three role journeys (mirrors `journey.test.js` in a real browser).
- [ ] Route-level code splitting (`React.lazy`) + bundle size check.
- [ ] Lighthouse/axe pass on key pages, light and dark.

🎓 E2E testing, performance budgets, accessibility audits.

## Phase 15: Ship (production for real clients)

- [ ] GitHub repo (private) + GitHub Actions CI (lint, server tests with a Postgres service, client tests, build).
- [ ] Hosting that runs Node + Docker (a VPS or a platform like Railway/Render/Fly) + managed Postgres.
      Note: the company site's host (InfinityFree) is PHP-only shared hosting and cannot run this app.
- [ ] Subdomain, e.g. `support.<company domain>`, with HTTPS.
- [ ] Real email (SMTP / transactional provider); verification, invites, resets and notifications depend on it.
- [ ] Automated daily DB backups + a tested restore; attachment storage backed up too.
- [ ] Error monitoring + uptime check; who is on call for the support desk itself.
- [ ] Go-live checklist: production secrets, first admin account, import real data, invite clients.

🎓 CI/CD, environments and secrets, running a real service.

---

## Answered (2026-11-04)

1. Look: CWT's own brand, colours from the company website; logo supplied later.
2. Data: CWT's real clients and projects (imported, never committed).
3. Goal: an internal CWT product that all CWT clients use, so production quality, security and backups matter.

## Open questions

- Exact brand colours/font (site CSS or brand guide) and logo files (SVG preferred).
- Company domain for `support.` subdomain; hosting budget; email provider.
- Who are the first admins/support staff, and which client goes live first (pilot)?

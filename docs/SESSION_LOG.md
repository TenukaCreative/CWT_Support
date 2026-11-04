# Session log

Newest first. One short entry per working session, from any Claude session (chat or Claude Code).
Format: date · where (chat / Claude Code) · what changed · what is half-done · next step.
Read the latest entry + `docs/ROADMAP.md` at the start of every session.

---

## 2026-11-04 (2) · claude.ai chat

- Owner answered the open questions: CWT brand (company website colours, logo later), real CWT clients/projects as data, internal product used by all CWT clients.
- Updated ROADMAP (Phase 9 brand, Phase 13 = real data import, never in git; Phase 15 = production go-live) and ASSUMPTIONS ("v2 decisions", port 5433 fix).
- Half-done: nothing.
- Next: Phase 0 housekeeping. Owner to gather: brand hex/font (or site CSS), logo SVG, list of clients/projects.

## 2026-11-04 · claude.ai chat

- Reviewed the whole repo after Phases 1-8. Client already uses the real API everywhere (no mock data);
  seed has 45 generated tickets with placeholder descriptions.
- Found: 66 files show as modified only due to CRLF line endings; real change is the 5433 port.
- Created `docs/ROADMAP.md` (Phases 0 and 9-15) and this log; added a "Working across sessions" section to `CLAUDE.md`.
- Half-done: nothing.
- Next: Phase 0 housekeeping, then answer open question 1 to start Phase 9 (design system).

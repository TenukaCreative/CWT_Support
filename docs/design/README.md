# SupportDesk UI redesign: design guide

Approved look (the owner confirmed the **login screen is perfect**; same language for everything else).
Four reference mockups live next to this file. Open them in a browser or read the markup for exact
values. They are static HTML mockups, **not app code**: re-create them with the app's React +
Tailwind components, do not copy markup wholesale.

| File | Screen |
| --- | --- |
| `login.dc.html` | Split-screen sign-in (navy brand panel + form) |
| `customer-dashboard.dc.html` | Customer dashboard, top bar with avatar menu |
| `ticket-detail.dc.html` | Ticket conversation + details panel |
| `staff-queue.dc.html` | Staff queue: view tabs, filters, bulk bar, SLA pills |

## Tokens (already in `client/src/index.css`; do not change them)

Brand and neutrals come from the CWT website CSS. `brand-*` and `slate-*` are redefined in `@theme`
(brand-600 `#2563eb`, brand-700 `#194fc7`; slate-900 navy ink `#172840`, slate-200 border `#e3e9f2`,
slate-50 page `#f7f9fc`, slate-500 muted `#5f6e85`). Font: Inter. Shared classes: `.card`, `.btn-primary`,
`.btn-secondary`, `.input`; table helpers `TableWrap/Th/Td/PageHeader` in `components/ui.jsx`.

## Look rules

- Calm navy + white cards, generous spacing, soft shadow (`shadow-[0_4px_20px_rgba(22,53,106,0.05)]`),
  radius: inputs/buttons `rounded-lg`, cards `rounded-xl`, pills `rounded-full`.
- Status/priority/SLA as soft pills with a small coloured dot. Keep internal notes visibly different.
- Icons: `lucide-react` (already installed). Icon-only buttons need `aria-label`; decorative icons `aria-hidden`.
- Text must stay AA contrast (4.5:1). Focus ring on the navy sidebar/headers is **white**
  (`focus-visible:outline-white`) because the default blue ring is invisible on navy.
- Sidebar navy `bg-slate-900`; active link `bg-brand-600 text-white`.
- No dark mode in this push (tokens recorded in `docs/ASSUMPTIONS.md` for later).

## Done in the app already

Brand tokens + Inter, navy sidebar with icons, `BrandLogo` (placeholder "CWT" mark, real logo later in
`client/public/brand/`), branded public layout + real home page, modern tables, status dots, customer dashboard
tiles (`StatTile`), `Avatar`, ticket conversation with avatars.

## To do (the handoff list, in priority order)

1. **Auth pages:** new `client/src/layouts/AuthLayout.jsx` (code below), route the six `publicRoutes`
   (login, register, verify-email, forgot-password, reset-password, accept-invite) through it in `App.jsx`.
   `HomePage` stays in `PublicLayout`. Keep every page heading text unchanged (tests look for the heading "Log in").
2. **Top bar user menu** in `layouts/AppLayout.jsx`: replace "Name (role)" + Log out button with an avatar button
   (uses `components/Avatar.jsx`) opening a small menu: Profile, Log out. Accessible: real `<button>`,
   `aria-expanded`/`aria-haspopup`, closes on Escape and outside click, keyboard reachable.
3. **Page headers/spacing** on the screens clients use most: My tickets list, New ticket, Help Center
   (+ article page). Use the shared `PageHeader`, cards, and `max-w-5xl` content widths.
4. **Staff queue** (`pages/tickets/QueuePage.jsx`): saved views as pill tabs, filter row styling, bulk-actions bar
   styling as in `staff-queue.dc.html` (styling only, keep behaviour).
5. **Admin dashboard + admin list pages:** consistent headers, StatTile row, chart cards.
6. Empty states and loading states: friendly text, use `QueryState` helper.

## Reference code: `AuthLayout.jsx`

```jsx
import { Outlet, useLocation } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import BrandLogo from '../components/BrandLogo.jsx';

const POINTS = [
  'Search the help center before you raise a ticket',
  'Raise and track tickets with our team',
  'Rate the support you received',
];

// Split screen for every sign-in page: brand panel on the left, the form on the right.
// On phones the panel shrinks to just the logo bar.
export default function AuthLayout() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside
        aria-label="About SupportDesk"
        className="flex flex-col justify-between gap-12 bg-slate-900 px-4 py-4 text-white lg:flex-1 lg:p-14"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.09) 1.3px, transparent 1.3px)',
          backgroundSize: '22px 22px',
        }}
      >
        <BrandLogo to="/" />
        <div className="hidden max-w-lg space-y-6 lg:block">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#8ab4ff]">
            CWT client support
          </p>
          <p className="text-5xl font-semibold leading-[1.1] tracking-tight">
            Help when your project needs it.
          </p>
          <p className="text-lg leading-relaxed text-slate-300">
            Search answers, raise tickets and follow them to resolution, all in one place.
          </p>
          <ul className="space-y-3.5 text-slate-100">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-[#8ab4ff]" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-sm text-slate-400 lg:block">
          Creative Web Technologies · Building for the world.
        </p>
      </aside>
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center bg-slate-50 px-6 py-12 focus:outline-none [&_.card]:border-0 [&_.card]:bg-transparent [&_.card]:p-0 [&_.card]:shadow-none [&_h1]:text-3xl [&_h1]:tracking-tight"
      >
        <div className="w-full max-w-sm">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
```

The `[&_.card]` / `[&_h1]` classes restyle the existing `card` wrappers and `h1` of the six auth pages from one
place, so those page files need no edits. In `App.jsx`, `HomePage` stays under `PublicLayout`; the `publicRoutes`
map moves under `<Route element={<AuthLayout />}>`.

# Accessibility

Target: **WCAG 2.2 level AA** for every screen of all three roles. This page records what the app does, how it is checked, and what still needs a human.

## What the app does

- **Structure:** one `<h1>` per page, no skipped heading levels, landmarks (`header`, `nav`, `main`, `aside`), `lang="en"`, a **skip to content** link on both layouts, a descriptive `<title>` per route (`lib/routeTitles.js`).
- **Route changes:** `RouteAnnouncer` moves focus to the page heading and announces the new page in a polite live region, so screen-reader users learn that a client-side navigation happened.
- **Keyboard:** everything is operable without a mouse; visible `:focus-visible` outline everywhere; dialogs use the native `<dialog>` (focus trap, Escape, focus returns to the trigger); the notification bell returns focus when closed; the phone-width menu button exposes `aria-expanded`/`aria-controls`; the star rating is a real radio group (arrow keys); charts can be read with the arrow keys.
- **Forms:** every control has a programmatically associated label; errors are linked with `aria-describedby` (`components/Field.jsx`) and the first invalid field receives focus on submit (React Hook Form default); `autocomplete` hints on credential fields.
- **Status and feedback:** toasts, loading, empty and error states use `role="status"`/`role="alert"` as appropriate; every data region has a loading state, an empty state with the next step, and an error state with Retry (`QueryState`); a React error boundary catches rendering crashes and offers a reload instead of a blank page.
- **Colour:** text uses slate-500 or darker on white (>= 4.5:1; slate-500 is 4.8:1); status badges pair colour with a text label; star ratings differ by **shape** (filled and outline stars) as well as colour, and both clear 3:1; SLA state always has text ("Overdue", "At risk"), never colour alone.
- **Charts:** every chart has a table twin (`<details>`), a legend for two or more series, direct labels, and a keyboard-driven readout in addition to the pointer tooltip; the categorical palette was validated for colour-vision deficiency with the dataviz skill's validator.
- **Motion:** `prefers-reduced-motion` switches animations and smooth scrolling off (`index.css`).
- **Responsive:** checked at 375 px width without horizontal page scrolling (wide tables scroll inside their own container); navigation collapses to a menu on phones.

## How it is checked

1. **Automated, in CI:** `client/src/test/A11y.test.jsx` runs axe-core (WCAG 2.x A/AA rules) over the main screens of the customer, support and admin roles in the states a person actually sees (loaded lists, forms with errors, ticket detail, dashboards, dialogs, 404). jsdom cannot compute colours, so the contrast rule is disabled there and contrast is checked as above.
2. **Component tests** use Testing Library's accessible queries (`getByRole`, `getByLabelText`), so a control without a proper role or label fails its own test.
3. **Manual check in a real browser:** layout at 375 px width on the queue, users, settings, dashboard and audit pages, including the open mobile menu, where an overflow bug was found and fixed (scroll containers are now positioned so visually hidden text cannot widen the page).

## Not covered by automation: please verify before launch

- A full keyboard-only walk of each journey and a screen-reader pass (VoiceOver + Safari, NVDA + Firefox), especially the ticket conversation and the dashboard.
- Browser zoom to 200 % and 400 % on the ticket detail page.
- Windows High Contrast / forced-colors mode (chart texture fills are not implemented; the table twin is the fallback).
- Content you write: FAQ articles are authored markdown; headings, link text and alternative text for any linked media are the author's responsibility (images are stripped by the sanitiser).
- Email templates are plain text.

## Conventions for new UI

Use the shared pieces (`components/ui.jsx`: `Modal`, `ConfirmDialog`, `QueryState`, `Badge`, `Pagination`), give every input a `<label>`, never convey state with colour alone, keep one `<h1>` and sequential headings, register the page in `lib/routeTitles.js`, and add the screen to `A11y.test.jsx`.

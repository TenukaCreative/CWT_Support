import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { titleFor } from '../lib/routeTitles.js';

// Single-page apps do not reload, so by default a screen reader user hears nothing when the page
// changes and keyboard focus stays on the link they clicked. On every navigation (not the first
// load, and not for ?query-only changes such as search text) we: update the document title,
// announce the new screen, and move focus to the main content.
export default function RouteAnnouncer() {
  const { pathname } = useLocation();
  const first = useRef(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const title = titleFor(pathname);
    document.title = `${title} · SupportDesk`;
    if (first.current) {
      first.current = false;
      return;
    }
    setMessage(`Navigated to ${title}`);
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo?.(0, 0);
  }, [pathname]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}

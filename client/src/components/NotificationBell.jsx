import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAdminMutation } from '../lib/useAdminMutation.js';
import { useOpenNotification } from '../lib/useOpenNotification.js';
import { timeAgo } from '../lib/time.js';

// Header bell: unread count (polled + refetched on focus, since v1 has no websockets) and a
// dropdown with the latest notifications.
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const button = useRef(null);
  const qc = useQueryClient();
  const count = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api('/notifications/unread-count'),
    refetchInterval: 30_000,
  });
  const recent = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => api('/notifications?limit=8'),
    enabled: open,
  });
  const openNotification = useOpenNotification(() => setOpen(false));
  const readAll = useAdminMutation(() => api('/notifications/read-all', { method: 'POST' }), {
    invalidate: ['notifications'],
  });
  const unread = count.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus(); // hand focus back to where the menu came from
    };
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        ref={button}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          qc.invalidateQueries({ queryKey: ['notifications', 'recent'] });
        }}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative rounded-md border border-slate-300 bg-white px-2.5 py-1.5 hover:bg-slate-50"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5 fill-none stroke-slate-600"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-semibold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="region"
          aria-label="Recent notifications"
          className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <strong className="text-sm">Notifications</strong>
            <button
              type="button"
              className="text-xs text-brand-700 underline disabled:opacity-50"
              disabled={unread === 0 || readAll.isPending}
              onClick={() => readAll.mutate()}
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {recent.isLoading && <li className="px-3 py-4 text-sm text-slate-500">Loading…</li>}
            {recent.isError && (
              <li role="alert" className="px-3 py-4 text-sm text-red-700">
                Could not load notifications.
              </li>
            )}
            {recent.data?.items.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-slate-500">
                You are all caught up.
              </li>
            )}
            {recent.data?.items.map((n) => (
              <li key={n.id} className="border-b border-slate-50 last:border-0">
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${n.readAt ? '' : 'bg-brand-50'}`}
                >
                  <span className="flex items-start gap-2">
                    {!n.readAt && (
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600"
                        aria-label="Unread"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block font-medium">{n.title}</span>
                      {n.body && (
                        <span className="block truncate text-xs text-slate-600">{n.body}</span>
                      )}
                      <span className="block text-xs text-slate-500">{timeAgo(n.createdAt)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-100 px-3 py-2 text-center">
            <Link
              to="/app/notifications"
              onClick={() => setOpen(false)}
              className="text-sm text-brand-700 underline"
            >
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

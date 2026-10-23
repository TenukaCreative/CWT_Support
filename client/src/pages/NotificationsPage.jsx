import { useState } from 'react';
import { api } from '../api/client.js';
import { useAdminMutation } from '../lib/useAdminMutation.js';
import { useList } from '../lib/query.js';
import { useOpenNotification } from '../lib/useOpenNotification.js';
import { fmtDateTime } from '../lib/tickets.js';
import { PageHeader, Pagination, QueryState } from '../components/ui.jsx';

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const list = useList('notifications', '/notifications', {
    unread: unreadOnly ? 'true' : undefined,
    page,
    limit: 20,
  });
  const open = useOpenNotification();
  const readAll = useAdminMutation(() => api('/notifications/read-all', { method: 'POST' }), {
    invalidate: ['notifications'],
    success: 'All notifications marked as read',
  });

  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" subtitle="What happened on your tickets.">
        <button
          type="button"
          className="btn-secondary"
          disabled={readAll.isPending}
          onClick={() => readAll.mutate()}
        >
          Mark all read
        </button>
      </PageHeader>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={(e) => {
            setUnreadOnly(e.target.checked);
            setPage(1);
          }}
        />{' '}
        Unread only
      </label>
      <QueryState
        query={list}
        emptyText={unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}
      >
        {(data) => (
          <>
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${n.readAt ? '' : 'bg-brand-50'}`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{n.title}</span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {fmtDateTime(n.createdAt)}
                      </span>
                    </span>
                    {n.body && (
                      <span className="mt-1 block whitespace-pre-wrap text-sm text-slate-600">
                        {n.body}
                      </span>
                    )}
                    {!n.readAt && (
                      <span className="mt-1 inline-block text-xs font-medium text-brand-700">
                        Unread
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <Pagination data={data} onPage={setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import { PRIORITY_LABELS, STATUS_LABELS } from '../../lib/tickets.js';
import Alert from '../../components/Alert.jsx';
import { Modal } from '../../components/ui.jsx';
import { qs, useDebounced } from '../../lib/query.js';
import { StatusBadge } from '../../components/TicketBadges.jsx';

// One audited API call per change; refreshes the ticket and the lists afterwards.
function useTicketAction(ticketId, path, message, method = 'POST') {
  return useAdminMutation((body) => api(`/tickets/${ticketId}${path}`, { method, body }), {
    invalidate: ['ticket', 'tickets'],
    success: message,
  });
}

// Triage controls for staff: status (only the moves the server allows), priority, category,
// assignee, merge. Every change is a separate, audited API call.
export default function StaffControls({ ticket }) {
  const { user } = useAuth();
  const [merging, setMerging] = useState(false);
  const closed = ticket.status === 'CLOSED';
  const assignees = useQuery({
    queryKey: ['assignees', ticket.project.id],
    queryFn: () => api(`/tickets/assignees?projectId=${ticket.project.id}`),
  });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const categories = (cats.data?.categories ?? []).filter(
    (c) => c.projectId === null || c.projectId === ticket.project.id,
  );

  const status = useTicketAction(ticket.id, '/status', 'Status updated');
  const details = useTicketAction(ticket.id, '', 'Ticket updated', 'PATCH');
  const assign = useTicketAction(ticket.id, '/assign', 'Assignee updated');

  return (
    <section aria-label="Staff controls" className="card space-y-4 text-sm">
      <h2 className="font-medium">Manage</h2>

      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
          Status
        </span>
        <select
          className="input"
          value={ticket.status}
          disabled={closed || status.isPending}
          onChange={(e) => status.mutate({ status: e.target.value })}
          aria-label="Status"
        >
          <option value={ticket.status}>{STATUS_LABELS[ticket.status]}</option>
          {ticket.allowedStatuses.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
          Priority
        </span>
        <select
          className="input"
          value={ticket.priority}
          disabled={closed || details.isPending}
          onChange={(e) => details.mutate({ priority: e.target.value })}
          aria-label="Priority"
        >
          {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
          Category
        </span>
        <select
          className="input"
          value={ticket.category?.id ?? ''}
          disabled={closed || details.isPending}
          onChange={(e) => details.mutate({ categoryId: e.target.value || null })}
          aria-label="Category"
        >
          <option value="">None</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Assignee
          </span>
          <select
            className="input"
            value={ticket.assignee?.id ?? ''}
            disabled={closed || assign.isPending}
            onChange={(e) => assign.mutate({ assigneeId: e.target.value || null })}
            aria-label="Assignee"
          >
            <option value="">Unassigned</option>
            {assignees.data?.assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.id === user.id ? ' (me)' : ''}
              </option>
            ))}
          </select>
        </label>
        {!closed &&
          ticket.assignee?.id !== user.id &&
          assignees.data?.assignees.some((a) => a.id === user.id) && (
            <button
              type="button"
              className="mt-2 text-xs text-brand-700 underline"
              onClick={() => assign.mutate({ assigneeId: user.id })}
            >
              Assign to me
            </button>
          )}
      </div>

      <button
        type="button"
        className="btn-secondary w-full"
        disabled={closed}
        onClick={() => setMerging(true)}
      >
        Merge into another ticket…
      </button>
      {merging && <MergeModal ticket={ticket} onClose={() => setMerging(false)} />}
    </section>
  );
}

function MergeModal({ ticket, onClose }) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState(null);
  const q = useDebounced(text.trim());
  const results = useQuery({
    queryKey: ['merge-search', ticket.project.id, q],
    queryFn: () =>
      api(
        `/tickets${qs({ q, projectId: ticket.project.id, status: 'OPEN,IN_PROGRESS,WAITING_ON_CUSTOMER,REOPENED,RESOLVED', limit: 8 })}`,
      ),
    enabled: q.length >= 2,
  });
  const merge = useAdminMutation(
    (id) => api(`/tickets/${ticket.id}/merge`, { method: 'POST', body: { targetTicketId: id } }),
    {
      invalidate: ['ticket', 'tickets'],
      success: 'Tickets merged',
      onSuccess: onClose,
    },
  );
  const candidates = results.data?.items.filter((t) => t.id !== ticket.id) ?? [];

  return (
    <Modal title={`Merge ${ticket.number}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        This ticket will be closed and point to the ticket you choose. Both customers see a note
        about the merge. This cannot be undone.
      </p>
      <label className="block text-sm font-medium text-slate-700">
        Find the ticket to keep
        <input
          className="input mt-1"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setTarget(null);
          }}
          placeholder="Ticket number or subject"
        />
      </label>
      <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto" aria-label="Matching tickets">
        {results.isLoading && q.length >= 2 && (
          <li className="text-sm text-slate-500">Searching…</li>
        )}
        {q.length >= 2 && results.data && candidates.length === 0 && (
          <li className="text-sm text-slate-500">No other tickets in this project match.</li>
        )}
        {candidates.map((t) => (
          <li key={t.id}>
            <label
              className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1 text-sm ${target === t.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}
            >
              <input
                type="radio"
                name="merge-target"
                checked={target === t.id}
                onChange={() => setTarget(t.id)}
              />
              <span className="font-mono text-xs">{t.number}</span>
              <span className="flex-1 truncate">{t.subject}</span>
              <StatusBadge status={t.status} />
            </label>
          </li>
        ))}
      </ul>
      {merge.isError && (
        <div className="mt-3">
          <Alert type="error">{merge.error.message}</Alert>
        </div>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
          disabled={!target || merge.isPending}
          onClick={() => merge.mutate(target)}
        >
          Merge tickets
        </button>
      </div>
    </Modal>
  );
}

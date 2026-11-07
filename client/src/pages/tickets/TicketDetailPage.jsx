import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import { PRIORITY_LABELS, STATUS_LABELS, describeEvent, fmtDateTime } from '../../lib/tickets.js';
import Alert from '../../components/Alert.jsx';
import AttachmentList from '../../components/AttachmentList.jsx';
import { PriorityBadge, StatusBadge } from '../../components/TicketBadges.jsx';
import { ConfirmDialog } from '../../components/ui.jsx';
import Composer from './Composer.jsx';
import StaffControls from './StaffControls.jsx';
import FeedbackPanel from './FeedbackPanel.jsx';
import { SlaPanel } from '../../components/SlaBadge.jsx';
import { Stars } from '../../components/Stars.jsx';
import { ArrowLeft } from 'lucide-react';
import Avatar from '../../components/Avatar.jsx';

const ROLE_LABEL = { ADMIN: 'Admin', SUPPORT: 'Support', CUSTOMER: 'Customer' };

export default function TicketDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState('conversation');
  const [confirm, setConfirm] = useState(null); // 'CLOSED' | 'REOPENED'
  const staff = user.role !== 'CUSTOMER';

  // No websockets in v1: refetch on focus (global default) plus a gentle poll while the page is open.
  const q = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api(`/tickets/${id}`),
    refetchInterval: 30_000,
  });
  const change = useAdminMutation(
    (status) => api(`/tickets/${id}/status`, { method: 'POST', body: { status } }),
    {
      invalidate: ['ticket', 'tickets'],
      success: (r) => `Ticket ${STATUS_LABELS[r.ticket.status].toLowerCase()}`,
      onSuccess: () => setConfirm(null),
    },
  );

  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) {
    return (
      <div className="max-w-2xl space-y-3">
        <Alert type="error">
          {q.error.status === 404
            ? 'This ticket does not exist or is not available to you.'
            : q.error.message}
        </Alert>
        <Link
          to={staff ? '/app/queue' : '/app/tickets'}
          className="text-sm text-brand-700 underline"
        >
          ← Back to tickets
        </Link>
      </div>
    );
  }
  const { ticket, messages, events } = q.data;
  const canClose = !staff && ticket.allowedStatuses.includes('CLOSED');
  const canReopen = !staff && ticket.allowedStatuses.includes('REOPENED');

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-4">
        <div>
          <Link
            to={staff ? '/app/queue' : '/app/tickets'}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Tickets
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            <span className="mr-2 font-mono text-base text-slate-500">{ticket.number}</span>
            {ticket.subject}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            {ticket.mergedInto && (
              <Link
                to={`/app/tickets/${ticket.mergedInto.id}`}
                className="text-sm text-brand-700 underline"
              >
                Merged into {ticket.mergedInto.number}
              </Link>
            )}
          </p>
        </div>

        {!staff && ticket.status === 'RESOLVED' && (
          <Alert type="success">
            This ticket was marked resolved.
            {canReopen
              ? ` Not fixed? You can reopen it until ${fmtDateTime(ticket.reopenUntil)}.`
              : ' The reopening period has ended; please raise a new ticket if you still need help.'}
          </Alert>
        )}

        <div
          role="tablist"
          aria-label="Ticket sections"
          className="flex gap-1 border-b border-slate-200"
        >
          {[
            ['conversation', 'Conversation'],
            ['history', `History (${events.length})`],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              id={`t-${key}`}
              type="button"
              aria-selected={tab === key}
              aria-controls={`p-${key}`}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === key ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'conversation' ? (
          <div
            role="tabpanel"
            id="p-conversation"
            aria-labelledby="t-conversation"
            className="space-y-4"
          >
            <ol className="space-y-3" aria-label="Messages">
              {messages.map((m) => (
                <Message key={m.id} m={m} />
              ))}
            </ol>
            {!staff && <FeedbackPanel ticket={ticket} />}
            <Composer ticket={ticket} />
          </div>
        ) : (
          <div role="tabpanel" id="p-history" aria-labelledby="t-history">
            <ol className="space-y-2" aria-label="Ticket history">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline gap-x-3 rounded border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <span className="font-medium">{describeEvent(e)}</span>
                  <span className="text-xs text-slate-500">
                    {e.actor ? `${e.actor.name} · ` : ''}
                    {fmtDateTime(e.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <aside aria-label="Ticket details" className="space-y-4">
        <dl className="card space-y-3 text-sm">
          <Row label="Project">
            {ticket.project.name}{' '}
            <span className="font-mono text-xs text-slate-500">({ticket.project.key})</span>
          </Row>
          <Row label="Raised by">
            {ticket.createdBy.name}
            {staff && (
              <span className="block text-xs text-slate-500">
                {ticket.createdBy.email}
                {ticket.createdBy.organization ? ` · ${ticket.createdBy.organization.name}` : ''}
              </span>
            )}
          </Row>
          <Row label="Assignee">
            {ticket.assignee?.name ?? <span className="text-slate-500">Unassigned</span>}
          </Row>
          <Row label="Category">{ticket.category?.name ?? '—'}</Row>
          <Row label="Priority">{PRIORITY_LABELS[ticket.priority]}</Row>
          <Row label="Created">{fmtDateTime(ticket.createdAt)}</Row>
          {ticket.firstResponseAt && staff && (
            <Row label="First response">{fmtDateTime(ticket.firstResponseAt)}</Row>
          )}
          {ticket.resolvedAt && <Row label="Resolved">{fmtDateTime(ticket.resolvedAt)}</Row>}
        </dl>

        {staff && <SlaPanel sla={ticket.sla} />}
        {staff && ['RESOLVED', 'CLOSED'].includes(ticket.status) && (
          <section aria-label="Customer feedback" className="card space-y-1 text-sm">
            <h2 className="font-medium">Customer feedback</h2>
            {ticket.feedback ? (
              <>
                <Stars value={ticket.feedback.rating} />
                {ticket.feedback.comment && (
                  <p className="whitespace-pre-wrap">{ticket.feedback.comment}</p>
                )}
              </>
            ) : (
              <p className="text-slate-500">No rating yet.</p>
            )}
          </section>
        )}
        {staff && <StaffControls ticket={ticket} />}

        {(canClose || canReopen) && (
          <div className="card space-y-2">
            {canReopen && (
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => setConfirm('REOPENED')}
              >
                Reopen ticket
              </button>
            )}
            {canClose && (
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => setConfirm('CLOSED')}
              >
                Close ticket
              </button>
            )}
          </div>
        )}
      </aside>

      {confirm && (
        <ConfirmDialog
          title={confirm === 'CLOSED' ? 'Close this ticket?' : 'Reopen this ticket?'}
          confirmLabel={confirm === 'CLOSED' ? 'Close ticket' : 'Reopen'}
          danger={confirm === 'CLOSED'}
          busy={change.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => change.mutate(confirm)}
        >
          {confirm === 'CLOSED'
            ? 'A closed ticket cannot be reopened. Raise a new ticket if the problem comes back.'
            : 'Our team will be notified and pick it up again.'}
        </ConfirmDialog>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Message({ m }) {
  if (m.type === 'SYSTEM') {
    return (
      <li className="text-center text-xs text-slate-500">
        {m.body} · {fmtDateTime(m.createdAt)}
      </li>
    );
  }
  const note = m.type === 'INTERNAL_NOTE';
  const fromCustomer = m.author?.role === 'CUSTOMER';
  return (
    <li className="flex gap-3">
      <Avatar name={m.author?.name ?? 'System'} />
      <div
        className={`min-w-0 flex-1 rounded-xl border p-4 ${note ? 'border-amber-300 bg-amber-50' : fromCustomer ? 'border-slate-200 bg-white' : 'border-brand-100 bg-brand-50'}`}
      >
        <div className="mb-2 flex flex-wrap items-baseline gap-2 text-sm">
          <strong>{m.author?.name ?? 'System'}</strong>
          {m.author && <span className="text-xs text-slate-500">{ROLE_LABEL[m.author.role]}</span>}
          {note && (
            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-900">
              Internal note · not visible to the customer
            </span>
          )}
          <span className="ml-auto text-xs text-slate-500">{fmtDateTime(m.createdAt)}</span>
        </div>
        {/* Plain text on purpose: React escapes it, whitespace is preserved. No HTML from users. */}
        <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
        <AttachmentList attachments={m.attachments} />
      </div>
    </li>
  );
}

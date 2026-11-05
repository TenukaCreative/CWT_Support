import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Link } from 'react-router-dom';
import { useList } from '../lib/query.js';
import { ACTIVE_STATUSES } from '../lib/tickets.js';
import { StatusBadge } from '../components/TicketBadges.jsx';
import StatTile from '../components/StatTile.jsx';

// /app lands each role on its own home.
export default function RoleHome() {
  const { user, projects, activeProjectId } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  if (user.role === 'ADMIN') return <Navigate to="/app/admin" replace />;
  if (user.role === 'SUPPORT') return <Navigate to="/app/queue" replace />;
  const project = projects.find((p) => p.id === activeProjectId);
  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">
        {project ? `Welcome to ${project.name}` : 'Dashboard'}
      </h1>
      <Tiles />
      <form
        role="search"
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(q.trim() ? `/app/faq?q=${encodeURIComponent(q.trim())}` : '/app/faq');
        }}
      >
        <label htmlFor="quick-search" className="font-medium">
          How can we help?
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="quick-search"
            type="search"
            className="input"
            placeholder="Search the help center…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            Search
          </button>
        </div>
      </form>
      <OpenTickets />
    </div>
  );
}

function OpenTickets() {
  const q = useList('tickets', '/tickets', {
    status: ACTIVE_STATUSES,
    mine: 'true',
    limit: 5,
    sort: 'updatedAt',
    dir: 'desc',
  });
  return (
    <section aria-labelledby="open-h">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="open-h" className="text-lg font-semibold">
          Your open tickets
        </h2>
        <Link to="/app/tickets/new" className="btn-primary">
          New ticket
        </Link>
      </div>
      {q.isLoading && (
        <p role="status" className="text-slate-500">
          Loading…
        </p>
      )}
      {q.isError && (
        <p role="alert" className="text-red-700">
          {q.error.message}
        </p>
      )}
      {q.data?.items.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-slate-500">
          You have no open tickets.
        </p>
      )}
      {q.data?.items.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {q.data.items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="font-mono text-xs text-slate-500">{t.number}</span>
              <Link
                to={`/app/tickets/${t.id}`}
                className="flex-1 font-medium text-brand-700 hover:underline"
              >
                {t.subject}
              </Link>
              <StatusBadge status={t.status} />
            </li>
          ))}
        </ul>
      )}
      {q.data && q.data.total > 5 && (
        <Link to="/app/tickets" className="mt-2 inline-block text-sm text-brand-700 underline">
          View all {q.data.total}
        </Link>
      )}
    </section>
  );
}

// limit: 1 because we only want the total, not the rows.
function useTotal(status) {
  const q = useList('tickets', '/tickets', { status, mine: 'true', limit: 1 });
  return q.data?.total;
}

function Tiles() {
  const open = useTotal('OPEN,IN_PROGRESS,REOPENED');
  const waiting = useTotal('WAITING_ON_CUSTOMER');
  const done = useTotal('RESOLVED,CLOSED');
  return (
    <section aria-label="Ticket summary" className="grid gap-4 sm:grid-cols-3">
      <StatTile label="Open" value={open} to="/app/tickets" />
      <StatTile label="Waiting on you" value={waiting} to="/app/tickets" attention={waiting > 0} />
      <StatTile label="Resolved" value={done} to="/app/tickets" />
    </section>
  );
}

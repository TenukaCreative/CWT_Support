import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import { useDebounced, useList } from '../../lib/query.js';
import { ACTIVE_STATUSES } from '../../lib/tickets.js';
import { useExportTickets } from '../../lib/useExport.js';
import {
  FilterBar,
  FilterField,
  PageHeader,
  Pagination,
  QueryState,
} from '../../components/ui.jsx';
import TicketTable from './TicketTable.jsx';

const STATUS_FILTERS = [
  [ACTIVE_STATUSES, 'Active'],
  ['', 'All'],
  ['OPEN', 'Open'],
  ['IN_PROGRESS', 'In progress'],
  ['WAITING_ON_CUSTOMER', 'Waiting on customer'],
  ['REOPENED', 'Reopened'],
  ['RESOLVED', 'Resolved'],
  ['CLOSED', 'Closed'],
];
const DEFAULTS = {
  q: '',
  status: ACTIVE_STATUSES,
  priority: '',
  categoryId: '',
  assigneeId: '',
  projectId: '',
  sort: 'updatedAt',
  dir: 'desc',
};

// Saved views = named filter presets, stored per user in this browser.
const loadViews = (userId) => {
  try {
    return JSON.parse(localStorage.getItem(`sd:views:${userId}`)) ?? [];
  } catch {
    return [];
  }
};
const storeViews = (userId, views) => {
  try {
    localStorage.setItem(`sd:views:${userId}`, JSON.stringify(views));
  } catch {
    /* storage unavailable: views just will not persist */
  }
};

// `preset` lets "My assigned tickets" reuse the queue with assignee = me.
export default function QueuePage({
  preset = {},
  title = 'Ticket queue',
  subtitle = 'Work the tickets of your projects.',
}) {
  const { user, projects, activeProjectId } = useAuth();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ ...DEFAULTS, ...preset });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [views, setViews] = useState(() => loadViews(user.id));
  const [viewName, setViewName] = useState('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const search = useDebounced(filters.q);
  const exporter = useExportTickets();
  // The export uses exactly the filters on screen (not paging or sorting).
  const exportParams = {
    q: filters.q,
    status: filters.status,
    priority: filters.priority,
    categoryId: filters.categoryId,
    assigneeId: filters.assigneeId,
    projectId: filters.projectId,
  };
  const singleProject = activeProjectId && activeProjectId !== 'ALL' ? activeProjectId : null;

  const list = useList('tickets', '/tickets', { ...filters, q: search, page, limit: 20 });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const staff = useQuery({
    queryKey: ['assignees', singleProject],
    queryFn: () => api(`/tickets/assignees?projectId=${singleProject}`),
    enabled: Boolean(singleProject),
  });

  useEffect(() => setSelected([]), [list.data]); // selection never outlives the page it was made on

  const set = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };
  const apply = (f) => {
    setFilters({ ...DEFAULTS, ...f });
    setPage(1);
  };
  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const next = [...views.filter((v) => v.name !== name), { name, filters }];
    setViews(next);
    storeViews(user.id, next);
    setViewName('');
  };
  const deleteView = (name) => {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    storeViews(user.id, next);
  };

  const bulk = useAdminMutation(
    (assigneeId) =>
      api('/tickets/bulk-assign', { method: 'POST', body: { ticketIds: selected, assigneeId } }),
    {
      invalidate: ['tickets'],
      success: (r) => `${r.updated} ticket(s) updated`,
      onSuccess: () => {
        setSelected([]);
        qc.invalidateQueries({ queryKey: ['ticket'] });
      },
    },
  );
  const runBulk = () =>
    bulk.mutate(
      bulkAssignee === 'unassigned' ? null : bulkAssignee === 'me' ? user.id : bulkAssignee,
    );

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle}>
        <button
          type="button"
          className="btn-secondary"
          disabled={exporter.busy}
          onClick={() => exporter.run(exportParams)}
        >
          {exporter.busy ? 'Exporting…' : 'Export CSV'}
        </button>
      </PageHeader>

      {views.length > 0 && (
        <div
          className="mb-3 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Saved views"
        >
          <span className="text-xs font-medium text-slate-600">Saved views:</span>
          {views.map((v) => (
            <span
              key={v.name}
              className="inline-flex items-center rounded-full border border-slate-300 bg-white text-sm"
            >
              <button
                type="button"
                className="px-3 py-1 hover:underline"
                onClick={() => apply(v.filters)}
              >
                {v.name}
              </button>
              <button
                type="button"
                className="pr-2 text-slate-500 hover:text-red-700"
                aria-label={`Delete view ${v.name}`}
                onClick={() => deleteView(v.name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <FilterBar>
        <FilterField label="Search">
          <input
            className="input"
            value={filters.q}
            onChange={set('q')}
            placeholder="Number or subject"
          />
        </FilterField>
        <FilterField label="Status">
          <select className="input" value={filters.status} onChange={set('status')}>
            {STATUS_FILTERS.map(([v, l]) => (
              <option key={l} value={v}>
                {l}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Priority">
          <select className="input" value={filters.priority} onChange={set('priority')}>
            <option value="">Any</option>
            {['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((p) => (
              <option key={p} value={p}>
                {p.charAt(0) + p.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Category">
          <select className="input" value={filters.categoryId} onChange={set('categoryId')}>
            <option value="">Any</option>
            {cats.data?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Assignee">
          <select className="input" value={filters.assigneeId} onChange={set('assigneeId')}>
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned</option>
            {staff.data?.assignees
              .filter((a) => a.id !== user.id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </FilterField>
        {projects.length > 1 && (
          <FilterField label="Project">
            <select className="input" value={filters.projectId} onChange={set('projectId')}>
              <option value="">All in view</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key}
                </option>
              ))}
            </select>
          </FilterField>
        )}
        <FilterField label="Sort by">
          <select
            className="input"
            value={`${filters.sort}:${filters.dir}`}
            onChange={(e) => {
              const [sort, dir] = e.target.value.split(':');
              setFilters((f) => ({ ...f, sort, dir }));
            }}
          >
            <option value="updatedAt:desc">Recently updated</option>
            <option value="createdAt:desc">Newest</option>
            <option value="createdAt:asc">Oldest</option>
            <option value="priority:desc">Priority (urgent first)</option>
            <option value="number:asc">Ticket number</option>
          </select>
        </FilterField>
      </FilterBar>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="sr-only">Name for this view</span>
          <input
            className="input w-44"
            placeholder="Name this view…"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn-secondary"
          disabled={!viewName.trim()}
          onClick={saveView}
        >
          Save view
        </button>
        <button type="button" className="btn-secondary" onClick={() => apply(preset)}>
          Reset filters
        </button>
      </div>

      {selected.length > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-sm"
        >
          <strong>{selected.length} selected</strong>
          <label className="flex items-center gap-2">
            <span>Assign to</span>
            <select
              className="input w-48"
              value={bulkAssignee}
              onChange={(e) => setBulkAssignee(e.target.value)}
            >
              <option value="">Choose…</option>
              <option value="me">Me</option>
              <option value="unassigned">Nobody (unassign)</option>
              {staff.data?.assignees
                .filter((a) => a.id !== user.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={!bulkAssignee || bulk.isPending}
            onClick={runBulk}
          >
            Apply
          </button>
          <button type="button" className="btn-secondary" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      )}

      <QueryState query={list} emptyText="No tickets match these filters.">
        {(data) => (
          <>
            <TicketTable
              items={data.items}
              staff
              selectable
              selected={selected}
              onToggle={(id) =>
                setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
              }
              onToggleAll={(on) => setSelected(on ? data.items.map((t) => t.id) : [])}
            />
            <Pagination data={data} onPage={setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}

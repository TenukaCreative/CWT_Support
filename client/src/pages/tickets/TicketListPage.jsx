import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDebounced, useList } from '../../lib/query.js';
import { ACTIVE_STATUSES } from '../../lib/tickets.js';
import {
  FilterBar,
  FilterField,
  PageHeader,
  Pagination,
  QueryState,
} from '../../components/ui.jsx';
import TicketTable from './TicketTable.jsx';

const GROUPS = [
  ['', 'All'],
  [ACTIVE_STATUSES, 'Open'],
  ['RESOLVED', 'Resolved'],
  ['CLOSED', 'Closed'],
];

// Customer view: tickets of the active project.
export default function TicketListPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(ACTIVE_STATUSES);
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  const list = useList('tickets', '/tickets', {
    q: search,
    status,
    mine: mine ? 'true' : undefined,
    page,
    limit: 15,
    sort: 'updatedAt',
    dir: 'desc',
  });
  const reset = (set) => (e) => {
    set(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    setPage(1);
  };

  return (
    <div>
      <PageHeader title="Tickets" subtitle="Everything raised for this project.">
        <Link to="/app/tickets/new" className="btn-primary">
          New ticket
        </Link>
      </PageHeader>
      <FilterBar>
        <FilterField label="Search">
          <input
            className="input"
            value={q}
            onChange={reset(setQ)}
            placeholder="Number or subject"
          />
        </FilterField>
        <FilterField label="Show">
          <select className="input" value={status} onChange={reset(setStatus)}>
            {GROUPS.map(([value, label]) => (
              <option key={label} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FilterField>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={mine} onChange={reset(setMine)} /> Only tickets I raised
        </label>
      </FilterBar>
      <QueryState query={list} emptyText="No tickets match. Raise a new one if you need help.">
        {(data) => (
          <>
            <TicketTable items={data.items} />
            <Pagination data={data} onPage={setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}

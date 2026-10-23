import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useDebounced, useList } from '../../lib/query.js';
import { fmtDateTime } from '../../lib/tickets.js';
import {
  FilterBar,
  FilterField,
  PageHeader,
  Pagination,
  QueryState,
  TableWrap,
  Td,
  Th,
} from '../../components/ui.jsx';

const EMPTY = { action: '', actorId: '', entity: '', from: '', to: '', q: '' };

// Read-only trail of who did what. Metadata is shown as JSON text (never as HTML).
export default function AuditLogPage() {
  const [f, setF] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const q = useDebounced(f.q);
  const options = useQuery({
    queryKey: ['audit-filters'],
    queryFn: () => api('/admin/audit-logs/filters'),
    staleTime: 60_000,
  });
  const rangeBad = f.from && f.to && f.from > f.to;
  const list = useList('audit', '/admin/audit-logs', {
    ...f,
    q,
    from: rangeBad ? undefined : f.from,
    to: rangeBad ? undefined : f.to,
    page,
    limit: 25,
  });
  const set = (key) => (e) => {
    setF((x) => ({ ...x, [key]: e.target.value }));
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Administrative and security-relevant actions. Entries cannot be edited or deleted."
      />
      <FilterBar>
        <FilterField label="Action">
          <select className="input" value={f.action} onChange={set('action')}>
            <option value="">Any</option>
            {options.data?.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Actor">
          <select className="input" value={f.actorId} onChange={set('actorId')}>
            <option value="">Anyone</option>
            {options.data?.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Entity">
          <select className="input" value={f.entity} onChange={set('entity')}>
            <option value="">Any</option>
            {options.data?.entities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="From">
          <input type="date" className="input" value={f.from} onChange={set('from')} />
        </FilterField>
        <FilterField label="To">
          <input type="date" className="input" value={f.to} onChange={set('to')} />
        </FilterField>
        <FilterField label="Search">
          <input
            className="input"
            value={f.q}
            onChange={set('q')}
            placeholder="Action, entity or id"
          />
        </FilterField>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setF(EMPTY);
            setPage(1);
          }}
        >
          Reset
        </button>
      </FilterBar>
      {rangeBad && (
        <p role="alert" className="mb-3 text-xs text-red-700">
          The start date is after the end date.
        </p>
      )}

      <QueryState query={list} emptyText="No audit entries match these filters.">
        {(data) => (
          <>
            <TableWrap label="Audit log">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Details</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap">
                      <time dateTime={l.createdAt} title={l.createdAt}>
                        {fmtDateTime(l.createdAt)}
                      </time>
                    </Td>
                    <Td>
                      {l.actor ? (
                        <>
                          {l.actor.name}
                          <span className="block text-xs text-slate-500">
                            {l.actor.role.toLowerCase()}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">System</span>
                      )}
                    </Td>
                    <Td className="font-mono text-xs">{l.action}</Td>
                    <Td>
                      {l.entity}
                      {l.entityId && (
                        <span
                          className="block max-w-[10rem] truncate font-mono text-xs text-slate-500"
                          title={l.entityId}
                        >
                          {l.entityId}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {l.metadata ? (
                        <details>
                          <summary className="cursor-pointer text-brand-700">View</summary>
                          <pre className="mt-1 max-w-sm overflow-x-auto rounded bg-slate-100 p-2 text-xs">
                            {JSON.stringify(l.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination data={data} onPage={setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}

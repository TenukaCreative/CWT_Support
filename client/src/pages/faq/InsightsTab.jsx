import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { fmtDate, qs } from '../../lib/query.js';
import Alert from '../../components/Alert.jsx';
import { FilterBar, FilterField, TableWrap, Td, Th } from '../../components/ui.jsx';

const Stat = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4">
    <p className="text-2xl font-semibold">{value}</p>
    <p className="text-xs text-slate-600">{label}</p>
  </div>
);

export default function InsightsTab() {
  const { projects } = useAuth();
  const [days, setDays] = useState('30');
  const [projectId, setProjectId] = useState('');
  const q = useQuery({
    queryKey: ['faq-insights', days, projectId],
    queryFn: () => api(`/faq/manage/search-insights${qs({ days, projectId })}`),
  });

  return (
    <div className="space-y-8">
      <FilterBar>
        <FilterField label="Period">
          <select className="input" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </FilterField>
        <FilterField label="Project">
          <select
            className="input"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All in view</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>
      {q.isLoading && (
        <p role="status" className="text-slate-500">
          Loading…
        </p>
      )}
      {q.isError && <Alert type="error">{q.error.message}</Alert>}
      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Customer searches" value={q.data.totals.searches} />
            <Stat label="Found nothing" value={q.data.totals.zeroResults} />
            <Stat label="Opened an article" value={q.data.totals.clicked} />
            <Stat label="Then raised a ticket" value={q.data.totals.ticketsAfter} />
          </div>
          <section aria-labelledby="zero-h">
            <h2 id="zero-h" className="mb-1 text-lg font-semibold">
              Searches with no results
            </h2>
            <p className="mb-2 text-sm text-slate-600">
              Customers looked for these and found nothing: article ideas.
            </p>
            {q.data.zeroResults.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-slate-500">
                No zero-result searches in this period.
              </p>
            ) : (
              <TableWrap label="Zero-result searches">
                <thead>
                  <tr>
                    <Th>Search</Th>
                    <Th>Times</Th>
                    <Th>Last searched</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {q.data.zeroResults.map((r) => (
                    <tr key={r.query}>
                      <Td className="font-medium">{r.query}</Td>
                      <Td>{r.count}</Td>
                      <Td>{fmtDate(r.lastSearchedAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </section>
          <section aria-labelledby="top-h">
            <h2 id="top-h" className="mb-2 text-lg font-semibold">
              Most common searches
            </h2>
            {q.data.topQueries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-slate-500">
                No searches yet.
              </p>
            ) : (
              <TableWrap label="Top searches">
                <thead>
                  <tr>
                    <Th>Search</Th>
                    <Th>Times</Th>
                    <Th>Avg. results</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {q.data.topQueries.map((r) => (
                    <tr key={r.query}>
                      <Td className="font-medium">{r.query}</Td>
                      <Td>{r.count}</Td>
                      <Td>{r.avgResults}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </section>
        </>
      )}
    </div>
  );
}

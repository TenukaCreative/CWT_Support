import Alert from './Alert.jsx';

// A dashboard block with its own loading / error (+ retry) state, so one failing query does not
// blank the whole page. While refetching with new filters the old numbers stay, dimmed.
export default function ReportSection({ title, subtitle, query, children, id }) {
  const heading = `${id}-h`;
  return (
    <section aria-labelledby={heading} className="space-y-3">
      <div>
        <h2 id={heading} className="text-lg font-semibold">
          {title}
        </h2>
        {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
      </div>
      {query.isLoading && (
        <p role="status" className="py-6 text-center text-slate-500">
          Loading…
        </p>
      )}
      {query.isError && !query.data && (
        <Alert type="error">
          {query.error.message}{' '}
          <button type="button" className="underline" onClick={() => query.refetch()}>
            Retry
          </button>
        </Alert>
      )}
      {query.data && (
        <div
          className={query.isPlaceholderData ? 'opacity-60 transition-opacity' : ''}
          aria-busy={query.isPlaceholderData}
        >
          {children(query.data)}
        </div>
      )}
    </section>
  );
}

export function MiniTable({ label, rows, nameHeader, empty = 'No data in this period.' }) {
  if (rows.length === 0)
    return (
      <p className="rounded-lg border border-dashed border-slate-300 py-5 text-center text-sm text-slate-500">
        {empty}
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm" aria-label={label}>
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            <th scope="col" className="px-3 py-2">
              {nameHeader}
            </th>
            <th scope="col" className="px-3 py-2">
              Avg rating
            </th>
            <th scope="col" className="px-3 py-2">
              Ratings
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id || r.name}>
              <td className="px-3 py-2">{r.name}</td>
              <td className="px-3 py-2 font-medium">{r.average?.toFixed(2)}</td>
              <td className="px-3 py-2">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

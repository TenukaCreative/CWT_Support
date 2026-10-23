import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { qs, useDebounced } from '../lib/query.js';

// Live "did you mean one of these?" panel. Reusable: the New Ticket form (Phase 5) renders it
// under the subject field. Links open in a new tab so the half-written ticket is not lost.
export default function FaqSuggestions({ query, log = false, onResults }) {
  const text = useDebounced(query.trim(), 400);
  const enabled = text.length >= 3;
  const q = useQuery({
    queryKey: ['faq-suggest', text, log],
    queryFn: async () => {
      const res = await api(`/faq/suggest${qs({ q: text, log: log ? 'true' : undefined })}`);
      onResults?.(res);
      return res;
    },
    enabled,
    staleTime: 60_000,
  });

  if (!enabled) return null;
  if (q.isLoading)
    return (
      <p role="status" className="text-sm text-slate-500">
        Looking for answers…
      </p>
    );
  if (q.isError || q.data.items.length === 0) return null;

  return (
    <section
      aria-label="Suggested articles"
      className="rounded-md border border-brand-100 bg-brand-50 p-3"
    >
      <h2 className="text-sm font-medium text-brand-700">
        These articles might answer your question
      </h2>
      <ul className="mt-2 space-y-2">
        {q.data.items.map((a) => (
          <li key={a.id}>
            <Link
              to={`/app/faq/${a.id}`}
              state={q.data.searchLogId ? { searchLogId: q.data.searchLogId } : undefined}
              target="_blank"
              className="text-sm font-medium text-brand-700 underline"
            >
              {a.question}
            </Link>
            <p className="text-xs text-slate-600">{a.snippet}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

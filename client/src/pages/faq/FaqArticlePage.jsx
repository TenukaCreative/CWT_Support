import { useEffect, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Alert from '../../components/Alert.jsx';
import RichHtml from '../../components/RichHtml.jsx';
import { Badge } from '../../components/ui.jsx';
import { fmtDate } from '../../lib/query.js';

export default function FaqArticlePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const searchLogId = useLocation().state?.searchLogId;
  const isCustomer = user.role === 'CUSTOMER';

  const q = useQuery({ queryKey: ['faq-article', id], queryFn: () => api(`/faq/articles/${id}`) });

  // Tell the server this search led to this article (powers the deflection analytics). Best-effort.
  const clicked = useRef(false);
  useEffect(() => {
    if (!searchLogId || clicked.current) return;
    clicked.current = true;
    api(`/faq/search-logs/${searchLogId}/click`, { method: 'POST', body: { articleId: id } }).catch(
      () => {},
    );
  }, [searchLogId, id]);

  const vote = useMutation({
    mutationFn: (helpful) => api(`/faq/articles/${id}/vote`, { method: 'POST', body: { helpful } }),
    onSuccess: (res) => {
      qc.setQueryData(['faq-article', id], (old) => ({ article: { ...old.article, ...res } }));
      toast.success('Thanks for your feedback');
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) {
    return (
      <div className="max-w-2xl space-y-3">
        <Alert type="error">
          {q.error.status === 404
            ? 'This article does not exist or is not available to you.'
            : q.error.message}
        </Alert>
        <Link
          to={isCustomer ? '/app/faq' : '/app/faq-manager'}
          className="text-sm text-brand-700 underline"
        >
          ← Back
        </Link>
      </div>
    );
  }
  const a = q.data.article;

  return (
    <article className="max-w-3xl">
      <Link
        to={isCustomer ? '/app/faq' : '/app/faq-manager'}
        className="text-sm text-brand-700 underline"
      >
        ← {isCustomer ? 'Help Center' : 'FAQ manager'}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{a.question}</h1>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {a.status === 'DRAFT' && <Badge value="PENDING" label="Draft" />}
        {a.category && <span>{a.category.name}</span>}
        <span>Updated {fmtDate(a.updatedAt)}</span>
      </p>
      <div className="card mt-4">
        <RichHtml html={a.answerHtml} />
      </div>

      {isCustomer && (
        <section
          aria-labelledby="helpful-h"
          className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
        >
          <h2 id="helpful-h" className="font-medium">
            Was this article helpful?
          </h2>
          <div className="mt-2 flex gap-2">
            {[
              [true, 'Yes'],
              [false, 'No'],
            ].map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={a.myVote === value}
                disabled={vote.isPending}
                onClick={() => vote.mutate(value)}
                className={a.myVote === value ? 'btn-primary' : 'btn-secondary'}
              >
                {label}
              </button>
            ))}
          </div>
          {a.myVote !== null && (
            <p className="mt-2 text-sm text-slate-600" role="status">
              Thanks! You can change your answer any time.
            </p>
          )}
          {a.myVote !== true && (
            <p className="mt-3 text-sm text-slate-600">
              Still need help?{' '}
              <Link to="/app/tickets/new" className="text-brand-700 underline">
                Create a ticket
              </Link>
            </p>
          )}
        </section>
      )}
    </article>
  );
}

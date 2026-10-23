import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { qs, useDebounced, useList } from '../../lib/query.js';
import Alert from '../../components/Alert.jsx';
import { PageHeader, Pagination } from '../../components/ui.jsx';

export default function FaqPage() {
  const [params, setParams] = useSearchParams();
  const urlQ = params.get('q') ?? '';
  const [text, setText] = useState(urlQ);
  const debounced = useDebounced(text.trim(), 350);
  const searching = debounced.length >= 2;

  const onChange = (e) => {
    setText(e.target.value);
    setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title="Help Center" subtitle="Find answers before raising a ticket." />
      <form role="search" onSubmit={(e) => e.preventDefault()} className="mb-6">
        <label htmlFor="faq-search" className="sr-only">
          Search the help center
        </label>
        <input
          id="faq-search"
          type="search"
          className="input py-3 text-base"
          placeholder="Search for answers…"
          value={text}
          onChange={onChange}
        />
      </form>
      {searching ? <SearchResults q={debounced} /> : <Browse />}
    </div>
  );
}

function ArticleLink({ article, searchLogId }) {
  return (
    <li className="py-3">
      <Link
        to={`/app/faq/${article.id}`}
        state={searchLogId ? { searchLogId } : undefined}
        className="font-medium text-brand-700 underline"
      >
        {article.question}
      </Link>
      <p className="mt-1 text-sm text-slate-600">{article.snippet}</p>
      {article.category && <p className="mt-1 text-xs text-slate-500">{article.category.name}</p>}
    </li>
  );
}

function SearchResults({ q }) {
  const search = useQuery({
    queryKey: ['faq-search', q],
    queryFn: () => api(`/faq/search${qs({ q, limit: 20 })}`),
  });
  if (search.isLoading)
    return (
      <p role="status" className="text-slate-500">
        Searching…
      </p>
    );
  if (search.isError) return <Alert type="error">{search.error.message}</Alert>;
  const { items, searchLogId } = search.data;

  if (items.length === 0) {
    return (
      <div className="card text-center">
        <p className="font-medium">No articles match &ldquo;{q}&rdquo;.</p>
        <p className="mt-1 text-sm text-slate-600">Try different words, or ask us directly.</p>
        <Link to="/app/tickets/new" className="btn-primary mt-4">
          Create a ticket
        </Link>
      </div>
    );
  }
  return (
    <section aria-label="Search results">
      <p className="mb-2 text-sm text-slate-600" role="status">
        {items.length} result{items.length === 1 ? '' : 's'}
      </p>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white px-4">
        {items.map((a) => (
          <ArticleLink key={a.id} article={a} searchLogId={searchLogId} />
        ))}
      </ul>
      <p className="mt-4 text-sm text-slate-600">
        Not what you need?{' '}
        <Link to="/app/tickets/new" className="text-brand-700 underline">
          Create a ticket
        </Link>
      </p>
    </section>
  );
}

function Browse() {
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const cats = useQuery({ queryKey: ['faq-categories'], queryFn: () => api('/faq/categories') });
  const list = useList('faq-articles', '/faq/articles', {
    categoryId,
    page,
    limit: 15,
    sort: 'sortOrder',
    dir: 'asc',
  });
  const pick = (id) => {
    setCategoryId(id);
    setPage(1);
  };

  const visible = cats.data?.categories.filter((c) => c.articleCount > 0) ?? [];
  const chips = [
    { id: '', name: 'All' },
    ...visible,
    ...(cats.data?.uncategorizedCount && visible.length ? [{ id: 'none', name: 'Other' }] : []),
  ];

  return (
    <div>
      {chips.length > 2 && (
        <div role="group" aria-label="Categories" className="mb-4 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c.id || 'all'}
              type="button"
              aria-pressed={categoryId === c.id}
              onClick={() => pick(c.id)}
              className={`rounded-full border px-3 py-1 text-sm ${categoryId === c.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {list.isLoading && (
        <p role="status" className="text-slate-500">
          Loading…
        </p>
      )}
      {list.isError && <Alert type="error">{list.error.message}</Alert>}
      {list.data && list.data.items.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 py-10 text-center text-slate-500">
          No articles in this project yet.
        </p>
      )}
      {list.data?.items.length > 0 && (
        <>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white px-4">
            {list.data.items.map((a) => (
              <ArticleLink key={a.id} article={a} />
            ))}
          </ul>
          <Pagination data={list.data} onPage={setPage} />
        </>
      )}
    </div>
  );
}

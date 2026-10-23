import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import { fmtDate, useDebounced, useList } from '../../lib/query.js';
import Field from '../../components/Field.jsx';
import Alert from '../../components/Alert.jsx';
import {
  Badge,
  ConfirmDialog,
  FilterBar,
  FilterField,
  Modal,
  Pagination,
  QueryState,
  TableWrap,
  Td,
  Th,
} from '../../components/ui.jsx';
import { projectLabel } from './projectLabel.js';

export default function ArticlesTab() {
  const { user, projects } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [projectId, setProjectId] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState(null); // 'new' | article id
  const [deleting, setDeleting] = useState(null);
  const search = useDebounced(q);
  const list = useList('faq-articles', '/faq/articles', {
    q: search,
    status,
    projectId,
    page,
    limit: 15,
    sort: 'updatedAt',
    dir: 'desc',
  });
  const config = useQuery({ queryKey: ['faq-config'], queryFn: () => api('/faq/manage/config') });
  const reset = (set) => (e) => {
    set(e.target.value);
    setPage(1);
  };

  const remove = useAdminMutation((id) => api(`/faq/manage/articles/${id}`, { method: 'DELETE' }), {
    invalidate: ['faq-articles', 'faq-categories'],
    success: 'Article deleted',
    onSuccess: () => setDeleting(null),
  });

  return (
    <div>
      {user.role === 'ADMIN' && <ApprovalToggle current={config.data?.requireApproval} />}
      {user.role === 'SUPPORT' && config.data?.requireApproval && (
        <div className="mb-4">
          <Alert type="info">
            Publishing requires administrator approval. Save articles as drafts and an admin will
            publish them.
          </Alert>
        </div>
      )}
      <FilterBar>
        <FilterField label="Search">
          <input
            className="input"
            value={q}
            onChange={reset(setQ)}
            placeholder="Question or answer"
          />
        </FilterField>
        <FilterField label="Status">
          <select className="input" value={status} onChange={reset(setStatus)}>
            <option value="">All</option>
            <option value="PUBLISHED">Published</option>
            <option value="DRAFT">Draft</option>
          </select>
        </FilterField>
        <FilterField label="Project">
          <select className="input" value={projectId} onChange={reset(setProjectId)}>
            <option value="">All in view</option>
            <option value="global">Global</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key}
              </option>
            ))}
          </select>
        </FilterField>
        <button type="button" className="btn-primary ml-auto" onClick={() => setEditor('new')}>
          New article
        </button>
      </FilterBar>

      <QueryState query={list} emptyText="No articles yet. Create the first one.">
        {(data) => (
          <>
            <TableWrap label="FAQ articles">
              <thead>
                <tr>
                  <Th>Question</Th>
                  <Th>Project</Th>
                  <Th>Category</Th>
                  <Th>Status</Th>
                  <Th>Helpful</Th>
                  <Th>Updated</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <Td className="max-w-md font-medium">
                      <Link to={`/app/faq/${a.id}`} className="text-brand-700 underline">
                        {a.question}
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs">{projectLabel(projects, a.projectId)}</Td>
                    <Td>{a.category?.name ?? '—'}</Td>
                    <Td>
                      <Badge
                        value={a.status === 'DRAFT' ? 'PENDING' : 'ACTIVE'}
                        label={a.status === 'DRAFT' ? 'Draft' : 'Published'}
                      />
                    </Td>
                    <Td>
                      <span title="Helpful / not helpful">
                        {a.helpfulYes} / {a.helpfulNo}
                      </span>
                    </Td>
                    <Td>{fmtDate(a.updatedAt)}</Td>
                    <Td className="whitespace-nowrap text-right">
                      <button
                        type="button"
                        className="btn-secondary mr-2"
                        aria-label={`Edit ${a.question}`}
                        onClick={() => setEditor(a.id)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        aria-label={`Delete ${a.question}`}
                        onClick={() => setDeleting(a)}
                      >
                        Delete
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination data={data} onPage={setPage} />
          </>
        )}
      </QueryState>

      {editor && (
        <ArticleEditor
          articleId={editor === 'new' ? null : editor}
          requireApproval={Boolean(config.data?.requireApproval)}
          onClose={() => setEditor(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this article?"
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id)}
        >
          &ldquo;{deleting.question}&rdquo; and its votes will be permanently removed. To hide it
          without deleting, switch it to Draft instead.
        </ConfirmDialog>
      )}
    </div>
  );
}

function ApprovalToggle({ current }) {
  const toggle = useAdminMutation(
    (value) => api('/admin/settings', { method: 'PATCH', body: { faqRequireApproval: value } }),
    {
      invalidate: ['faq-config'],
      success: (res) =>
        res.settings.faqRequireApproval
          ? 'Approval is now required'
          : 'Support can publish directly',
    },
  );
  return (
    <label className="mb-4 flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={Boolean(current)}
        disabled={current === undefined || toggle.isPending}
        onChange={(e) => toggle.mutate(e.target.checked)}
      />
      Require administrator approval before support staff can publish articles
    </label>
  );
}

function ArticleEditor({ articleId, requireApproval, onClose }) {
  const detail = useQuery({
    queryKey: ['faq-article', articleId],
    queryFn: () => api(`/faq/articles/${articleId}`),
    enabled: Boolean(articleId),
  });
  if (articleId && detail.isLoading)
    return (
      <Modal title="Edit article" onClose={onClose}>
        <p role="status">Loading…</p>
      </Modal>
    );
  if (articleId && detail.isError)
    return (
      <Modal title="Edit article" onClose={onClose}>
        <Alert type="error">{detail.error.message}</Alert>
      </Modal>
    );
  return (
    <EditorForm
      article={detail.data?.article}
      requireApproval={requireApproval}
      onClose={onClose}
    />
  );
}

function EditorForm({ article, requireApproval, onClose }) {
  const { user, projects, activeProjectId } = useAuth();
  const [serverError, setServerError] = useState(null);
  const defaultProject = article
    ? (article.projectId ?? '')
    : (projects.find((p) => p.id === activeProjectId)?.id ?? projects[0]?.id ?? '');
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      projectId: defaultProject,
      question: article?.question ?? '',
      answer: article?.answer ?? '',
      categoryId: article?.categoryId ?? '',
      status: article?.status ?? 'DRAFT',
      sortOrder: article?.sortOrder ?? 0,
    },
  });
  const projectId = watch('projectId');
  const answer = watch('answer');
  const debouncedAnswer = useDebounced(answer, 400);

  const cats = useQuery({ queryKey: ['faq-categories'], queryFn: () => api('/faq/categories') });
  const fitting = (cats.data?.categories ?? []).filter(
    (c) => c.projectId === null || c.projectId === (projectId || null),
  );
  const preview = useQuery({
    queryKey: ['faq-preview', debouncedAnswer],
    queryFn: () =>
      api('/faq/manage/preview', { method: 'POST', body: { answer: debouncedAnswer } }),
    enabled: debouncedAnswer.trim().length > 0,
    placeholderData: (prev) => prev,
  });

  const save = useAdminMutation(
    (body) =>
      api(article ? `/faq/manage/articles/${article.id}` : '/faq/manage/articles', {
        method: article ? 'PATCH' : 'POST',
        body,
      }),
    {
      invalidate: ['faq-articles', 'faq-categories', 'faq-article', 'faq-search'],
      success: article ? 'Article saved' : 'Article created',
      onSuccess: onClose,
    },
  );
  const submit = (v) => {
    setServerError(null);
    const common = {
      question: v.question,
      answer: v.answer,
      categoryId: v.categoryId || null,
      status: v.status,
      sortOrder: Number(v.sortOrder) || 0,
    };
    const body = article ? common : { ...common, projectId: v.projectId || null };
    save.mutate(body, { onError: (e) => setServerError(e.details?.[0]?.message ?? e.message) });
  };
  const publishLocked =
    requireApproval && user.role === 'SUPPORT' && article?.status !== 'PUBLISHED';

  return (
    <Modal title={article ? 'Edit article' : 'New article'} onClose={onClose} wide>
      <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
        {serverError && <Alert type="error">{serverError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project" error={errors.projectId?.message}>
            <select className="input" disabled={Boolean(article)} {...register('projectId')}>
              {user.role === 'ADMIN' && <option value="">Global (all projects)</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.key})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select className="input" {...register('categoryId')}>
              <option value="">No category</option>
              {fitting.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.projectId === null ? ' (global)' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Question" error={errors.question?.message}>
          <input
            className="input"
            {...register('question', {
              required: 'Question is required',
              minLength: { value: 5, message: 'At least 5 characters' },
              maxLength: 300,
            })}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Answer (markdown)"
            error={errors.answer?.message}
            hint="Supports **bold**, lists, links and tables. Images and HTML are not allowed."
          >
            <textarea
              rows={10}
              className="input font-mono"
              {...register('answer', { required: 'Answer is required', maxLength: 20000 })}
            />
          </Field>
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Preview</p>
            <div
              aria-label="Answer preview"
              className="h-[15.5rem] overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"
            >
              {preview.data ? (
                <div
                  className="rich"
                  dangerouslySetInnerHTML={{ __html: preview.data.answerHtml }}
                />
              ) : (
                <p className="text-slate-500">Nothing to preview yet.</p>
              )}
            </div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Status"
            hint={
              publishLocked ? 'Publishing needs administrator approval; save as draft.' : undefined
            }
          >
            <select className="input" {...register('status')}>
              <option value="DRAFT">Draft (hidden from customers)</option>
              <option value="PUBLISHED" disabled={publishLocked}>
                Published
              </option>
            </select>
          </Field>
          <Field label="Sort order" hint="Lower numbers appear first.">
            <input type="number" min={0} max={10000} className="input" {...register('sortOrder')} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            Save article
          </button>
        </div>
      </form>
    </Modal>
  );
}

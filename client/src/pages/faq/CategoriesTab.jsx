import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import Field from '../../components/Field.jsx';
import Alert from '../../components/Alert.jsx';
import { ConfirmDialog, Modal, TableWrap, Td, Th } from '../../components/ui.jsx';
import { projectLabel } from './projectLabel.js';

export default function CategoriesTab() {
  const { projects } = useAuth();
  const [editing, setEditing] = useState(null); // 'new' | category
  const [deleting, setDeleting] = useState(null);
  const q = useQuery({ queryKey: ['faq-categories'], queryFn: () => api('/faq/categories') });
  const remove = useAdminMutation(
    (id) => api(`/faq/manage/categories/${id}`, { method: 'DELETE' }),
    {
      invalidate: ['faq-categories', 'faq-articles'],
      success: 'Category deleted',
      onSuccess: () => setDeleting(null),
    },
  );

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          New category
        </button>
      </div>
      {q.isLoading && (
        <p role="status" className="text-slate-500">
          Loading…
        </p>
      )}
      {q.isError && <Alert type="error">{q.error.message}</Alert>}
      {q.data && q.data.categories.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 py-10 text-center text-slate-500">
          No categories yet.
        </p>
      )}
      {q.data?.categories.length > 0 && (
        <TableWrap label="FAQ categories">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Project</Th>
              <Th>Order</Th>
              <Th>Articles</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.categories.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td className="font-mono text-xs">{projectLabel(projects, c.projectId)}</Td>
                <Td>{c.sortOrder}</Td>
                <Td>{c.articleCount}</Td>
                <Td className="whitespace-nowrap text-right">
                  <button
                    type="button"
                    className="btn-secondary mr-2"
                    aria-label={`Edit ${c.name}`}
                    onClick={() => setEditing(c)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => setDeleting(c)}
                  >
                    Delete
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {editing && (
        <CategoryForm
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id)}
        >
          Its {deleting.articleCount} article(s) are kept and become uncategorised.
        </ConfirmDialog>
      )}
    </div>
  );
}

function CategoryForm({ category, onClose }) {
  const { user, projects, activeProjectId } = useAuth();
  const [serverError, setServerError] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: {
      projectId: category
        ? (category.projectId ?? '')
        : (projects.find((p) => p.id === activeProjectId)?.id ?? projects[0]?.id ?? ''),
      name: category?.name ?? '',
      sortOrder: category?.sortOrder ?? 0,
    },
  });
  const save = useAdminMutation(
    (body) =>
      api(category ? `/faq/manage/categories/${category.id}` : '/faq/manage/categories', {
        method: category ? 'PATCH' : 'POST',
        body,
      }),
    {
      invalidate: ['faq-categories'],
      success: category ? 'Category saved' : 'Category created',
      onSuccess: onClose,
    },
  );
  const submit = (v) => {
    setServerError(null);
    const body = category
      ? { name: v.name, sortOrder: Number(v.sortOrder) || 0 }
      : { projectId: v.projectId || null, name: v.name, sortOrder: Number(v.sortOrder) || 0 };
    save.mutate(body, { onError: (e) => setServerError(e.details?.[0]?.message ?? e.message) });
  };
  return (
    <Modal title={category ? 'Edit category' : 'New category'} onClose={onClose}>
      <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
        {serverError && <Alert type="error">{serverError}</Alert>}
        <Field label="Project">
          <select className="input" disabled={Boolean(category)} {...register('projectId')}>
            {user.role === 'ADMIN' && <option value="">Global (all projects)</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.key})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name" error={errors.name?.message}>
          <input
            className="input"
            {...register('name', { required: 'Name is required', maxLength: 100 })}
          />
        </Field>
        <Field label="Sort order" hint="Lower numbers appear first.">
          <input type="number" min={0} className="input" {...register('sortOrder')} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

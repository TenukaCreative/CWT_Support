import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import { qs } from '../../lib/query.js';
import Field from '../../components/Field.jsx';
import Alert from '../../components/Alert.jsx';
import { Badge, ConfirmDialog, Modal, TableWrap, Td, Th } from '../../components/ui.jsx';

export default function ProjectDetailPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['project', id], queryFn: () => api(`/admin/projects/${id}`) });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);

  const remove = useAdminMutation(
    (userId) => api(`/admin/projects/${id}/members/${userId}`, { method: 'DELETE' }),
    {
      invalidate: ['project', 'projects'],
      success: 'Member removed',
      onSuccess: () => setRemoving(null),
    },
  );

  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <Alert type="error">{q.error.message}</Alert>;
  const project = q.data.project;
  const archived = project.status === 'ARCHIVED';

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <Link to="/app/admin/projects" className="text-sm text-brand-700 underline">
          ← All projects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          <span className="font-mono">{project.key}</span> · {project.name}{' '}
          <Badge value={project.status} />
        </h1>
        <p className="text-sm text-slate-600">{project.organization.name}</p>
      </div>

      <DetailsForm project={project} />

      <section aria-labelledby="members-h">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="members-h" className="font-medium">
            Members ({project.members.length})
          </h2>
          <button
            type="button"
            className="btn-primary"
            disabled={archived}
            onClick={() => setAdding(true)}
          >
            Add members
          </button>
        </div>
        {project.members.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-slate-500">
            No members yet. Admins always have access.
          </p>
        ) : (
          <TableWrap label="Project members">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {project.members.map((m) => (
                <tr key={m.id}>
                  <Td className="font-medium">{m.name}</Td>
                  <Td>{m.email}</Td>
                  <Td>
                    <Badge value={m.role} />
                  </Td>
                  <Td>
                    <Badge value={m.status} />
                  </Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Remove ${m.name}`}
                      onClick={() => setRemoving(m)}
                    >
                      Remove
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>

      {adding && <AddMembers project={project} onClose={() => setAdding(false)} />}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove"
          danger
          busy={remove.isPending}
          onClose={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing.id)}
        >
          They will immediately lose access to this project&apos;s tickets and knowledge base.
        </ConfirmDialog>
      )}
    </div>
  );
}

function DetailsForm({ project }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: project.name,
      description: project.description ?? '',
      status: project.status,
    },
  });
  const save = useAdminMutation(
    (body) => api(`/admin/projects/${project.id}`, { method: 'PATCH', body }),
    { invalidate: ['project', 'projects', 'project-options'], success: 'Project saved' },
  );
  return (
    <form
      noValidate
      onSubmit={handleSubmit((v) => save.mutate(v))}
      className="card space-y-4"
      aria-label="Project details"
    >
      <Field label="Name" error={errors.name?.message}>
        <input
          className="input"
          {...register('name', { required: 'Name is required', maxLength: 100 })}
        />
      </Field>
      <Field label="Description">
        <textarea rows={2} className="input" {...register('description', { maxLength: 1000 })} />
      </Field>
      <Field
        label="Status"
        hint="Archiving removes access for all customers and support on this project."
      >
        <select className="input" {...register('status')}>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </Field>
      <button type="submit" className="btn-primary" disabled={save.isPending}>
        Save changes
      </button>
    </form>
  );
}

function AddMembers({ project, onClose }) {
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState('');
  // Candidates: all support staff + customers of THIS project's organization (the server enforces the same rule).
  const support = useQuery({
    queryKey: ['candidates', 'support'],
    queryFn: () =>
      api(
        `/admin/users${qs({ role: 'SUPPORT', status: 'ACTIVE', limit: 100, sort: 'name', dir: 'asc' })}`,
      ),
  });
  const customers = useQuery({
    queryKey: ['candidates', 'customers', project.organization.id],
    queryFn: () =>
      api(
        `/admin/users${qs({ role: 'CUSTOMER', status: 'ACTIVE', organizationId: project.organization.id, limit: 100, sort: 'name', dir: 'asc' })}`,
      ),
  });
  const existing = new Set(project.members.map((m) => m.id));
  const all = [...(support.data?.items ?? []), ...(customers.data?.items ?? [])].filter(
    (u) => !existing.has(u.id),
  );
  const shown = all.filter((u) =>
    `${u.name} ${u.email}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const loading = support.isLoading || customers.isLoading;

  const add = useAdminMutation(
    (userIds) =>
      api(`/admin/projects/${project.id}/members`, { method: 'POST', body: { userIds } }),
    {
      invalidate: ['project', 'projects'],
      success: (_d, ids) => `${ids.length} member(s) added`,
      onSuccess: onClose,
    },
  );
  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Modal title="Add members" onClose={onClose}>
      <label className="text-sm font-medium text-slate-700">
        Filter
        <input className="input mt-1" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      <div
        className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2"
        role="group"
        aria-label="People to add"
      >
        {loading && <p className="text-sm text-slate-500">Loading…</p>}
        {!loading && shown.length === 0 && (
          <p className="text-sm text-slate-500">No one left to add.</p>
        )}
        {shown.map((u) => (
          <label key={u.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(u.id)}
              onChange={() => toggle(u.id)}
            />
            <span>
              {u.name} <span className="text-slate-500">({u.email})</span>
            </span>{' '}
            <Badge value={u.role} />
          </label>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={selected.length === 0 || add.isPending}
          onClick={() => add.mutate(selected)}
        >
          Add {selected.length || ''}
        </button>
      </div>
    </Modal>
  );
}

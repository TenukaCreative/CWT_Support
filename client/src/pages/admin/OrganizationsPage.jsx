import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../../api/client.js';
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
  PageHeader,
  Pagination,
  QueryState,
  TableWrap,
  Td,
  Th,
} from '../../components/ui.jsx';

export default function OrganizationsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // org | 'new' | null
  const [archiving, setArchiving] = useState(null);
  const search = useDebounced(q);
  const list = useList('organizations', '/admin/organizations', {
    q: search,
    status,
    page,
    limit: 15,
    sort: 'name',
    dir: 'asc',
  });

  const setStatusMutation = useAdminMutation(
    ({ id, status }) => api(`/admin/organizations/${id}`, { method: 'PATCH', body: { status } }),
    {
      invalidate: ['organizations', 'projects', 'org-options', 'project-options'],
      success: 'Organization updated',
      onSuccess: () => setArchiving(null),
    },
  );

  return (
    <div>
      <PageHeader
        title="Organizations"
        subtitle="Client companies. Each owns one or more projects."
      >
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          New organization
        </button>
      </PageHeader>
      <FilterBar>
        <FilterField label="Search">
          <input
            className="input"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Name or domain"
          />
        </FilterField>
        <FilterField label="Status">
          <select
            className="input"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </FilterField>
      </FilterBar>

      <QueryState query={list} emptyText="No organizations match.">
        {(data) => (
          <>
            <TableWrap label="Organizations">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Domain</Th>
                  <Th>Projects</Th>
                  <Th>Users</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((o) => (
                  <tr key={o.id}>
                    <Td className="font-medium">{o.name}</Td>
                    <Td>{o.domain ?? '—'}</Td>
                    <Td>{o._count.projects}</Td>
                    <Td>{o._count.users}</Td>
                    <Td>
                      <Badge value={o.status} />
                    </Td>
                    <Td>{fmtDate(o.createdAt)}</Td>
                    <Td className="whitespace-nowrap text-right">
                      <button
                        type="button"
                        className="btn-secondary mr-2"
                        onClick={() => setEditing(o)}
                        aria-label={`Edit ${o.name}`}
                      >
                        Edit
                      </button>
                      {o.status === 'ACTIVE' ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setArchiving(o)}
                          aria-label={`Archive ${o.name}`}
                        >
                          Archive
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setStatusMutation.mutate({ id: o.id, status: 'ACTIVE' })}
                          aria-label={`Restore ${o.name}`}
                        >
                          Restore
                        </button>
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

      {editing && (
        <OrgForm org={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {archiving && (
        <ConfirmDialog
          title={`Archive ${archiving.name}?`}
          confirmLabel="Archive"
          danger
          busy={setStatusMutation.isPending}
          onClose={() => setArchiving(null)}
          onConfirm={() => setStatusMutation.mutate({ id: archiving.id, status: 'ARCHIVED' })}
        >
          This also archives its {archiving._count.projects} project(s). Its users will lose access
          to them immediately. History is kept and the organization can be restored later (projects
          must be restored individually).
        </ConfirmDialog>
      )}
    </div>
  );
}

function OrgForm({ org, onClose }) {
  const [serverError, setServerError] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: { name: org?.name ?? '', domain: org?.domain ?? '' } });
  const save = useAdminMutation(
    (body) =>
      api(org ? `/admin/organizations/${org.id}` : '/admin/organizations', {
        method: org ? 'PATCH' : 'POST',
        body,
      }),
    {
      invalidate: ['organizations', 'org-options'],
      success: org ? 'Organization saved' : 'Organization created',
      onSuccess: onClose,
    },
  );

  return (
    <Modal title={org ? 'Edit organization' : 'New organization'} onClose={onClose}>
      <form
        noValidate
        onSubmit={handleSubmit((v) => {
          setServerError(null);
          save.mutate(
            { name: v.name, domain: v.domain },
            { onError: (e) => setServerError(e.details?.[0]?.message ?? e.message) },
          );
        })}
        className="space-y-4"
      >
        {serverError && <Alert type="error">{serverError}</Alert>}
        <Field label="Name" error={errors.name?.message}>
          <input
            className="input"
            {...register('name', { required: 'Name is required', maxLength: 100 })}
          />
        </Field>
        <Field
          label="Email domain (optional)"
          hint="Used for optional domain-based auto-join, e.g. acme.com"
          error={errors.domain?.message}
        >
          <input className="input" {...register('domain')} />
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

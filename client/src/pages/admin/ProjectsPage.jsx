import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import { useDebounced, useList } from '../../lib/query.js';
import Field from '../../components/Field.jsx';
import Alert from '../../components/Alert.jsx';
import { OrgSelect } from '../../components/ProjectCheckboxes.jsx';
import {
  Badge,
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

export default function ProjectsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [organizationId, setOrg] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const search = useDebounced(q);
  const list = useList('projects', '/admin/projects', {
    q: search,
    status,
    organizationId,
    page,
    limit: 15,
    sort: 'key',
    dir: 'asc',
  });

  return (
    <div>
      <PageHeader title="Projects" subtitle="Ticket numbers are prefixed with the project key.">
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          New project
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
            placeholder="Name or key"
          />
        </FilterField>
        <FilterField label="Organization">
          <OrgSelect
            includeAll
            value={organizationId}
            onChange={(v) => {
              setOrg(v);
              setPage(1);
            }}
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

      <QueryState query={list} emptyText="No projects match.">
        {(data) => (
          <>
            <TableWrap label="Projects">
              <thead>
                <tr>
                  <Th>Key</Th>
                  <Th>Name</Th>
                  <Th>Organization</Th>
                  <Th>Members</Th>
                  <Th>Tickets</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-mono">
                      <Link className="text-brand-700 underline" to={`/app/admin/projects/${p.id}`}>
                        {p.key}
                      </Link>
                    </Td>
                    <Td>{p.name}</Td>
                    <Td>{p.organization.name}</Td>
                    <Td>{p._count.members}</Td>
                    <Td>{p._count.tickets}</Td>
                    <Td>
                      <Badge value={p.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination data={data} onPage={setPage} />
          </>
        )}
      </QueryState>
      {creating && <ProjectForm onClose={() => setCreating(false)} />}
    </div>
  );
}

function ProjectForm({ onClose }) {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({ defaultValues: { organizationId: '', name: '', key: '', description: '' } });
  const save = useAdminMutation((body) => api('/admin/projects', { method: 'POST', body }), {
    invalidate: ['projects', 'project-options'],
    success: 'Project created',
    onSuccess: (res) => {
      onClose();
      navigate(`/app/admin/projects/${res.project.id}`);
    },
  });
  register('organizationId', { required: 'Choose an organization' });

  return (
    <Modal title="New project" onClose={onClose}>
      <form
        noValidate
        onSubmit={handleSubmit((v) => {
          setServerError(null);
          save.mutate(v, { onError: (e) => setServerError(e.details?.[0]?.message ?? e.message) });
        })}
        className="space-y-4"
      >
        {serverError && <Alert type="error">{serverError}</Alert>}
        <Field label="Organization" error={errors.organizationId?.message}>
          <OrgSelect
            value={watch('organizationId')}
            onChange={(v) => setValue('organizationId', v, { shouldValidate: true })}
          />
        </Field>
        <Field label="Name" error={errors.name?.message}>
          <input
            className="input"
            {...register('name', { required: 'Name is required', maxLength: 100 })}
          />
        </Field>
        <Field
          label="Key"
          hint="Prefix for ticket numbers, e.g. ACME-WEB. Cannot be changed later."
          error={errors.key?.message}
        >
          <input
            className="input font-mono uppercase"
            {...register('key', {
              required: 'Key is required',
              pattern: {
                value: /^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*$/,
                message: 'Letters, digits and single hyphens only',
              },
              minLength: { value: 2, message: 'At least 2 characters' },
              maxLength: { value: 20, message: 'At most 20 characters' },
            })}
          />
        </Field>
        <Field label="Description (optional)" error={errors.description?.message}>
          <textarea rows={2} className="input" {...register('description', { maxLength: 1000 })} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import { PRIORITY_LABELS } from '../../lib/tickets.js';
import Field from '../../components/Field.jsx';
import Alert from '../../components/Alert.jsx';
import { Badge, Modal, PageHeader, TableWrap, Td, Th } from '../../components/ui.jsx';

const TABS = [
  ['categories', 'Categories'],
  ['sla', 'SLA targets'],
  ['general', 'General'],
];
const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export default function AdminSettingsPage() {
  const [tab, setTab] = useState('categories');
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Categories, priorities & SLA"
        subtitle="How tickets are organised and how fast we promise to respond."
      />
      <div
        role="tablist"
        aria-label="Settings"
        className="mb-6 flex gap-1 border-b border-slate-200"
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            id={`s-${key}`}
            aria-selected={tab === key}
            aria-controls={`sp-${key}`}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === key ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`sp-${tab}`} aria-labelledby={`s-${tab}`}>
        {tab === 'categories' && <CategoriesSection />}
        {tab === 'sla' && <SlaSection />}
        {tab === 'general' && <GeneralSection />}
      </div>
    </div>
  );
}

// ───────────── categories ─────────────
function CategoriesSection() {
  const [editing, setEditing] = useState(null);
  const q = useQuery({ queryKey: ['admin-categories'], queryFn: () => api('/admin/categories') });
  const toggle = useAdminMutation(
    ({ id, isActive }) => api(`/admin/categories/${id}`, { method: 'PATCH', body: { isActive } }),
    {
      invalidate: ['admin-categories', 'categories'],
      success: (_d, v) => (v.isActive ? 'Category activated' : 'Category deactivated'),
    },
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Deactivating hides a category from new tickets; existing tickets keep their label.
        </p>
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
      {q.data?.categories.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 py-10 text-center text-slate-500">
          No categories yet.
        </p>
      )}
      {q.data?.categories.length > 0 && (
        <TableWrap label="Categories">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Applies to</Th>
              <Th>Tickets</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.categories.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td className="font-mono text-xs">{c.project?.key ?? 'All projects'}</Td>
                <Td>{c._count.tickets}</Td>
                <Td>
                  <Badge
                    value={c.isActive ? 'ACTIVE' : 'ARCHIVED'}
                    label={c.isActive ? 'Active' : 'Inactive'}
                  />
                </Td>
                <Td className="whitespace-nowrap text-right">
                  <button
                    type="button"
                    className="btn-secondary mr-2"
                    aria-label={`Rename ${c.name}`}
                    onClick={() => setEditing(c)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`${c.isActive ? 'Deactivate' : 'Activate'} ${c.name}`}
                    onClick={() => toggle.mutate({ id: c.id, isActive: !c.isActive })}
                  >
                    {c.isActive ? 'Deactivate' : 'Activate'}
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
    </div>
  );
}

function CategoryForm({ category, onClose }) {
  const [serverError, setServerError] = useState(null);
  const projects = useQuery({
    queryKey: ['project-options', 'all'],
    queryFn: () => api('/admin/projects?status=ACTIVE&limit=100&sort=key&dir=asc'),
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: { name: category?.name ?? '', projectId: '' } });
  const save = useAdminMutation(
    (body) =>
      api(category ? `/admin/categories/${category.id}` : '/admin/categories', {
        method: category ? 'PATCH' : 'POST',
        body,
      }),
    {
      invalidate: ['admin-categories', 'categories'],
      success: category ? 'Category renamed' : 'Category created',
      onSuccess: onClose,
    },
  );
  const submit = (v) => {
    setServerError(null);
    const body = category ? { name: v.name } : { name: v.name, projectId: v.projectId || null };
    save.mutate(body, { onError: (e) => setServerError(e.details?.[0]?.message ?? e.message) });
  };
  return (
    <Modal title={category ? 'Rename category' : 'New category'} onClose={onClose}>
      <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
        {serverError && <Alert type="error">{serverError}</Alert>}
        <Field label="Name" error={errors.name?.message}>
          <input
            className="input"
            {...register('name', { required: 'Name is required', maxLength: 100 })}
          />
        </Field>
        {!category && (
          <Field label="Applies to">
            <select className="input" {...register('projectId')}>
              <option value="">All projects</option>
              {projects.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.key})
                </option>
              ))}
            </select>
          </Field>
        )}
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

// ───────────── SLA ─────────────
function SlaSection() {
  const [projectId, setProjectId] = useState('');
  const policies = useQuery({
    queryKey: ['sla-policies'],
    queryFn: () => api('/admin/sla-policies'),
  });
  const projects = useQuery({
    queryKey: ['project-options', 'all'],
    queryFn: () => api('/admin/projects?status=ACTIVE&limit=100&sort=key&dir=asc'),
  });
  if (policies.isLoading)
    return (
      <p role="status" className="text-slate-500">
        Loading…
      </p>
    );
  if (policies.isError) return <Alert type="error">{policies.error.message}</Alert>;
  const { policies: rows, defaults } = policies.data;
  const find = (pid, priority) =>
    rows.find((r) => (r.projectId ?? '') === pid && r.priority === priority);

  return (
    <div className="space-y-10">
      <p className="text-sm text-slate-600">
        Targets are in hours from when the ticket is created. The clock pauses while a ticket waits
        on the customer. Changes apply to new tickets and to tickets whose priority changes
        afterwards.
      </p>
      <section aria-labelledby="g-h">
        <h2 id="g-h" className="mb-2 text-lg font-semibold">
          Global targets
        </h2>
        <PolicyTable projectId="" find={find} defaults={defaults} />
      </section>
      <section aria-labelledby="o-h">
        <h2 id="o-h" className="mb-2 text-lg font-semibold">
          Project overrides
        </h2>
        <label className="mb-3 block text-sm font-medium text-slate-700">
          Project
          <select
            className="input mt-1 max-w-xs"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Choose a project…</option>
            {projects.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.key})
              </option>
            ))}
          </select>
        </label>
        {projectId && (
          <PolicyTable projectId={projectId} find={find} defaults={defaults} override />
        )}
      </section>
    </div>
  );
}

function PolicyTable({ projectId, find, defaults, override = false }) {
  return (
    <TableWrap label={override ? 'Project SLA overrides' : 'Global SLA targets'}>
      <thead>
        <tr>
          <Th>Priority</Th>
          <Th>First response (hours)</Th>
          <Th>Resolution (hours)</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {PRIORITIES.map((p) => (
          <PolicyRow
            key={`${projectId}-${p}`}
            projectId={projectId}
            priority={p}
            policy={find(projectId, p)}
            fallback={find('', p) ?? defaults[p]}
            override={override}
          />
        ))}
      </tbody>
    </TableWrap>
  );
}

function PolicyRow({ projectId, priority, policy, fallback, override }) {
  const label = PRIORITY_LABELS[priority];
  const [first, setFirst] = useState(String(policy?.firstResponseHours ?? ''));
  const [resolution, setResolution] = useState(String(policy?.resolutionHours ?? ''));
  const shown = policy ?? fallback;
  const save = useAdminMutation((body) => api('/admin/sla-policies', { method: 'PUT', body }), {
    invalidate: ['sla-policies'],
    success: `${label} target saved`,
  });
  const remove = useAdminMutation((id) => api(`/admin/sla-policies/${id}`, { method: 'DELETE' }), {
    invalidate: ['sla-policies'],
    success: 'Override removed',
  });
  const f = Number(first || shown.firstResponseHours);
  const r = Number(resolution || shown.resolutionHours);
  const invalid = !Number.isInteger(f) || !Number.isInteger(r) || f < 1 || r < f;

  return (
    <tr>
      <Td className="font-medium">{label}</Td>
      <Td>
        <input
          className="input w-28"
          type="number"
          min={1}
          aria-label={`${label} first response hours`}
          value={first}
          placeholder={String(shown.firstResponseHours)}
          onChange={(e) => setFirst(e.target.value)}
        />
      </Td>
      <Td>
        <input
          className="input w-28"
          type="number"
          min={1}
          aria-label={`${label} resolution hours`}
          value={resolution}
          placeholder={String(shown.resolutionHours)}
          onChange={(e) => setResolution(e.target.value)}
        />
        {invalid && (
          <span role="alert" className="mt-1 block text-xs text-red-700">
            Resolution must be at least the first-response time.
          </span>
        )}
      </Td>
      <Td className="whitespace-nowrap text-right">
        <button
          type="button"
          className="btn-primary mr-2"
          disabled={invalid || save.isPending}
          onClick={() =>
            save.mutate({
              projectId: projectId || null,
              priority,
              firstResponseHours: f,
              resolutionHours: r,
            })
          }
          aria-label={`Save ${label}`}
        >
          {override && !policy ? 'Set override' : 'Save'}
        </button>
        {override && policy && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => remove.mutate(policy.id)}
            aria-label={`Remove ${label} override`}
          >
            Use global
          </button>
        )}
        {override && !policy && <span className="ml-2 text-xs text-slate-500">uses global</span>}
      </Td>
    </tr>
  );
}

// ───────────── general ─────────────
function GeneralSection() {
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => api('/admin/settings') });
  if (q.isLoading)
    return (
      <p role="status" className="text-slate-500">
        Loading…
      </p>
    );
  if (q.isError) return <Alert type="error">{q.error.message}</Alert>;
  return <GeneralForm settings={q.data.settings} />;
}

function GeneralForm({ settings }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: settings });
  const save = useAdminMutation((body) => api('/admin/settings', { method: 'PATCH', body }), {
    invalidate: ['admin-settings', 'faq-config'],
    success: 'Settings saved',
  });
  const num = (min, max) => ({
    valueAsNumber: true,
    required: 'Required',
    min: { value: min, message: `At least ${min}` },
    max: { value: max, message: `At most ${max}` },
    validate: (v) => Number.isInteger(v) || 'Whole numbers only',
  });
  return (
    <form
      noValidate
      onSubmit={handleSubmit((v) =>
        save.mutate({
          reopenWindowDays: v.reopenWindowDays,
          autoCloseAfterDays: v.autoCloseAfterDays,
          feedbackEditWindowHours: v.feedbackEditWindowHours,
          faqRequireApproval: v.faqRequireApproval,
        }),
      )}
      className="card max-w-md space-y-4"
      aria-label="General settings"
    >
      <Field
        label="Customers can reopen a resolved ticket for (days)"
        error={errors.reopenWindowDays?.message}
      >
        <input type="number" className="input" {...register('reopenWindowDays', num(1, 90))} />
      </Field>
      <Field
        label="Resolved tickets close automatically after (days)"
        error={errors.autoCloseAfterDays?.message}
      >
        <input type="number" className="input" {...register('autoCloseAfterDays', num(1, 90))} />
      </Field>
      <Field
        label="Customers can edit their rating for (hours)"
        error={errors.feedbackEditWindowHours?.message}
      >
        <input
          type="number"
          className="input"
          {...register('feedbackEditWindowHours', num(1, 168))}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...register('faqRequireApproval')} /> Require administrator approval
        before support staff publish FAQ articles
      </label>
      <button type="submit" className="btn-primary" disabled={save.isPending}>
        Save settings
      </button>
    </form>
  );
}

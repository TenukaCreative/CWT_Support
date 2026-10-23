import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import { fmtDate, useDebounced, useList } from '../../lib/query.js';
import Field from '../../components/Field.jsx';
import Alert from '../../components/Alert.jsx';
import ProjectCheckboxes, { OrgSelect } from '../../components/ProjectCheckboxes.jsx';
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
import { emailRules } from '../validation.js';

export default function UsersPage() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null); // { type, user? }
  const search = useDebounced(q);
  const list = useList('users', '/admin/users', {
    q: search,
    role,
    status,
    page,
    limit: 15,
    sort: 'name',
    dir: 'asc',
  });
  const close = () => setDialog(null);

  const statusMutation = useAdminMutation(
    ({ id, action }) => api(`/admin/users/${id}/${action}`, { method: 'POST' }),
    {
      invalidate: ['users'],
      success: (_d, v) =>
        ({
          deactivate: 'User deactivated',
          reactivate: 'User reactivated',
          unlock: 'User unlocked',
        })[v.action],
      onSuccess: close,
    },
  );
  const reset = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  return (
    <div className="space-y-10">
      <div>
        <PageHeader title="Users" subtitle="Everyone who can sign in.">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setDialog({ type: 'invite' })}
          >
            Invite user
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setDialog({ type: 'create' })}
          >
            Create user
          </button>
        </PageHeader>
        <FilterBar>
          <FilterField label="Search">
            <input className="input" value={q} onChange={reset(setQ)} placeholder="Name or email" />
          </FilterField>
          <FilterField label="Role">
            <select className="input" value={role} onChange={reset(setRole)}>
              <option value="">All</option>
              <option value="ADMIN">Admin</option>
              <option value="SUPPORT">Support</option>
              <option value="CUSTOMER">Customer</option>
            </select>
          </FilterField>
          <FilterField label="Status">
            <select className="input" value={status} onChange={reset(setStatus)}>
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING">Pending</option>
              <option value="DEACTIVATED">Deactivated</option>
            </select>
          </FilterField>
        </FilterBar>

        <QueryState query={list} emptyText="No users match.">
          {(data) => (
            <>
              <TableWrap label="Users">
                <thead>
                  <tr>
                    <Th>User</Th>
                    <Th>Role</Th>
                    <Th>Organization</Th>
                    <Th>Projects</Th>
                    <Th>Status</Th>
                    <Th>Last login</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((u) => {
                    const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
                    return (
                      <tr key={u.id}>
                        <Td>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-slate-500">{u.email}</div>
                        </Td>
                        <Td>
                          <Badge value={u.role} />
                        </Td>
                        <Td>{u.organization?.name ?? '—'}</Td>
                        <Td>
                          {u.role === 'ADMIN'
                            ? 'All'
                            : u.projects.map((p) => p.key).join(', ') || '—'}
                        </Td>
                        <Td>
                          <Badge value={u.status} />
                          {locked && <span className="ml-1 text-xs text-red-700">locked</span>}
                        </Td>
                        <Td>{fmtDate(u.lastLoginAt)}</Td>
                        <Td className="whitespace-nowrap text-right">
                          <button
                            type="button"
                            className="btn-secondary mr-2"
                            aria-label={`Edit ${u.name}`}
                            onClick={() => setDialog({ type: 'edit', user: u })}
                          >
                            Edit
                          </button>
                          {u.role !== 'ADMIN' && u.status !== 'PENDING' && (
                            <button
                              type="button"
                              className="btn-secondary mr-2"
                              aria-label={`Projects for ${u.name}`}
                              onClick={() => setDialog({ type: 'projects', user: u })}
                            >
                              Projects
                            </button>
                          )}
                          {locked && (
                            <button
                              type="button"
                              className="btn-secondary mr-2"
                              aria-label={`Unlock ${u.name}`}
                              onClick={() => statusMutation.mutate({ id: u.id, action: 'unlock' })}
                            >
                              Unlock
                            </button>
                          )}
                          {u.status === 'DEACTIVATED' ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              aria-label={`Reactivate ${u.name}`}
                              onClick={() =>
                                statusMutation.mutate({ id: u.id, action: 'reactivate' })
                              }
                            >
                              Reactivate
                            </button>
                          ) : u.id !== me.id && u.status === 'ACTIVE' ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              aria-label={`Deactivate ${u.name}`}
                              onClick={() => setDialog({ type: 'deactivate', user: u })}
                            >
                              Deactivate
                            </button>
                          ) : null}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
              <Pagination data={data} onPage={setPage} />
            </>
          )}
        </QueryState>
      </div>

      <Invitations />

      {dialog?.type === 'create' && <NewUserForm mode="create" onClose={close} />}
      {dialog?.type === 'invite' && <NewUserForm mode="invite" onClose={close} />}
      {dialog?.type === 'edit' && <EditUser user={dialog.user} onClose={close} />}
      {dialog?.type === 'projects' && <UserProjects user={dialog.user} onClose={close} />}
      {dialog?.type === 'deactivate' && (
        <ConfirmDialog
          title={`Deactivate ${dialog.user.name}?`}
          confirmLabel="Deactivate"
          danger
          busy={statusMutation.isPending}
          onClose={close}
          onConfirm={() => statusMutation.mutate({ id: dialog.user.id, action: 'deactivate' })}
        >
          They are signed out immediately and cannot log in until reactivated.
        </ConfirmDialog>
      )}
    </div>
  );
}

function NewUserForm({ mode, onClose }) {
  const isInvite = mode === 'invite';
  const [projectIds, setProjectIds] = useState([]);
  const [serverError, setServerError] = useState(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({ defaultValues: { name: '', email: '', role: 'CUSTOMER', organizationId: '' } });
  const role = watch('role');
  const organizationId = watch('organizationId');
  register('organizationId', {
    validate: (v) => role !== 'CUSTOMER' || !!v || 'Choose an organization',
  });

  const save = useAdminMutation(
    (body) => api(isInvite ? '/admin/invitations' : '/admin/users', { method: 'POST', body }),
    {
      invalidate: ['users', 'invitations'],
      success: isInvite ? 'Invitation sent' : 'User created. A password-setup email was sent.',
      onSuccess: onClose,
    },
  );
  const submit = (v) => {
    setServerError(null);
    const body = {
      email: v.email,
      role: v.role,
      projectIds: v.role === 'ADMIN' ? [] : projectIds,
      ...(v.role === 'CUSTOMER' ? { organizationId: v.organizationId } : {}),
      ...(isInvite ? {} : { name: v.name }),
    };
    save.mutate(body, { onError: (e) => setServerError(e.details?.[0]?.message ?? e.message) });
  };

  return (
    <Modal title={isInvite ? 'Invite a user' : 'Create a user'} onClose={onClose} wide>
      <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
        {serverError && <Alert type="error">{serverError}</Alert>}
        {!isInvite && (
          <Field label="Name" error={errors.name?.message}>
            <input className="input" {...register('name', { required: 'Name is required' })} />
          </Field>
        )}
        <Field label="Email" error={errors.email?.message}>
          <input type="email" className="input" {...register('email', emailRules)} />
        </Field>
        <Field label="Role">
          <select
            className="input"
            {...register('role', {
              onChange: () => {
                setProjectIds([]);
                setValue('organizationId', '');
              },
            })}
          >
            <option value="CUSTOMER">Customer</option>
            <option value="SUPPORT">Support</option>
            <option value="ADMIN">Admin</option>
          </select>
        </Field>
        {role === 'CUSTOMER' && (
          <Field label="Organization" error={errors.organizationId?.message}>
            <OrgSelect
              value={organizationId}
              onChange={(v) => {
                setValue('organizationId', v, { shouldValidate: true });
                setProjectIds([]);
              }}
            />
          </Field>
        )}
        {role !== 'ADMIN' && (role === 'SUPPORT' || organizationId) && (
          <ProjectCheckboxes
            key={`${role}-${organizationId}`}
            organizationId={role === 'CUSTOMER' ? organizationId : undefined}
            value={projectIds}
            onChange={setProjectIds}
          />
        )}
        <p className="text-xs text-slate-500">
          {isInvite
            ? 'They receive a link (valid 7 days) to choose their own name and password.'
            : 'They receive a link (valid 72 hours) to set their own password.'}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            {isInvite ? 'Send invitation' : 'Create user'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditUser({ user, onClose }) {
  const [serverError, setServerError] = useState(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: user.name,
      role: user.role,
      organizationId: user.organization?.id ?? '',
    },
  });
  const role = watch('role');
  const organizationId = watch('organizationId');
  register('organizationId');
  const sensitive =
    role !== user.role || (role === 'CUSTOMER' && organizationId !== (user.organization?.id ?? ''));

  const save = useAdminMutation(
    (body) => api(`/admin/users/${user.id}`, { method: 'PATCH', body }),
    { invalidate: ['users'], success: 'User saved', onSuccess: onClose },
  );
  const submit = (v) => {
    setServerError(null);
    const body = {
      name: v.name,
      role: v.role,
      ...(v.role === 'CUSTOMER' ? { organizationId: v.organizationId || null } : {}),
    };
    save.mutate(body, { onError: (e) => setServerError(e.details?.[0]?.message ?? e.message) });
  };

  return (
    <Modal title={`Edit ${user.name}`} onClose={onClose}>
      <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
        {serverError && <Alert type="error">{serverError}</Alert>}
        <Field label="Email">
          <input className="input bg-slate-100" value={user.email} readOnly />
        </Field>
        <Field label="Name" error={errors.name?.message}>
          <input className="input" {...register('name', { required: 'Name is required' })} />
        </Field>
        <Field label="Role">
          <select className="input" {...register('role')}>
            <option value="CUSTOMER">Customer</option>
            <option value="SUPPORT">Support</option>
            <option value="ADMIN">Admin</option>
          </select>
        </Field>
        {role === 'CUSTOMER' && (
          <Field label="Organization">
            <OrgSelect value={organizationId} onChange={(v) => setValue('organizationId', v)} />
          </Field>
        )}
        {sensitive && (
          <Alert type="info">
            Changing the role or organization removes this user&apos;s project access and signs them
            out.
          </Alert>
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

function UserProjects({ user, onClose }) {
  const [projectIds, setProjectIds] = useState(user.projects.map((p) => p.id));
  const save = useAdminMutation(
    (ids) => api(`/admin/users/${user.id}/projects`, { method: 'PUT', body: { projectIds: ids } }),
    {
      invalidate: ['users', 'projects', 'project'],
      success: 'Projects updated',
      onSuccess: onClose,
    },
  );
  return (
    <Modal title={`Projects for ${user.name}`} onClose={onClose}>
      <ProjectCheckboxes
        organizationId={user.role === 'CUSTOMER' ? user.organization?.id : undefined}
        value={projectIds}
        onChange={setProjectIds}
      />
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={save.isPending}
          onClick={() => save.mutate(projectIds)}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

function Invitations() {
  const [page, setPage] = useState(1);
  const [revoking, setRevoking] = useState(null);
  const list = useList('invitations', '/admin/invitations', {
    page,
    limit: 10,
    sort: 'createdAt',
    dir: 'desc',
  });
  const revoke = useAdminMutation((id) => api(`/admin/invitations/${id}`, { method: 'DELETE' }), {
    invalidate: ['invitations'],
    success: 'Invitation revoked',
    onSuccess: () => setRevoking(null),
  });

  return (
    <section aria-labelledby="inv-h">
      <h2 id="inv-h" className="mb-2 text-lg font-semibold">
        Pending invitations
      </h2>
      <QueryState query={list} emptyText="No open invitations.">
        {(data) => (
          <>
            <TableWrap label="Pending invitations">
              <thead>
                <tr>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Organization</Th>
                  <Th>Projects</Th>
                  <Th>Invited by</Th>
                  <Th>Expires</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((i) => (
                  <tr key={i.id}>
                    <Td>{i.email}</Td>
                    <Td>
                      <Badge value={i.role} />
                    </Td>
                    <Td>{i.organization?.name ?? '—'}</Td>
                    <Td>{i.projects.map((p) => p.key).join(', ') || '—'}</Td>
                    <Td>{i.invitedBy.name}</Td>
                    <Td>{fmtDate(i.expiresAt)}</Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        className="btn-secondary"
                        aria-label={`Revoke invitation for ${i.email}`}
                        onClick={() => setRevoking(i)}
                      >
                        Revoke
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
      {revoking && (
        <ConfirmDialog
          title="Revoke invitation?"
          confirmLabel="Revoke"
          danger
          busy={revoke.isPending}
          onClose={() => setRevoking(null)}
          onConfirm={() => revoke.mutate(revoking.id)}
        >
          The link sent to {revoking.email} will stop working.
        </ConfirmDialog>
      )}
    </section>
  );
}

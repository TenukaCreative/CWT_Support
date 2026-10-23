import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAdminMutation } from '../../lib/useAdminMutation.js';
import Field from '../../components/Field.jsx';
import Alert from '../../components/Alert.jsx';
import {
  Badge,
  ConfirmDialog,
  Modal,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from '../../components/ui.jsx';

const SCOPE_LABEL = { GLOBAL: 'Everyone', PROJECT: 'Project', PERSONAL: 'Only me' };

export default function CannedRepliesPage() {
  const { user } = useAuth();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const q = useQuery({ queryKey: ['canned-replies'], queryFn: () => api('/canned-replies') });
  const remove = useAdminMutation((id) => api(`/canned-replies/${id}`, { method: 'DELETE' }), {
    invalidate: ['canned-replies'],
    success: 'Reply deleted',
    onSuccess: () => setDeleting(null),
  });
  const editable = (r) =>
    r.scope === 'PERSONAL'
      ? r.ownerId === user.id
      : r.scope === 'GLOBAL'
        ? user.role === 'ADMIN'
        : true;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Canned replies" subtitle="Reusable answers you can insert into a reply.">
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          New reply
        </button>
      </PageHeader>
      {q.isLoading && (
        <p role="status" className="text-slate-500">
          Loading…
        </p>
      )}
      {q.isError && <Alert type="error">{q.error.message}</Alert>}
      {q.data?.replies.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 py-10 text-center text-slate-500">
          No canned replies yet.
        </p>
      )}
      {q.data?.replies.length > 0 && (
        <TableWrap label="Canned replies">
          <thead>
            <tr>
              <Th>Title</Th>
              <Th>Available to</Th>
              <Th>Preview</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.replies.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.title}</Td>
                <Td>
                  <Badge
                    value="CUSTOMER"
                    label={
                      r.scope === 'PROJECT'
                        ? `Project ${r.project?.key ?? ''}`
                        : SCOPE_LABEL[r.scope]
                    }
                  />
                </Td>
                <Td className="max-w-md truncate text-slate-600">{r.body}</Td>
                <Td className="whitespace-nowrap text-right">
                  {editable(r) ? (
                    <>
                      <button
                        type="button"
                        className="btn-secondary mr-2"
                        aria-label={`Edit ${r.title}`}
                        onClick={() => setEditing(r)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        aria-label={`Delete ${r.title}`}
                        onClick={() => setDeleting(r)}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {editing && (
        <ReplyForm reply={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id)}
        >
          This reply will no longer be available to the people it was shared with.
        </ConfirmDialog>
      )}
    </div>
  );
}

function ReplyForm({ reply, onClose }) {
  const { user, projects, activeProjectId } = useAuth();
  const [serverError, setServerError] = useState(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      title: reply?.title ?? '',
      body: reply?.body ?? '',
      scope: reply?.scope ?? 'PERSONAL',
      projectId:
        reply?.projectId ??
        projects.find((p) => p.id === activeProjectId)?.id ??
        projects[0]?.id ??
        '',
    },
  });
  const scope = watch('scope');
  const save = useAdminMutation(
    (body) =>
      api(reply ? `/canned-replies/${reply.id}` : '/canned-replies', {
        method: reply ? 'PATCH' : 'POST',
        body,
      }),
    {
      invalidate: ['canned-replies'],
      success: reply ? 'Reply saved' : 'Reply created',
      onSuccess: onClose,
    },
  );
  const submit = (v) => {
    setServerError(null);
    const body = reply
      ? { title: v.title, body: v.body }
      : {
          title: v.title,
          body: v.body,
          scope: v.scope,
          ...(v.scope === 'PROJECT' ? { projectId: v.projectId } : {}),
        };
    save.mutate(body, { onError: (e) => setServerError(e.details?.[0]?.message ?? e.message) });
  };

  return (
    <Modal title={reply ? 'Edit canned reply' : 'New canned reply'} onClose={onClose}>
      <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
        {serverError && <Alert type="error">{serverError}</Alert>}
        <Field label="Title" error={errors.title?.message}>
          <input
            className="input"
            {...register('title', { required: 'Title is required', maxLength: 100 })}
          />
        </Field>
        <Field label="Text" error={errors.body?.message}>
          <textarea
            rows={6}
            className="input"
            {...register('body', { required: 'Text is required', maxLength: 5000 })}
          />
        </Field>
        {!reply && (
          <Field label="Available to">
            <select className="input" {...register('scope')}>
              <option value="PERSONAL">Only me</option>
              <option value="PROJECT">Staff of a project</option>
              {user.role === 'ADMIN' && <option value="GLOBAL">All staff</option>}
            </select>
          </Field>
        )}
        {!reply && scope === 'PROJECT' && (
          <Field label="Project">
            <select className="input" {...register('projectId')}>
              {projects.map((p) => (
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

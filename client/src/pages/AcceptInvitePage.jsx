import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import Field from '../components/Field.jsx';
import Alert from '../components/Alert.jsx';
import { passwordRules } from './validation.js';

export default function AcceptInvitePage() {
  const token = useSearchParams()[0].get('token');
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState(null);
  const invite = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api(`/auth/invitations/${encodeURIComponent(token)}`, { skipRefresh: true }),
    enabled: Boolean(token),
    retry: false,
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm();

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      await api('/auth/accept-invite', {
        method: 'POST',
        body: { token, ...values },
        skipRefresh: true,
      });
      setDone(true);
    } catch (err) {
      setServerError(err.details?.[0]?.message ?? err.message);
    }
  };

  let body;
  if (!token) body = <Alert type="error">This link is missing its token.</Alert>;
  else if (invite.isLoading) body = <p role="status">Checking invitation…</p>;
  else if (invite.isError) body = <Alert type="error">{invite.error.message}</Alert>;
  else if (done) {
    body = (
      <div className="space-y-3">
        <Alert type="success">Account created.</Alert>
        <Link to="/login" className="text-sm text-brand-700 underline">
          Log in
        </Link>
      </div>
    );
  } else {
    const i = invite.data;
    body = (
      <>
        <p className="mt-1 text-sm text-slate-600">
          Joining as <strong>{i.email}</strong>
          {i.organization ? ` · ${i.organization}` : ''}
          {i.projects.length > 0 && ` · ${i.projects.map((p) => p.key).join(', ')}`}
        </p>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-4">
          {serverError && <Alert type="error">{serverError}</Alert>}
          <Field label="Full name" error={errors.name?.message}>
            <input
              autoComplete="name"
              className="input"
              {...register('name', { required: 'Name is required' })}
            />
          </Field>
          <Field label="Password" error={errors.password?.message}>
            <input
              type="password"
              autoComplete="new-password"
              className="input"
              {...register('password', passwordRules)}
            />
          </Field>
          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            Create account
          </button>
        </form>
      </>
    );
  }

  return (
    <div className="card mx-auto max-w-sm">
      <h1 className="text-xl font-semibold">Accept your invitation</h1>
      <div className="mt-2">{body}</div>
    </div>
  );
}

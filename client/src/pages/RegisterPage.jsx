import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Field from '../components/Field.jsx';
import Alert from '../components/Alert.jsx';
import { emailRules, passwordRules } from './validation.js';

export default function RegisterPage() {
  const [done, setDone] = useState(null);
  const [serverError, setServerError] = useState(null);
  const orgs = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api('/auth/organizations', { skipRefresh: true }),
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm();

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      const res = await api('/auth/register', { method: 'POST', body: values, skipRefresh: true });
      setDone(res.message);
    } catch (err) {
      setServerError(err.details?.[0]?.message ?? err.message);
    }
  };

  if (done) {
    return (
      <div className="card mx-auto max-w-sm space-y-3">
        <h1 className="text-xl font-semibold">Almost there</h1>
        <Alert type="success">{done}</Alert>
        <Link to="/login" className="text-sm text-brand-700 underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="card mx-auto max-w-sm">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-slate-600">
        For existing clients. An administrator approves new accounts.
      </p>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-4">
        {serverError && <Alert type="error">{serverError}</Alert>}
        {orgs.isError && <Alert type="error">Could not load organisations. Try again later.</Alert>}
        <Field label="Full name" error={errors.name?.message}>
          <input
            autoComplete="name"
            className="input"
            {...register('name', { required: 'Name is required', maxLength: 100 })}
          />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <input
            type="email"
            autoComplete="email"
            className="input"
            {...register('email', emailRules)}
          />
        </Field>
        <Field label="Organisation" error={errors.organizationId?.message}>
          <select
            className="input"
            defaultValue=""
            {...register('organizationId', { required: 'Choose your organisation' })}
          >
            <option value="" disabled>
              {orgs.isLoading ? 'Loading…' : 'Select…'}
            </option>
            {orgs.data?.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Password"
          error={errors.password?.message}
          hint="At least 10 characters, with a letter and a digit."
        >
          <input
            type="password"
            autoComplete="new-password"
            className="input"
            {...register('password', passwordRules)}
          />
        </Field>
        <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
          {isSubmitting ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import Field from '../components/Field.jsx';
import Alert from '../components/Alert.jsx';
import { passwordRules } from './validation.js';

export default function ResetPasswordPage() {
  const token = useSearchParams()[0].get('token');
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm();

  const onSubmit = async ({ password }) => {
    setServerError(null);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, password },
        skipRefresh: true,
      });
      setDone(true);
    } catch (err) {
      setServerError(err.details?.[0]?.message ?? err.message);
    }
  };

  return (
    <div className="card mx-auto max-w-sm">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      {!token && (
        <div className="mt-4">
          <Alert type="error">This link is missing its token.</Alert>
        </div>
      )}
      {done ? (
        <div className="mt-4 space-y-3">
          <Alert type="success">Password updated.</Alert>
          <Link to="/login" className="text-sm text-brand-700 underline">
            Log in
          </Link>
        </div>
      ) : (
        token && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-4">
            {serverError && <Alert type="error">{serverError}</Alert>}
            <Field label="New password" error={errors.password?.message}>
              <input
                type="password"
                autoComplete="new-password"
                className="input"
                {...register('password', passwordRules)}
              />
            </Field>
            <Field label="Confirm new password" error={errors.confirm?.message}>
              <input
                type="password"
                autoComplete="new-password"
                className="input"
                {...register('confirm', {
                  validate: (v) => v === getValues('password') || 'Passwords do not match',
                })}
              />
            </Field>
            <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
              Update password
            </button>
          </form>
        )
      )}
    </div>
  );
}

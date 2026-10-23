import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Field from '../components/Field.jsx';
import Alert from '../components/Alert.jsx';
import { emailRules } from './validation.js';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm();

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: values, skipRefresh: true });
      setSent(true);
    } catch (err) {
      setServerError(err.message);
    }
  };

  return (
    <div className="card mx-auto max-w-sm">
      <h1 className="text-xl font-semibold">Forgot password</h1>
      {sent ? (
        <div className="mt-4">
          <Alert type="success">
            If an account exists for that email, a reset link is on its way.
          </Alert>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-4">
          {serverError && <Alert type="error">{serverError}</Alert>}
          <Field label="Email" error={errors.email?.message}>
            <input
              type="email"
              autoComplete="email"
              className="input"
              {...register('email', emailRules)}
            />
          </Field>
          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            Send reset link
          </button>
        </form>
      )}
      <Link to="/login" className="mt-4 inline-block text-sm text-brand-700 underline">
        Back to log in
      </Link>
    </div>
  );
}

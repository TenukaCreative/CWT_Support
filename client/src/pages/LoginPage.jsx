import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { homeFor } from '../lib/navigation.js';
import Field from '../components/Field.jsx';
import Alert from '../components/Alert.jsx';
import { emailRules } from './validation.js';

export default function LoginPage() {
  const { status, user, login, expired } = useAuth();
  const navigate = useNavigate();
  const from = useLocation().state?.from;
  const [serverError, setServerError] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { email: '', password: '' } });

  if (status === 'authenticated') return <Navigate to={homeFor(user.role)} replace />;

  const onSubmit = async ({ email, password }) => {
    setServerError(null);
    try {
      const session = await login(email, password);
      navigate(
        session.needsProjectSelection ? '/select-project' : (from ?? homeFor(session.user.role)),
        {
          replace: true,
          state: { from },
        },
      );
    } catch (err) {
      setServerError(err.message);
    }
  };

  return (
    <div className="card mx-auto max-w-sm">
      <h1 className="text-xl font-semibold">Log in</h1>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-4">
        {expired && !serverError && (
          <Alert type="info">Your session expired. Please log in again.</Alert>
        )}
        {serverError && <Alert type="error">{serverError}</Alert>}
        <Field label="Email" error={errors.email?.message}>
          <input
            type="email"
            autoComplete="username"
            className="input"
            {...register('email', emailRules)}
          />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <input
            type="password"
            autoComplete="current-password"
            className="input"
            {...register('password', { required: 'Password is required' })}
          />
        </Field>
        <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="mt-4 flex justify-between text-sm">
        <Link to="/forgot-password" className="text-brand-700 underline">
          Forgot password?
        </Link>
        <Link to="/register" className="text-brand-700 underline">
          Create account
        </Link>
      </p>
    </div>
  );
}

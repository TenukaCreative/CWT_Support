import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Field from '../components/Field.jsx';
import Alert from '../components/Alert.jsx';
import { passwordRules } from './validation.js';

const PREFS = [
  ['emailOnReply', 'Email me when someone replies'],
  ['emailOnStatusChange', 'Email me when a ticket status changes'],
  ['emailOnAssignment', 'Email me when a ticket is assigned'],
  ['inApp', 'Show in-app notifications'],
];
const DEFAULT_PREFS = {
  emailOnReply: true,
  emailOnStatusChange: true,
  emailOnAssignment: true,
  inApp: true,
};

export default function ProfilePage() {
  const { user } = useAuth();
  return (
    <div className="max-w-xl space-y-8">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <ProfileForm user={user} />
      <PasswordForm />
    </div>
  );
}

function ProfileForm({ user }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const [error, setError] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      name: user.name,
      notificationPrefs: { ...DEFAULT_PREFS, ...user.notificationPrefs },
    },
  });

  const onSubmit = async (values) => {
    setError(null);
    try {
      const res = await api('/users/me', { method: 'PATCH', body: values });
      setUser(res.user);
      toast.success('Profile saved');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="card space-y-4"
      aria-labelledby="profile-h"
    >
      <h2 id="profile-h" className="font-medium">
        Your details
      </h2>
      {error && <Alert type="error">{error}</Alert>}
      <Field label="Email">
        <input className="input bg-slate-100" value={user.email} readOnly />
      </Field>
      {user.organization && (
        <Field label="Organisation">
          <input className="input bg-slate-100" value={user.organization.name} readOnly />
        </Field>
      )}
      <Field label="Name" error={errors.name?.message}>
        <input
          className="input"
          {...register('name', { required: 'Name is required', maxLength: 100 })}
        />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">Notifications</legend>
        {PREFS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register(`notificationPrefs.${key}`)} /> {label}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={isSubmitting} className="btn-primary">
        Save changes
      </button>
    </form>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [error, setError] = useState(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm();

  const onSubmit = async (values) => {
    setError(null);
    try {
      await api('/users/me/password', { method: 'POST', body: values });
      reset();
      toast.success('Password changed. Other devices were signed out.');
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="card space-y-4"
      aria-labelledby="pw-h"
    >
      <h2 id="pw-h" className="font-medium">
        Change password
      </h2>
      {error && <Alert type="error">{error}</Alert>}
      <Field label="Current password" error={errors.currentPassword?.message}>
        <input
          type="password"
          autoComplete="current-password"
          className="input"
          {...register('currentPassword', { required: 'Required' })}
        />
      </Field>
      <Field label="New password" error={errors.newPassword?.message}>
        <input
          type="password"
          autoComplete="new-password"
          className="input"
          {...register('newPassword', passwordRules)}
        />
      </Field>
      <button type="submit" disabled={isSubmitting} className="btn-primary">
        Change password
      </button>
    </form>
  );
}

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { homeFor } from '../lib/navigation.js';
import Alert from '../components/Alert.jsx';

export default function ProjectPickerPage() {
  const { user, projects, lastProjectId, selectProject, logout } = useAuth();
  const navigate = useNavigate();
  const from = useLocation().state?.from;
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const canSeeAll = user.role !== 'CUSTOMER' && projects.length > 0;

  const choose = async (projectId) => {
    setError(null);
    setBusy(projectId);
    try {
      await selectProject(projectId);
      qc.clear();
      navigate(from && from !== '/select-project' ? from : homeFor(user.role), { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  };

  if (projects.length === 0) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-xl font-semibold">No projects yet</h1>
        <p className="mt-2 text-slate-600">
          Your account is not linked to any project. Ask an administrator to add you to one.
        </p>
        <button type="button" onClick={logout} className="btn-secondary mt-4">
          Log out
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Choose a project</h1>
      <p className="mt-1 text-slate-600">You can switch later from the header.</p>
      {error && (
        <div className="mt-4">
          <Alert type="error">{error}</Alert>
        </div>
      )}
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {canSeeAll && (
          <li>
            <ProjectCard
              title="All projects"
              subtitle={
                user.role === 'ADMIN'
                  ? 'Everything across all organisations'
                  : 'Everything assigned to you'
              }
              onClick={() => choose('ALL')}
              disabled={busy !== null}
              highlighted={lastProjectId === 'ALL'}
            />
          </li>
        )}
        {projects.map((p) => (
          <li key={p.id}>
            <ProjectCard
              title={p.name}
              subtitle={`${p.organization.name} · ${p.key}`}
              onClick={() => choose(p.id)}
              disabled={busy !== null}
              highlighted={lastProjectId === p.id}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectCard({ title, subtitle, onClick, disabled, highlighted }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`card w-full text-left hover:border-brand-500 disabled:opacity-60 ${highlighted ? 'border-brand-500 ring-1 ring-brand-500' : ''}`}
    >
      <span className="block font-medium">{title}</span>
      <span className="block text-sm text-slate-600">{subtitle}</span>
      {highlighted && <span className="mt-2 inline-block text-xs text-brand-700">Last used</span>}
    </button>
  );
}

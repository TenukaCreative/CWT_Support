import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function ProjectSwitcher() {
  const { user, projects, activeProjectId, selectProject } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canSeeAll = user.role !== 'CUSTOMER' && projects.length > 0;

  if (projects.length === 0) return <span className="text-slate-500">No projects assigned</span>;

  const onChange = async (e) => {
    try {
      await selectProject(e.target.value);
      qc.clear(); // cached data belongs to the previous project
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <label className="flex items-center gap-2">
      <span className="text-slate-500">Project</span>
      <select
        value={activeProjectId ?? ''}
        onChange={onChange}
        className="rounded border border-slate-300 bg-white px-2 py-1"
      >
        {canSeeAll && <option value="ALL">All projects</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.key})
          </option>
        ))}
      </select>
    </label>
  );
}

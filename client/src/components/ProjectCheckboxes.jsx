import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { qs } from '../lib/query.js';

// Pick projects. organizationId limits the list to one client's projects (customers can only
// join their own organization's projects; the server enforces the same rule).
export default function ProjectCheckboxes({
  organizationId,
  value,
  onChange,
  legend = 'Projects',
}) {
  const q = useQuery({
    queryKey: ['project-options', organizationId ?? 'all'],
    queryFn: () =>
      api(
        `/admin/projects${qs({ status: 'ACTIVE', limit: 100, sort: 'key', dir: 'asc', organizationId })}`,
      ),
  });
  const toggle = (id) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-slate-700">{legend}</legend>
      {q.isLoading && <p className="text-sm text-slate-500">Loading projects…</p>}
      {q.isError && <p className="text-sm text-red-700">Could not load projects.</p>}
      {q.data?.items.length === 0 && (
        <p className="text-sm text-slate-500">No active projects available.</p>
      )}
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
        {q.data?.items.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
            <span>
              {p.name}{' '}
              <span className="text-slate-500">
                ({p.key}
                {organizationId ? '' : ` · ${p.organization.name}`})
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function OrgSelect({ value, onChange, includeAll = false, ...rest }) {
  const q = useQuery({
    queryKey: ['org-options'],
    queryFn: () =>
      api(`/admin/organizations${qs({ status: 'ACTIVE', limit: 100, sort: 'name', dir: 'asc' })}`),
  });
  return (
    <select
      className="input"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    >
      <option value="">{includeAll ? 'All organizations' : 'Select…'}</option>
      {q.data?.items.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

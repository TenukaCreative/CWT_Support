import { useState } from 'react';
import { PRESETS, presetRange } from '../lib/useReport.js';
import { FilterBar, FilterField } from './ui.jsx';

// ONE filter row above everything it scopes (a dashboard rule): every chart and table below
// re-queries against the same slice.
export function useReportFilters(defaultDays = '30') {
  const [preset, setPreset] = useState(defaultDays);
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [projectId, setProjectId] = useState('');
  const range = preset === 'custom' ? custom : presetRange(Number(preset));
  const valid =
    preset !== 'custom' || Boolean(custom.from && custom.to && custom.from <= custom.to); // must be a real boolean (React Query's `enabled`)
  const params = { ...(valid ? range : presetRange(30)), projectId: projectId || undefined };
  return { preset, setPreset, custom, setCustom, projectId, setProjectId, params, valid };
}

export default function ReportFilters({ filters, projects, children }) {
  const { preset, setPreset, custom, setCustom, projectId, setProjectId, valid } = filters;
  return (
    <FilterBar>
      <FilterField label="Period">
        <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </FilterField>
      {preset === 'custom' && (
        <>
          <FilterField label="From">
            <input
              type="date"
              className="input"
              value={custom.from}
              onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            />
          </FilterField>
          <FilterField label="To">
            <input
              type="date"
              className="input"
              value={custom.to}
              onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            />
          </FilterField>
          {!valid && (
            <span role="alert" className="pb-2 text-xs text-red-700">
              Choose a start date that is not after the end date.
            </span>
          )}
        </>
      )}
      {projects && projects.length > 1 && (
        <FilterField label="Project">
          <select
            className="input"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All in view</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key}
              </option>
            ))}
          </select>
        </FilterField>
      )}
      {children}
    </FilterBar>
  );
}

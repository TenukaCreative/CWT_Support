import { Link } from 'react-router-dom';

// A clickable number with a label: the "at a glance" row on dashboards. `attention` highlights
// something the person needs to act on.
export default function StatTile({ label, value, to, attention = false }) {
  return (
    <Link
      to={to}
      className={`card block p-4 transition hover:border-brand-500 ${
        attention ? 'border-amber-300 bg-amber-50' : ''
      }`}
    >
      <span className="block text-sm text-slate-500">{label}</span>
      <span className="mt-1 block text-3xl font-semibold text-slate-900">{value ?? '–'}</span>
    </Link>
  );
}

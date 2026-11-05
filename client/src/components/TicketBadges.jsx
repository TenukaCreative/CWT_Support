import { PRIORITY_LABELS, STATUS_LABELS } from '../lib/tickets.js';

const STATUS_STYLE = {
  OPEN: 'bg-sky-100 text-sky-800',
  IN_PROGRESS: 'bg-indigo-100 text-indigo-800',
  WAITING_ON_CUSTOMER: 'bg-amber-100 text-amber-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-slate-200 text-slate-700',
  REOPENED: 'bg-rose-100 text-rose-800',
};
export const PriorityBadge = ({ priority }) => (
  <span className={`${pill} ${PRIORITY_STYLE[priority]}`}>{PRIORITY_LABELS[priority]}</span>
);

const PRIORITY_STYLE = {
  LOW: 'bg-slate-100 text-slate-700',
  MEDIUM: 'bg-sky-50 text-sky-800',
  HIGH: 'bg-orange-100 text-orange-800',
  URGENT: 'bg-red-100 text-red-800',
};

const pill =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium';
const DOT = {
  OPEN: 'bg-sky-500',
  IN_PROGRESS: 'bg-indigo-500',
  WAITING_ON_CUSTOMER: 'bg-amber-500',
  RESOLVED: 'bg-emerald-500',
  CLOSED: 'bg-slate-400',
  REOPENED: 'bg-rose-500',
};
export const StatusBadge = ({ status }) => (
  <span className={`${pill} ${STATUS_STYLE[status]}`}>
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} />
    {STATUS_LABELS[status]}
  </span>
);

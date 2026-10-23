import { PRIORITY_LABELS, STATUS_LABELS } from '../lib/tickets.js';

const STATUS_STYLE = {
  OPEN: 'bg-sky-100 text-sky-800',
  IN_PROGRESS: 'bg-indigo-100 text-indigo-800',
  WAITING_ON_CUSTOMER: 'bg-amber-100 text-amber-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-slate-200 text-slate-700',
  REOPENED: 'bg-rose-100 text-rose-800',
};
const PRIORITY_STYLE = {
  LOW: 'bg-slate-100 text-slate-700',
  MEDIUM: 'bg-sky-50 text-sky-800',
  HIGH: 'bg-orange-100 text-orange-800',
  URGENT: 'bg-red-100 text-red-800',
};

const pill = 'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium';
export const StatusBadge = ({ status }) => (
  <span className={`${pill} ${STATUS_STYLE[status]}`}>{STATUS_LABELS[status]}</span>
);
export const PriorityBadge = ({ priority }) => (
  <span className={`${pill} ${PRIORITY_STYLE[priority]}`}>{PRIORITY_LABELS[priority]}</span>
);

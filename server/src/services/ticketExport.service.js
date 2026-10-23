import { AppError } from '../lib/errors.js';
import { csvRow } from '../lib/csv.js';
import { slaState } from '../lib/sla.js';
import { env } from '../config/env.js';
import { buildTicketWhere } from './ticket.service.js';
import { audit } from './audit.service.js';

// Staff-only CSV of tickets. Always read through the scoped client, so a support agent can only
// ever export tickets of their own projects. Internal notes, message bodies and feedback
// COMMENTS are deliberately not included; the rating is.
const COLUMNS = [
  'Ticket',
  'Project',
  'Subject',
  'Status',
  'Priority',
  'Category',
  'Raised by',
  'Customer email',
  'Organization',
  'Assignee',
  'Created (UTC)',
  'First response (UTC)',
  'Resolved (UTC)',
  'Closed (UTC)',
  'First response (hours)',
  'Resolution (hours, excl. waiting on customer)',
  'First response SLA',
  'Resolution SLA',
  'Rating',
  'Merged into',
];
const BATCH = 500;
const hours = (a, b, minusSeconds = 0) =>
  a && b ? Math.max(0, Math.round(((b - a) / 3600000 - minusSeconds / 3600) * 100) / 100) : '';
const verdict = (state) =>
  ({
    MET: 'Met',
    MET_LATE: 'Missed',
    BREACHED: 'Missed',
    PAUSED: 'Paused',
    OK: 'Pending',
    WARNING: 'Pending',
  })[state] ?? '';

const include = {
  project: { select: { key: true } },
  category: { select: { name: true } },
  createdBy: { select: { name: true, email: true, organization: { select: { name: true } } } },
  assignee: { select: { name: true } },
  mergedInto: { select: { number: true } },
  feedback: { select: { rating: true } },
};

export const header = () => csvRow(COLUMNS);

const toRow = (t) => {
  const sla = slaState(t);
  return csvRow([
    t.number,
    t.project.key,
    t.subject,
    t.status,
    t.priority,
    t.category?.name,
    t.createdBy.name,
    t.createdBy.email,
    t.createdBy.organization?.name,
    t.assignee?.name,
    t.createdAt,
    t.firstResponseAt,
    t.resolvedAt,
    t.closedAt,
    hours(t.createdAt, t.firstResponseAt),
    hours(t.createdAt, t.resolvedAt, t.slaPausedSeconds),
    verdict(sla.firstResponse.state),
    verdict(sla.resolution.state),
    t.feedback?.rating,
    t.mergedInto?.number,
  ]);
};

// Fails BEFORE any bytes are sent, so the client gets a normal JSON error instead of a truncated file.
export async function prepareExport({ db, user }, query) {
  const where = buildTicketWhere(user, query);
  const count = await db.ticket.count({ where });
  if (count > env.EXPORT_MAX_ROWS) {
    throw new AppError(
      413,
      'EXPORT_TOO_LARGE',
      `This export has ${count} tickets; the limit is ${env.EXPORT_MAX_ROWS}. Narrow it with filters or a date range.`,
    );
  }
  return { where, count };
}

// Keyset pagination in batches: constant memory however many rows there are.
export async function* exportChunks({ db }, where) {
  let cursor;
  for (;;) {
    const rows = await db.ticket.findMany({
      where,
      include,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return;
    yield rows.map(toRow).join('');
    cursor = rows[rows.length - 1].id;
    if (rows.length < BATCH) return;
  }
}

export const auditExport = (user, filters, rows) =>
  audit(user.id, 'tickets.export', 'Ticket', null, { filters, rows });

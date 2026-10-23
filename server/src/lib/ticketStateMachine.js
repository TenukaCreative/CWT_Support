import { AppError } from './errors.js';

// The ONLY place that knows which status changes are legal. Pure (no DB), so it is unit-tested
// exhaustively; services call assertTransition() and never compare statuses ad hoc.
//
//   OPEN -> IN_PROGRESS <-> WAITING_ON_CUSTOMER -> RESOLVED -> CLOSED
//                                   RESOLVED -> REOPENED -> IN_PROGRESS ...
//
// Actors: STAFF (support + admin), CUSTOMER (the person who raised the ticket), SYSTEM (side
// effects of other actions: replies, merges, the auto-close job).
export const STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
];

const TABLES = {
  STAFF: {
    OPEN: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'],
    IN_PROGRESS: ['WAITING_ON_CUSTOMER', 'RESOLVED'],
    WAITING_ON_CUSTOMER: ['IN_PROGRESS', 'RESOLVED'],
    REOPENED: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'],
    RESOLVED: ['REOPENED', 'CLOSED'],
    CLOSED: [], // terminal
  },
  // Customers can close their own ticket at any point, and reopen a resolved one (window is
  // checked by the service because it depends on time and settings).
  CUSTOMER: {
    OPEN: ['CLOSED'],
    IN_PROGRESS: ['CLOSED'],
    WAITING_ON_CUSTOMER: ['CLOSED'],
    REOPENED: ['CLOSED'],
    RESOLVED: ['REOPENED', 'CLOSED'],
    CLOSED: [],
  },
  SYSTEM: {
    OPEN: ['IN_PROGRESS', 'CLOSED'], // staff replied / merged away
    REOPENED: ['IN_PROGRESS', 'CLOSED'],
    WAITING_ON_CUSTOMER: ['IN_PROGRESS', 'CLOSED'], // customer replied
    IN_PROGRESS: ['CLOSED'],
    RESOLVED: ['CLOSED'], // auto-close after N days
    CLOSED: [],
  },
};

export const actorKind = (role) =>
  role === 'CUSTOMER' ? 'CUSTOMER' : role === 'SYSTEM' ? 'SYSTEM' : 'STAFF';

export const allowedTransitions = (from, role) => TABLES[actorKind(role)][from] ?? [];
export const canTransition = (from, to, role) => allowedTransitions(from, role).includes(to);

export function assertTransition(from, to, role) {
  if (!canTransition(from, to, role)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A ticket cannot move from ${from} to ${to}`, {
      from,
      to,
    });
  }
}

export const isOpenStatus = (s) => s !== 'CLOSED' && s !== 'RESOLVED';

export const STATUS_LABELS = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CUSTOMER: 'Waiting on customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
};

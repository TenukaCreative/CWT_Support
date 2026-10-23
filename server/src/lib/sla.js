// SLA maths. Pure functions (no DB, no clock except the `now` argument) so every rule is unit-tested.
//
// Model: each ticket stores ABSOLUTE due dates (firstResponseDueAt, resolutionDueAt).
//  - While the ticket is WAITING_ON_CUSTOMER the clock is paused (slaPausedAt = when it paused).
//  - On leaving that status, both due dates are pushed out by the paused duration and the total
//    is accumulated in slaPausedSeconds (kept for reporting).
//  - Changing priority recomputes the due dates from createdAt with the new targets (+ pauses so far).
export const HOUR = 3_600_000;
export const WARNING_FRACTION = 0.25; // warn when 25% (or less) of the time window remains

// Used only when neither a project override nor a global policy row exists.
export const DEFAULT_SLA = {
  URGENT: { firstResponseHours: 1, resolutionHours: 4 },
  HIGH: { firstResponseHours: 4, resolutionHours: 8 },
  MEDIUM: { firstResponseHours: 8, resolutionHours: 24 },
  LOW: { firstResponseHours: 24, resolutionHours: 72 },
};

export function computeDueDates(createdAt, policy, pausedSeconds = 0) {
  const start = new Date(createdAt).getTime() + pausedSeconds * 1000;
  return {
    firstResponseDueAt: new Date(start + policy.firstResponseHours * HOUR),
    resolutionDueAt: new Date(start + policy.resolutionHours * HOUR),
  };
}

// Fields to merge into a ticket update when its status changes to `to`.
export function slaPatchForTransition(ticket, to, now = new Date()) {
  const patch = {};
  if (ticket.slaPausedAt && to !== 'WAITING_ON_CUSTOMER') {
    const ms = now.getTime() - new Date(ticket.slaPausedAt).getTime();
    patch.slaPausedAt = null;
    patch.slaPausedSeconds = (ticket.slaPausedSeconds ?? 0) + Math.round(ms / 1000);
    if (ticket.resolutionDueAt)
      patch.resolutionDueAt = new Date(new Date(ticket.resolutionDueAt).getTime() + ms);
    // A first response that already happened is a fact; only a pending one is extended.
    if (ticket.firstResponseDueAt && !ticket.firstResponseAt) {
      patch.firstResponseDueAt = new Date(new Date(ticket.firstResponseDueAt).getTime() + ms);
    }
  } else if (!ticket.slaPausedAt && to === 'WAITING_ON_CUSTOMER') {
    patch.slaPausedAt = now;
  }
  return patch;
}

// state: NONE | MET | MET_LATE | PAUSED | OK | WARNING | BREACHED
function clock({ dueAt, doneAt, stopped, pausedAt, createdAt, pausedSeconds }, now) {
  if (!dueAt) return { state: 'NONE', dueAt: null, remainingMs: null };
  const due = new Date(dueAt).getTime();
  if (doneAt)
    return {
      state: new Date(doneAt).getTime() <= due ? 'MET' : 'MET_LATE',
      dueAt,
      remainingMs: null,
    };
  if (stopped) return { state: 'NONE', dueAt, remainingMs: null }; // closed/merged without ever reaching this milestone
  if (pausedAt) return { state: 'PAUSED', dueAt, remainingMs: null };

  const remainingMs = due - now.getTime();
  const windowMs = due - new Date(createdAt).getTime() - (pausedSeconds ?? 0) * 1000;
  if (remainingMs <= 0) return { state: 'BREACHED', dueAt, remainingMs };
  if (remainingMs <= windowMs * WARNING_FRACTION) return { state: 'WARNING', dueAt, remainingMs };
  return { state: 'OK', dueAt, remainingMs };
}

const SEVERITY = ['BREACHED', 'WARNING', 'PAUSED', 'OK', 'MET_LATE', 'MET', 'NONE'];

export function slaState(ticket, now = new Date()) {
  const stopped = ticket.status === 'CLOSED' || Boolean(ticket.mergedIntoId);
  const common = {
    pausedAt: ticket.slaPausedAt,
    createdAt: ticket.createdAt,
    pausedSeconds: ticket.slaPausedSeconds,
    stopped,
  };
  const firstResponse = clock(
    { ...common, dueAt: ticket.firstResponseDueAt, doneAt: ticket.firstResponseAt },
    now,
  );
  const resolution = clock(
    { ...common, dueAt: ticket.resolutionDueAt, doneAt: ticket.resolvedAt },
    now,
  );
  const overall = [firstResponse.state, resolution.state].sort(
    (a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b),
  )[0];
  return { firstResponse, resolution, overall, paused: Boolean(ticket.slaPausedAt) };
}

import { fmtDuration, useNow } from '../lib/time.js';

const CLOCK_LABEL = { firstResponse: 'First response', resolution: 'Resolution' };
const STYLE = {
  BREACHED: 'bg-red-100 text-red-800',
  WARNING: 'bg-amber-100 text-amber-800',
  PAUSED: 'bg-slate-200 text-slate-700',
  OK: 'bg-emerald-50 text-emerald-800',
  MET: 'bg-emerald-50 text-emerald-800',
  MET_LATE: 'bg-orange-50 text-orange-800',
};

// The server decides the state; the countdown is computed here from the due date so it stays
// accurate between refetches (and tips into "overdue" the moment time runs out).
export function describeClock(name, clock, now) {
  if (!clock || clock.state === 'NONE' || !clock.dueAt) return null;
  const remaining = new Date(clock.dueAt).getTime() - now;
  let state = clock.state;
  if ((state === 'OK' || state === 'WARNING') && remaining <= 0) state = 'BREACHED';
  const label = CLOCK_LABEL[name];
  switch (state) {
    case 'BREACHED':
      return {
        state,
        text: `${label} overdue ${fmtDuration(remaining)}`,
        short: `Overdue ${fmtDuration(remaining)}`,
      };
    case 'WARNING':
    case 'OK':
      return {
        state,
        text: `${label} due in ${fmtDuration(remaining)}`,
        short: `Due ${fmtDuration(remaining)}`,
      };
    case 'PAUSED':
      return { state, text: `${label} paused (waiting on customer)`, short: 'Paused' };
    case 'MET':
      return { state, text: `${label} met`, short: 'Met' };
    default:
      return { state, text: `${label} met late`, short: 'Met late' };
  }
}

const RANK = ['BREACHED', 'WARNING', 'PAUSED', 'OK', 'MET_LATE', 'MET'];

// The single most important clock of a ticket, for the queue.
export function mostUrgentClock(sla, now) {
  if (!sla) return null;
  const all = [
    describeClock('firstResponse', sla.firstResponse, now),
    describeClock('resolution', sla.resolution, now),
  ].filter(Boolean);
  return all.sort((a, b) => RANK.indexOf(a.state) - RANK.indexOf(b.state))[0] ?? null;
}

export default function SlaBadge({ sla }) {
  const now = useNow();
  const c = mostUrgentClock(sla, now);
  // Finished milestones are noise in a work queue.
  if (!c || c.state === 'MET' || c.state === 'MET_LATE')
    return <span className="text-xs text-slate-500">—</span>;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[c.state]}`}
      title={c.text}
    >
      {c.state === 'BREACHED' && <span className="sr-only">SLA breached. </span>}
      {c.short}
    </span>
  );
}

// Full breakdown for the ticket sidebar.
export function SlaPanel({ sla }) {
  const now = useNow();
  if (!sla) return null;
  const rows = [
    describeClock('firstResponse', sla.firstResponse, now),
    describeClock('resolution', sla.resolution, now),
  ];
  const dues = [sla.firstResponse.dueAt, sla.resolution.dueAt];
  return (
    <section aria-label="SLA" className="card space-y-2 text-sm">
      <h2 className="font-medium">SLA</h2>
      <ul className="space-y-2">
        {rows.map(
          (r, i) =>
            r && (
              <li key={i}>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[r.state]}`}
                >
                  {r.text}
                </span>
                {dues[i] && (
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Target: {new Date(dues[i]).toLocaleString()}
                  </span>
                )}
              </li>
            ),
        )}
        {rows.every((r) => !r) && <li className="text-slate-500">No SLA tracking.</li>}
      </ul>
    </section>
  );
}

// Durations in hours -> something a person reads at a glance.
export function fmtHours(h) {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h * 10) / 10}h`;
  return `${Math.round((h / 24) * 10) / 10}d`;
}
export const fmtPct = (p) => (p === null || p === undefined ? '—' : `${p}%`);
export const fmtNum = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n));

// Clean axis: at most ~5 round ticks (1/2/2.5/5 x 10^k), integers for counts.
export function niceTicks(max) {
  if (!max || max <= 0) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(
    1,
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw),
  );
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { max: top, ticks };
}

export const fmtDay = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

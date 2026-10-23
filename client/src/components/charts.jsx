import { useId, useRef, useState } from 'react';
import { fmtDay, fmtNum, niceTicks } from '../lib/format.js';

// Hand-rolled SVG charts following the dataviz rules: thin 2px lines, a ~10% area wash, end-dots
// with a 2px surface ring, hairline solid grid, legend for >= 2 series, hover crosshair + tooltip
// that is ALSO reachable by keyboard, and a table twin so no value is tooltip-only.

const W = 720;
const H = 260;
const M = { l: 40, r: 16, t: 12, b: 28 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

const SERIES = [
  { key: 'created', label: 'Created', color: 'var(--viz-series-1)' },
  { key: 'resolved', label: 'Resolved', color: 'var(--viz-series-2)' },
];

export function Legend({ items }) {
  return (
    <ul
      className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--viz-text-2)]"
      aria-label="Legend"
    >
      {items.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-4 rounded"
            style={{ background: s.color }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export function VolumeChart({ series, granularity, title = 'Ticket volume' }) {
  const id = useId();
  const [active, setActive] = useState(null);
  const box = useRef(null);
  const n = series.length;
  const total = series.reduce((s, p) => s + p.created + p.resolved, 0);

  if (n === 0 || total === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
        No tickets were created or resolved in this period.
      </p>
    );
  }

  const { max, ticks } = niceTicks(Math.max(...series.map((p) => Math.max(p.created, p.resolved))));
  const x = (i) => M.l + (n === 1 ? PW / 2 : (i / (n - 1)) * PW);
  const y = (v) => M.t + PH - (v / max) * PH;
  const line = (key) =>
    series
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`)
      .join(' ');
  const area = (key) =>
    `${line(key)} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const labelIdx = [
    ...new Set(
      Array.from({ length: Math.min(n, 6) }, (_, k) =>
        Math.round((k / (Math.min(n, 6) - 1 || 1)) * (n - 1)),
      ),
    ),
  ];

  const fromPointer = (e) => {
    const r = box.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W; // back to viewBox units
    const i = Math.round(((px - M.l) / PW) * (n - 1));
    if (Number.isFinite(i)) setActive(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  const point = active === null ? null : series[active];
  const label = (p) => `${granularity === 'week' ? 'Week of ' : ''}${fmtDay(p.date)}`;
  const summary = `${title}: ${series.reduce((s, p) => s + p.created, 0)} created and ${series.reduce((s, p) => s + p.resolved, 0)} resolved between ${fmtDay(series[0].date)} and ${fmtDay(series[n - 1].date)}.`;

  return (
    <figure className="viz" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`} className="sr-only">
        {summary}
      </figcaption>
      <Legend items={SERIES} />
      <div
        ref={box}
        className="relative rounded-lg bg-[var(--viz-surface)] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--viz-series-1)]"
        tabIndex={0}
        role="group"
        aria-label={`${title}. Use the left and right arrow keys to read each ${granularity}.`}
        onPointerMove={fromPointer}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={M.l}
                x2={W - M.r}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'}
                strokeWidth="1"
              />
              <text x={M.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--viz-muted)">
                {fmtNum(t)}
              </text>
            </g>
          ))}
          {labelIdx.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              fontSize="11"
              fill="var(--viz-muted)"
            >
              {fmtDay(series[i].date)}
            </text>
          ))}
          {SERIES.map((s) => (
            <g key={s.key}>
              <path d={area(s.key)} fill={s.color} fillOpacity="0.1" />
              <path
                d={line(s.key)}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          ))}
          {active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={M.t}
              y2={M.t + PH}
              stroke="var(--viz-axis)"
              strokeWidth="1"
            />
          )}
          {SERIES.map((s) => {
            const i = active ?? n - 1; // end-dot when idle, tracked dot when hovering
            return (
              <circle
                key={s.key}
                cx={x(i)}
                cy={y(series[i][s.key])}
                r="4"
                fill={s.color}
                stroke="var(--viz-surface)"
                strokeWidth="2"
              />
            );
          })}
        </svg>
        {point && (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${(x(active) / W) * 100}%`,
              transform: `translateX(${active > n / 2 ? '-105%' : '5%'})`,
            }}
          >
            <div className="mb-1 font-medium text-[var(--viz-text)]">{label(point)}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-2 text-[var(--viz-text-2)]">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: s.color }}
                />
                {s.label}: <strong className="text-[var(--viz-text)]">{point[s.key]}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-[var(--viz-text-2)]">View data as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded border border-slate-200">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              {title} by {granularity}
            </caption>
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-3 py-1.5">
                  {granularity === 'week' ? 'Week starting' : 'Day'}
                </th>
                <th scope="col" className="px-3 py-1.5">
                  Created
                </th>
                <th scope="col" className="px-3 py-1.5">
                  Resolved
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.date} className="border-t border-slate-100">
                  <td className="px-3 py-1">{p.date}</td>
                  <td className="px-3 py-1">{p.created}</td>
                  <td className="px-3 py-1">{p.resolved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

// Horizontal bars for one measure over named categories: ONE color (the categories are nominal,
// so a value ramp would only repeat the bar length), thin bars, 4px rounded data end, value
// printed at the tip. The list itself is the accessible table twin.
export function BarList({
  items,
  ariaLabel,
  empty = 'Nothing to show for this period.',
  format = (v) => v,
}) {
  const max = Math.max(...items.map((i) => i.value), 0);
  if (items.length === 0 || max === 0)
    return (
      <p className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-sm text-slate-500">
        {empty}
      </p>
    );
  return (
    <ul aria-label={ariaLabel} className="viz space-y-2">
      {items.map((it) => (
        <li
          key={it.key ?? it.label}
          className="grid grid-cols-[minmax(6rem,10rem)_1fr_3.5rem] items-center gap-3 text-sm"
        >
          <span className="truncate text-[var(--viz-text-2)]" title={it.label}>
            {it.label}
          </span>
          <span className="h-3" aria-hidden="true">
            {it.value > 0 && (
              <span
                className="block h-3 rounded-r"
                style={{
                  width: `${Math.max(1, (it.value / max) * 100)}%`,
                  background: 'var(--viz-series-1)',
                  borderTopRightRadius: 4,
                  borderBottomRightRadius: 4,
                }}
              />
            )}
          </span>
          <span className="text-right font-medium text-[var(--viz-text)]">{format(it.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatTile({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-3xl font-semibold leading-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

import { useEffect, useState } from 'react';

// Re-renders every `ms` so countdowns stay live without refetching the data.
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function fmtDuration(ms) {
  const m = Math.floor(Math.abs(ms) / 60_000);
  if (m < 1) return '<1m';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

export const timeAgo = (iso, now = Date.now()) => {
  const diff = now - new Date(iso).getTime();
  return diff < 60_000 ? 'just now' : `${fmtDuration(diff)} ago`;
};

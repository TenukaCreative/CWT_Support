import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { qs } from './query.js';

// Reports re-query when the filters change; the previous numbers stay on screen (dimmed by the
// caller via `isPlaceholderData`) instead of flashing a skeleton.
export const useReport = (name, path, params, enabled = true) =>
  useQuery({
    queryKey: ['report', name, params],
    queryFn: () => api(`${path}${qs(params)}`),
    placeholderData: keepPreviousData,
    enabled,
  });

// Inclusive UTC days, same convention as the API.
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
export function presetRange(days, now = Date.now()) {
  const today = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  );
  return { from: iso(today - (days - 1) * 86_400_000), to: iso(today) };
}
export const PRESETS = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['180', 'Last 6 months'],
  ['365', 'Last 12 months'],
  ['custom', 'Custom range…'],
];

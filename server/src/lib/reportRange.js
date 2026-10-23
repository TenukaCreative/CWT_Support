import { z } from 'zod';
import { badRequest } from './errors.js';

const DAY = 86_400_000;
const MAX_DAYS = 366;

export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
      new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
    'Not a real date',
  );

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Reports are UTC, whole days, `from` and `to` both inclusive. Default: the last 30 days.
// The returned `to` is EXCLUSIVE (midnight after the last day) so queries use [from, to).
export function resolveRange({ from, to } = {}, now = new Date()) {
  const toDay = to
    ? Date.parse(`${to}T00:00:00Z`)
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const fromDay = from ? Date.parse(`${from}T00:00:00Z`) : toDay - 29 * DAY;
  if (fromDay > toDay)
    throw badRequest('"from" must not be after "to"', [
      { path: 'from', message: 'Start is after end' },
    ]);
  const days = Math.round((toDay - fromDay) / DAY) + 1;
  if (days > MAX_DAYS)
    throw badRequest(`The date range can be at most ${MAX_DAYS} days`, [
      { path: 'from', message: 'Range too long' },
    ]);
  return {
    from: new Date(fromDay),
    to: new Date(toDay + DAY),
    fromDate: isoDay(fromDay),
    toDate: isoDay(toDay),
    days,
    granularity: days > 92 ? 'week' : 'day', // keep charts to <= ~92 points
  };
}

// Every bucket key (YYYY-MM-DD, UTC) between from and to, so charts show zero days instead of gaps.
// Weeks start on Monday, matching Postgres date_trunc('week').
export function bucketKeys(from, to, granularity) {
  let t = from.getTime();
  if (granularity === 'week') t -= ((new Date(t).getUTCDay() + 6) % 7) * DAY;
  const step = granularity === 'week' ? 7 * DAY : DAY;
  const keys = [];
  for (; t < to.getTime(); t += step) keys.push(isoDay(t));
  return keys;
}

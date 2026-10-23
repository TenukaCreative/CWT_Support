import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { bucketKeys, resolveRange } from '../lib/reportRange.js';
import { projectCondition, reportProjectIds } from '../lib/scopeSql.js';
import { STATUSES } from '../lib/ticketStateMachine.js';
import { searchInsights } from './faqManage.service.js';

// Aggregates for the dashboards. Conventions (also in docs/ASSUMPTIONS.md):
//  - UTC whole days, [from, to); merged duplicates are not counted as tickets
//  - first response: tickets CREATED in the period that have been answered
//  - resolution time: tickets RESOLVED in the period, minus time spent waiting on the customer
//  - SLA compliance: tickets CREATED in the period whose clock reached a verdict (met, or missed
//    / overdue); paused, closed-without-answer and still-running-within-target are not counted
//  - everything goes through projectCondition(): the caller's scope is the isolation boundary
const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'REOPENED'];
const round = (n, d = 2) =>
  n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d;
const rate = (met, total) => (total > 0 ? round((met / total) * 100, 1) : null);

// ctx: { scope, userId }. `mine` restricts everything to tickets assigned to the caller.
async function setup({ scope, userId }, query, mine = false) {
  const range = resolveRange(query);
  const ids = await reportProjectIds(scope, query.projectId);
  return {
    range,
    ids,
    proj: projectCondition(ids, 't."projectId"'),
    who: mine ? Prisma.sql`AND t."assigneeId" = ${userId}` : Prisma.empty,
  };
}

async function metrics({ range: { from, to }, proj, who }, now) {
  const [row] = await prisma.$queryRaw`
    WITH base AS (
      SELECT t.*,
        CASE WHEN t."firstResponseDueAt" IS NULL THEN NULL
             WHEN t."firstResponseAt" IS NOT NULL THEN t."firstResponseAt" <= t."firstResponseDueAt"
             WHEN t.status = 'CLOSED' OR t."slaPausedAt" IS NOT NULL THEN NULL
             WHEN t."firstResponseDueAt" < ${now} THEN FALSE
             ELSE NULL END AS fr_met,
        CASE WHEN t."resolutionDueAt" IS NULL THEN NULL
             WHEN t."resolvedAt" IS NOT NULL THEN t."resolvedAt" <= t."resolutionDueAt"
             WHEN t.status = 'CLOSED' OR t."slaPausedAt" IS NOT NULL THEN NULL
             WHEN t."resolutionDueAt" < ${now} THEN FALSE
             ELSE NULL END AS res_met,
        EXTRACT(EPOCH FROM (t."firstResponseAt" - t."createdAt")) AS fr_secs,
        GREATEST(EXTRACT(EPOCH FROM (t."resolvedAt" - t."createdAt")) - t."slaPausedSeconds", 0) AS res_secs
      FROM "Ticket" t
      WHERE t."mergedIntoId" IS NULL ${proj} ${who}
    )
    SELECT
      count(*) FILTER (WHERE "createdAt" >= ${from} AND "createdAt" < ${to})::int AS created,
      count(*) FILTER (WHERE "resolvedAt" >= ${from} AND "resolvedAt" < ${to})::int AS resolved,
      count(*) FILTER (WHERE status::text = ANY(${OPEN_STATUSES}))::int AS open_now,
      (avg(fr_secs) FILTER (WHERE "createdAt" >= ${from} AND "createdAt" < ${to} AND "firstResponseAt" IS NOT NULL) / 3600)::float8 AS fr_avg,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY fr_secs) FILTER (WHERE "createdAt" >= ${from} AND "createdAt" < ${to} AND "firstResponseAt" IS NOT NULL) / 3600)::float8 AS fr_median,
      count(*) FILTER (WHERE "createdAt" >= ${from} AND "createdAt" < ${to} AND "firstResponseAt" IS NOT NULL)::int AS fr_n,
      (avg(res_secs) FILTER (WHERE "resolvedAt" >= ${from} AND "resolvedAt" < ${to}) / 3600)::float8 AS res_avg,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY res_secs) FILTER (WHERE "resolvedAt" >= ${from} AND "resolvedAt" < ${to}) / 3600)::float8 AS res_median,
      count(*) FILTER (WHERE "resolvedAt" >= ${from} AND "resolvedAt" < ${to})::int AS res_n,
      count(*) FILTER (WHERE "createdAt" >= ${from} AND "createdAt" < ${to} AND fr_met)::int AS fr_sla_met,
      count(*) FILTER (WHERE "createdAt" >= ${from} AND "createdAt" < ${to} AND fr_met IS NOT NULL)::int AS fr_sla_total,
      count(*) FILTER (WHERE "createdAt" >= ${from} AND "createdAt" < ${to} AND res_met)::int AS res_sla_met,
      count(*) FILTER (WHERE "createdAt" >= ${from} AND "createdAt" < ${to} AND res_met IS NOT NULL)::int AS res_sla_total
    FROM base`;

  const [ev] = await prisma.$queryRaw`
    SELECT
      count(*) FILTER (WHERE e.type::text = 'REOPENED')::int AS reopens,
      count(*) FILTER (WHERE e.type::text = 'STATUS_CHANGED' AND e."toValue" = 'RESOLVED')::int AS resolutions
    FROM "TicketEvent" e JOIN "Ticket" t ON t.id = e."ticketId"
    WHERE e."createdAt" >= ${from} AND e."createdAt" < ${to} AND t."mergedIntoId" IS NULL ${proj} ${who}`;

  return {
    totals: {
      created: row.created,
      resolved: row.resolved,
      openNow: row.open_now,
      reopens: ev.reopens,
      resolutionEvents: ev.resolutions,
      // How often a resolution did not stick: reopen events per resolution event in the period.
      reopenRate: rate(ev.reopens, ev.resolutions),
    },
    responseTimes: {
      firstResponse: {
        avgHours: round(row.fr_avg),
        medianHours: round(row.fr_median),
        count: row.fr_n,
      },
      resolution: {
        avgHours: round(row.res_avg),
        medianHours: round(row.res_median),
        count: row.res_n,
      },
    },
    sla: {
      firstResponse: {
        met: row.fr_sla_met,
        total: row.fr_sla_total,
        rate: rate(row.fr_sla_met, row.fr_sla_total),
      },
      resolution: {
        met: row.res_sla_met,
        total: row.res_sla_total,
        rate: rate(row.res_sla_met, row.res_sla_total),
      },
    },
  };
}

async function volumeSeries({ range, proj, who }) {
  const { from, to, granularity } = range;
  const unit = Prisma.raw(`'${granularity === 'week' ? 'week' : 'day'}'`); // whitelisted literal
  const [created, resolved] = await Promise.all([
    prisma.$queryRaw`
      SELECT to_char(date_trunc(${unit}, t."createdAt"), 'YYYY-MM-DD') AS d, count(*)::int AS n FROM "Ticket" t
      WHERE t."createdAt" >= ${from} AND t."createdAt" < ${to} AND t."mergedIntoId" IS NULL ${proj} ${who} GROUP BY 1`,
    prisma.$queryRaw`
      SELECT to_char(date_trunc(${unit}, t."resolvedAt"), 'YYYY-MM-DD') AS d, count(*)::int AS n FROM "Ticket" t
      WHERE t."resolvedAt" >= ${from} AND t."resolvedAt" < ${to} AND t."mergedIntoId" IS NULL ${proj} ${who} GROUP BY 1`,
  ]);
  const c = new Map(created.map((r) => [r.d, r.n]));
  const r = new Map(resolved.map((x) => [x.d, x.n]));
  return bucketKeys(from, to, granularity).map((date) => ({
    date,
    created: c.get(date) ?? 0,
    resolved: r.get(date) ?? 0,
  }));
}

async function statusBreakdown({ proj, who }) {
  const rows = await prisma.$queryRaw`
    SELECT t.status::text AS status, count(*)::int AS n FROM "Ticket" t WHERE t."mergedIntoId" IS NULL ${proj} ${who} GROUP BY 1`;
  const m = new Map(rows.map((x) => [x.status, x.n]));
  return STATUSES.map((status) => ({ status, count: m.get(status) ?? 0 }));
}

async function topCategories({ range: { from, to }, proj, who }) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(c.name, 'Uncategorised') AS name, count(*)::int AS n
    FROM "Ticket" t LEFT JOIN "Category" c ON c.id = t."categoryId"
    WHERE t."createdAt" >= ${from} AND t."createdAt" < ${to} AND t."mergedIntoId" IS NULL ${proj} ${who}
    GROUP BY 1 ORDER BY n DESC, name ASC LIMIT 8`;
  return rows.map((r) => ({ name: r.name, count: r.n }));
}

const rangeOut = (r) => ({
  from: r.fromDate,
  to: r.toDate,
  days: r.days,
  granularity: r.granularity,
});

// ───────────── admin dashboard ─────────────

export async function overview(ctx, query, now = new Date()) {
  const s = await setup(ctx, query);
  const [m, series, statuses, categories] = await Promise.all([
    metrics(s, now),
    volumeSeries(s),
    statusBreakdown(s),
    topCategories(s),
  ]);
  return { range: rangeOut(s.range), ...m, series, statuses, categories };
}

// ───────────── CSAT ─────────────

async function csatSummary({ range: { from, to }, proj, who }) {
  const [r] = await prisma.$queryRaw`
    SELECT count(*)::int AS n, avg(f.rating)::float8 AS avg,
      count(*) FILTER (WHERE f.rating = 1)::int AS r1, count(*) FILTER (WHERE f.rating = 2)::int AS r2,
      count(*) FILTER (WHERE f.rating = 3)::int AS r3, count(*) FILTER (WHERE f.rating = 4)::int AS r4,
      count(*) FILTER (WHERE f.rating = 5)::int AS r5
    FROM "Feedback" f JOIN "Ticket" t ON t.id = f."ticketId"
    WHERE f."createdAt" >= ${from} AND f."createdAt" < ${to} ${proj} ${who}`;
  return {
    count: r.n,
    average: round(r.avg),
    distribution: [r.r1, r.r2, r.r3, r.r4, r.r5].map((count, i) => ({ rating: i + 1, count })),
  };
}

export async function csat(ctx, query) {
  const s = await setup(ctx, query);
  const { from, to } = s.range;
  const where = Prisma.sql`f."createdAt" >= ${from} AND f."createdAt" < ${to} ${s.proj} ${s.who}`;
  const shape = (rows) =>
    rows.map((r) => ({ id: r.id, name: r.name, count: r.n, average: round(r.avg) }));

  const [summary, byAgent, byProject, byCategory, byMonth] = await Promise.all([
    csatSummary(s),
    prisma.$queryRaw`
      SELECT COALESCE(u.id, '') AS id, COALESCE(u.name, 'Unassigned') AS name, count(*)::int AS n, avg(f.rating)::float8 AS avg
      FROM "Feedback" f JOIN "Ticket" t ON t.id = f."ticketId" LEFT JOIN "User" u ON u.id = t."assigneeId"
      WHERE ${where} GROUP BY u.id, u.name ORDER BY n DESC, name ASC`,
    prisma.$queryRaw`
      SELECT p.id AS id, p.key || ' · ' || p.name AS name, count(*)::int AS n, avg(f.rating)::float8 AS avg
      FROM "Feedback" f JOIN "Ticket" t ON t.id = f."ticketId" JOIN "Project" p ON p.id = t."projectId"
      WHERE ${where} GROUP BY p.id, p.key, p.name ORDER BY n DESC, name ASC`,
    prisma.$queryRaw`
      SELECT COALESCE(c.id, '') AS id, COALESCE(c.name, 'Uncategorised') AS name, count(*)::int AS n, avg(f.rating)::float8 AS avg
      FROM "Feedback" f JOIN "Ticket" t ON t.id = f."ticketId" LEFT JOIN "Category" c ON c.id = t."categoryId"
      WHERE ${where} GROUP BY c.id, c.name ORDER BY n DESC, name ASC`,
    prisma.$queryRaw`
      SELECT to_char(date_trunc('month', f."createdAt"), 'YYYY-MM') AS id, to_char(date_trunc('month', f."createdAt"), 'YYYY-MM') AS name,
             count(*)::int AS n, avg(f.rating)::float8 AS avg
      FROM "Feedback" f JOIN "Ticket" t ON t.id = f."ticketId"
      WHERE ${where} GROUP BY 1 ORDER BY 1 ASC`,
  ]);
  return {
    range: rangeOut(s.range),
    summary,
    byAgent: shape(byAgent),
    byProject: shape(byProject),
    byCategory: shape(byCategory),
    byMonth: shape(byMonth),
  };
}

// ───────────── FAQ deflection ─────────────

export async function deflection(ctx, query, db) {
  const range = resolveRange(query);
  await reportProjectIds(ctx.scope, query.projectId); // 404 for a project outside the scope
  const insights = await searchInsights(db, {
    from: range.from,
    to: range.to,
    projectId: query.projectId,
  });
  return { range: rangeOut(range), ...insights };
}

// ───────────── personal stats (support / admin acting as an agent) ─────────────

export async function myStats(ctx, query, now = new Date()) {
  const s = await setup(ctx, query, true);
  const [m, series, statuses, csatSum] = await Promise.all([
    metrics(s, now),
    volumeSeries(s),
    statusBreakdown(s),
    csatSummary(s),
  ]);
  return { range: rangeOut(s.range), ...m, series, statuses, csat: csatSum };
}

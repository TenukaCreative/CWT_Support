import request from 'supertest';
import { createApp } from '../src/app.js';
import { bucketKeys, resolveRange } from '../src/lib/reportRange.js';
import { BOM, csvCell, csvRow } from '../src/lib/csv.js';
import { prisma, resetDb, makeWorld, authAs } from './helpers.js';

const app = createApp();
const api = (path, headers) => request(app).get(`/api/v1${path}`).set(headers);
const H = 3_600_000;
const D = 24 * H;
const today0 = Date.UTC(
  new Date().getUTCFullYear(),
  new Date().getUTCMonth(),
  new Date().getUTCDate(),
);
const day = (n, hours = 0) => new Date(today0 - n * D + hours * H);
const dayKey = (n) => day(n).toISOString().slice(0, 10);
const iso = (n) => dayKey(n);

describe('range helpers', () => {
  it('defaults to the last 30 days, inclusive, with an exclusive end', () => {
    const r = resolveRange({}, new Date('2026-03-31T15:00:00Z'));
    expect(r).toMatchObject({
      fromDate: '2026-03-02',
      toDate: '2026-03-31',
      days: 30,
      granularity: 'day',
    });
    expect(r.to.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('switches to weekly buckets for long ranges and rejects bad ranges', () => {
    expect(resolveRange({ from: '2026-01-01', to: '2026-04-30' }).granularity).toBe('week'); // 120 days
    expect(resolveRange({ from: '2026-01-01', to: '2026-02-01' }).granularity).toBe('day');
    expect(() => resolveRange({ from: '2026-03-02', to: '2026-03-01' })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => resolveRange({ from: '2024-01-01', to: '2026-01-01' })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(resolveRange({ from: '2025-01-01', to: '2025-12-31' }).days).toBe(365);
  });

  it('bucket keys cover every day (no gaps) and weeks start on Monday', () => {
    const r = resolveRange({ from: '2026-03-01', to: '2026-03-05' });
    expect(bucketKeys(r.from, r.to, 'day')).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
    ]);
    const w = resolveRange({ from: '2026-03-04', to: '2026-03-18' }); // Wed .. Wed
    expect(bucketKeys(w.from, w.to, 'week')).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']); // all Mondays
  });
});

describe('CSV helpers', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(7)).toBe('7');
    expect(csvCell(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(csvRow(['a', 'b,c'])).toBe('a,"b,c"\r\n');
    expect(BOM).toBe('﻿');
  });

  it('neutralises spreadsheet formulas (CSV injection)', () => {
    for (const evil of [
      '=1+1',
      '+SUM(A1)',
      '-2+3',
      '@cmd',
      '=HYPERLINK("http://evil","x")',
      '\tTAB',
      '\rCR',
    ]) {
      expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('-5')).toBe("'-5"); // strings are never trusted as numbers
    expect(csvCell(-5)).toBe('-5'); // real numbers stay numbers
    expect(csvCell('normal = text')).toBe('normal = text');
  });
});

describe('reports API', () => {
  let w;
  beforeAll(async () => {
    await resetDb();
    w = await makeWorld();
    await prisma.ticket.deleteMany(); // the shared world tickets are not part of this dataset
    await seedDataset(w);
  });
  afterAll(() => prisma.$disconnect());

  // Known numbers (see the comments): everything below is asserted exactly.
  async function seedDataset(w) {
    const cat = Object.fromEntries(
      await Promise.all(
        ['Bug', 'Billing'].map(async (name) => [
          name,
          await prisma.category.create({ data: { name } }),
        ]),
      ),
    );
    let seq = 0;
    const mk = async (project, creator, over) => {
      seq += 1;
      return prisma.ticket.create({
        data: {
          projectId: project.id,
          createdById: creator.id,
          subject: 'Report ticket',
          description: 'Report fixture ticket',
          sequence: seq,
          number: `${project.key}-R${seq}`,
          ...over,
        },
      });
    };
    const ev = (ticketId, type, at, extra = {}) =>
      prisma.ticketEvent.create({ data: { ticketId, type, createdAt: at, ...extra } });
    const rate = (ticketId, userId, rating, at) =>
      prisma.feedback.create({ data: { ticketId, createdById: userId, rating, createdAt: at } });

    // T1: A1/supportA/Bug. FR 1h (met), resolved after 10h wall-clock with 2h waiting => net 8h, SLA met
    const c1 = day(5, 2);
    const t1 = await mk(w.A1, w.bob, {
      createdAt: c1,
      firstResponseAt: new Date(+c1 + 1 * H),
      firstResponseDueAt: new Date(+c1 + 4 * H),
      resolvedAt: new Date(+c1 + 10 * H),
      resolutionDueAt: new Date(+c1 + 26 * H),
      slaPausedSeconds: 7200,
      status: 'RESOLVED',
      assigneeId: w.supportA.id,
      categoryId: cat.Bug.id,
    });
    // T2: A1/supportA/Bug. FR 6h (missed), resolved after 30h (missed), closed
    const c2 = day(5, 5);
    const t2 = await mk(w.A1, w.alice, {
      createdAt: c2,
      firstResponseAt: new Date(+c2 + 6 * H),
      firstResponseDueAt: new Date(+c2 + 4 * H),
      resolvedAt: new Date(+c2 + 30 * H),
      resolutionDueAt: new Date(+c2 + 24 * H),
      status: 'CLOSED',
      assigneeId: w.supportA.id,
      categoryId: cat.Bug.id,
    });
    // T3: A1 unassigned, never answered, long overdue, OPEN => both SLAs missed
    const t3 = await mk(w.A1, w.bob, {
      createdAt: day(2),
      firstResponseDueAt: day(2, 1),
      resolutionDueAt: day(2, 4),
      status: 'OPEN',
    });
    // T4: A1/supportA/Billing. Answered after 30 min (met); waiting on the customer (paused) => resolution clock excluded
    const c4 = day(1, 1);
    await mk(w.A1, w.alice, {
      createdAt: c4,
      firstResponseAt: new Date(+c4 + 0.5 * H),
      firstResponseDueAt: new Date(+c4 + 4 * H),
      resolutionDueAt: day(0, -1),
      status: 'WAITING_ON_CUSTOMER',
      slaPausedAt: day(1, 3),
      assigneeId: w.supportA.id,
      categoryId: cat.Billing.id,
    });
    // T5: A1/supportA created long before the period, still open: only counts for "open now"
    await mk(w.A1, w.bob, { createdAt: day(40), status: 'OPEN', assigneeId: w.supportA.id });
    // T6: merged duplicate: never counted anywhere
    await mk(w.A1, w.bob, {
      createdAt: day(2),
      status: 'CLOSED',
      mergedIntoId: t3.id,
      firstResponseDueAt: day(2, 1),
      resolutionDueAt: day(2, 4),
    });
    // T7: A2/supportBoth/Billing, FR 1h, resolved in 2h, rated 4
    const c7 = day(3, 1);
    const t7 = await mk(w.A2, w.alice, {
      createdAt: c7,
      firstResponseAt: new Date(+c7 + 1 * H),
      firstResponseDueAt: new Date(+c7 + 4 * H),
      resolvedAt: new Date(+c7 + 3 * H),
      resolutionDueAt: new Date(+c7 + 24 * H),
      status: 'RESOLVED',
      assigneeId: w.supportBoth.id,
      categoryId: cat.Billing.id,
    });
    // T8: B1/supportB/Bug, FR 2h, resolved in 10h, rated 3 (another organisation)
    const c8 = day(3, 2);
    const t8 = await mk(w.B1, w.carol, {
      createdAt: c8,
      firstResponseAt: new Date(+c8 + 2 * H),
      firstResponseDueAt: new Date(+c8 + 4 * H),
      resolvedAt: new Date(+c8 + 10 * H),
      resolutionDueAt: new Date(+c8 + 24 * H),
      status: 'RESOLVED',
      assigneeId: w.supportB.id,
      categoryId: cat.Bug.id,
    });

    for (const t of [t1, t2, t7, t8])
      await ev(t.id, 'STATUS_CHANGED', t.resolvedAt, {
        fromValue: 'IN_PROGRESS',
        toValue: 'RESOLVED',
      });
    await ev(t1.id, 'REOPENED', day(4), { fromValue: 'RESOLVED', toValue: 'REOPENED' });

    await rate(t1.id, w.bob.id, 5, day(4, 3));
    await rate(t2.id, w.alice.id, 2, day(3, 3));
    await rate(t7.id, w.alice.id, 4, day(3, 5));
    await rate(t8.id, w.carol.id, 3, day(3, 6));
    return { t1, t2, t3, t7, t8 };
  }

  describe('overview (admin dashboard)', () => {
    it('computes every KPI exactly', async () => {
      const res = await api('/reports/overview', await authAs(app, w.admin, 'ALL'));
      expect(res.status).toBe(200);
      const b = res.body;
      expect(b.range).toMatchObject({ days: 30, granularity: 'day' });
      expect(b.totals).toEqual({
        created: 6,
        resolved: 4,
        openNow: 3,
        reopens: 1,
        resolutionEvents: 4,
        reopenRate: 25,
      });
      expect(b.responseTimes.firstResponse).toEqual({ avgHours: 2.1, medianHours: 1, count: 5 }); // 1, 6, 0.5, 1, 2
      expect(b.responseTimes.resolution).toEqual({ avgHours: 12.75, medianHours: 9, count: 4 }); // net: 8, 30, 3, 10
      expect(b.sla.firstResponse).toEqual({ met: 4, total: 6, rate: 66.7 });
      expect(b.sla.resolution).toEqual({ met: 3, total: 5, rate: 60 }); // the paused ticket has no verdict
    });

    it('builds a gap-free daily series', async () => {
      const { series } = (await api('/reports/overview', await authAs(app, w.admin, 'ALL'))).body;
      expect(series).toHaveLength(30);
      expect(series[0].date).toBe(iso(29));
      expect(series.at(-1).date).toBe(iso(0));
      const at = (n) => series.find((s) => s.date === iso(n));
      expect(at(5)).toEqual({ date: iso(5), created: 2, resolved: 1 });
      expect(at(4)).toEqual({ date: iso(4), created: 0, resolved: 1 });
      expect(at(3)).toEqual({ date: iso(3), created: 2, resolved: 2 });
      expect(at(2)).toEqual({ date: iso(2), created: 1, resolved: 0 }); // the merged duplicate is excluded
      expect(at(1)).toEqual({ date: iso(1), created: 1, resolved: 0 });
      expect(at(10)).toEqual({ date: iso(10), created: 0, resolved: 0 });
      expect(series.reduce((n, s) => n + s.created, 0)).toBe(6);
    });

    it('reports the current status mix and the top categories', async () => {
      const b = (await api('/reports/overview', await authAs(app, w.admin, 'ALL'))).body;
      expect(Object.fromEntries(b.statuses.map((s) => [s.status, s.count]))).toEqual({
        OPEN: 2,
        IN_PROGRESS: 0,
        WAITING_ON_CUSTOMER: 1,
        RESOLVED: 3,
        CLOSED: 1,
        REOPENED: 0,
      });
      expect(b.categories).toEqual([
        { name: 'Bug', count: 3 },
        { name: 'Billing', count: 2 },
        { name: 'Uncategorised', count: 1 },
      ]);
    });

    it('respects the date range, and weekly granularity for long ranges', async () => {
      const admin = await authAs(app, w.admin, 'ALL');
      const narrow = (await api(`/reports/overview?from=${iso(3)}&to=${iso(3)}`, admin)).body;
      expect(narrow.range.days).toBe(1);
      expect(narrow.totals.created).toBe(2); // T7 + T8
      expect(narrow.series).toHaveLength(1);
      const long = (await api(`/reports/overview?from=${iso(150)}&to=${iso(0)}`, admin)).body;
      expect(long.range.granularity).toBe('week');
      expect(long.series.length).toBeGreaterThan(20);
      expect(long.series.length).toBeLessThan(25);
      expect(long.totals.created).toBe(7); // now includes the day(40) ticket
      expect(long.series.reduce((n, s) => n + s.created, 0)).toBe(7);
    });

    it('validates the range', async () => {
      const admin = await authAs(app, w.admin, 'ALL');
      expect((await api(`/reports/overview?from=${iso(0)}&to=${iso(5)}`, admin)).status).toBe(400);
      expect((await api(`/reports/overview?from=${iso(400)}&to=${iso(0)}`, admin)).status).toBe(
        400,
      );
      expect((await api('/reports/overview?from=yesterday', admin)).status).toBe(400);
      expect((await api('/reports/overview?from=2026-02-30', admin)).status).toBe(400);
    });

    it('an empty period returns zeros and nulls, not errors', async () => {
      const b = (
        await api(
          `/reports/overview?from=${iso(200)}&to=${iso(190)}`,
          await authAs(app, w.admin, 'ALL'),
        )
      ).body;
      expect(b.totals).toMatchObject({ created: 0, resolved: 0, reopenRate: null });
      expect(b.responseTimes.firstResponse).toEqual({
        avgHours: null,
        medianHours: null,
        count: 0,
      });
      expect(b.sla.firstResponse).toEqual({ met: 0, total: 0, rate: null });
      expect(b.categories).toEqual([]);
    });
  });

  describe('isolation', () => {
    it('is admin-only, and needs a project scope', async () => {
      for (const path of ['/reports/overview', '/reports/csat', '/reports/deflection']) {
        expect((await request(app).get(`/api/v1${path}`)).status).toBe(401);
        expect((await api(path, await authAs(app, w.supportA, w.A1.id))).status).toBe(403);
        expect((await api(path, await authAs(app, w.bob, w.A1.id))).status).toBe(403);
      }
      expect((await api('/reports/overview', await authAs(app, w.admin))).status).toBe(409); // no project chosen yet
      expect((await request(app).get('/api/v1/reports/me')).status).toBe(401);
      expect((await api('/reports/me', await authAs(app, w.bob, w.A1.id))).status).toBe(403);
    });

    it("an admin viewing one project sees only that project's numbers", async () => {
      const admin = await authAs(app, w.admin, w.A1.id);
      const b = (await api('/reports/overview', admin)).body;
      expect(b.totals.created).toBe(4); // T1 T2 T3 T4 (not A2/B1)
      expect(b.totals.resolved).toBe(2);
      expect(b.categories.map((c) => c.name).sort()).toEqual(['Billing', 'Bug', 'Uncategorised']);
      const csat = (await api('/reports/csat', admin)).body;
      expect(csat.summary.count).toBe(2);
      expect(csat.byProject.map((p) => p.name)).toEqual(['A-ONE · A-ONE']);
      expect(csat.byAgent.map((a) => a.name)).toEqual(['supportA']);
    });

    it('the projectId filter narrows within scope; outside the scope it is a 404 (no probing)', async () => {
      const all = await authAs(app, w.admin, 'ALL');
      expect((await api(`/reports/overview?projectId=${w.B1.id}`, all)).body.totals.created).toBe(
        1,
      );
      expect((await api(`/reports/csat?projectId=${w.A2.id}`, all)).body.summary.count).toBe(1);
      const scoped = await authAs(app, w.admin, w.A1.id);
      expect((await api(`/reports/overview?projectId=${w.B1.id}`, scoped)).status).toBe(404);
      expect((await api(`/reports/csat?projectId=${w.A2.id}`, scoped)).status).toBe(404);
      expect((await api(`/reports/deflection?projectId=${w.B1.id}`, scoped)).status).toBe(404);
      expect((await api('/reports/overview?projectId=ghost', all)).status).toBe(404);
    });
  });

  describe('CSAT', () => {
    it('summarises and breaks down by agent, project, category and month', async () => {
      const b = (await api('/reports/csat', await authAs(app, w.admin, 'ALL'))).body;
      expect(b.summary).toEqual({
        count: 4,
        average: 3.5,
        distribution: [
          { rating: 1, count: 0 },
          { rating: 2, count: 1 },
          { rating: 3, count: 1 },
          { rating: 4, count: 1 },
          { rating: 5, count: 1 },
        ],
      });
      expect(b.byAgent.map((a) => [a.name, a.count, a.average])).toEqual([
        ['supportA', 2, 3.5],
        ['supportB', 1, 3],
        ['supportBoth', 1, 4],
      ]);
      expect(b.byProject.map((p) => [p.name, p.count, p.average])).toEqual([
        ['A-ONE · A-ONE', 2, 3.5],
        ['A-TWO · A-TWO', 1, 4],
        ['B-ONE · B-ONE', 1, 3],
      ]);
      expect(b.byCategory.map((c) => [c.name, c.count, c.average])).toEqual([
        ['Bug', 3, 3.33],
        ['Billing', 1, 4],
      ]);
      expect(b.byMonth.reduce((n, m) => n + m.count, 0)).toBe(4);
      expect(b.byMonth.map((m) => m.name)).toEqual([...b.byMonth.map((m) => m.name)].sort());
    });

    it('only counts ratings given inside the period', async () => {
      const b = (
        await api(`/reports/csat?from=${iso(4)}&to=${iso(4)}`, await authAs(app, w.admin, 'ALL'))
      ).body;
      expect(b.summary.count).toBe(1); // only T1's rating, given on day(4)
      expect(b.summary.average).toBe(5);
    });

    it('unrated and unassigned tickets are handled', async () => {
      const t = await prisma.ticket.findFirst({ where: { number: { endsWith: 'R3' } } });
      await prisma.feedback.create({
        data: { ticketId: t.id, createdById: w.bob.id, rating: 1, createdAt: day(1, 5) },
      });
      const b = (await api('/reports/csat', await authAs(app, w.admin, 'ALL'))).body;
      expect(b.byAgent.find((a) => a.name === 'Unassigned')).toMatchObject({
        count: 1,
        average: 1,
      });
      expect(b.byCategory.find((c) => c.name === 'Uncategorised')).toMatchObject({ count: 1 });
      await prisma.feedback.deleteMany({ where: { ticketId: t.id } });
    });
  });

  describe('personal stats (/reports/me)', () => {
    it('shows only tickets assigned to the caller, within their projects', async () => {
      const a = (await api('/reports/me', await authAs(app, w.supportA, 'ALL'))).body;
      expect(a.totals).toMatchObject({ created: 3, resolved: 2, openNow: 2 }); // T1 T2 T4 created; T4 + T5 open
      expect(a.responseTimes.firstResponse).toEqual({ avgHours: 2.5, medianHours: 1, count: 3 });
      expect(a.responseTimes.resolution).toEqual({ avgHours: 19, medianHours: 19, count: 2 }); // 8 and 30
      expect(a.csat).toMatchObject({ count: 2, average: 3.5 });
      expect(a.sla.firstResponse).toEqual({ met: 2, total: 3, rate: 66.7 });
      expect(Object.fromEntries(a.statuses.map((s) => [s.status, s.count]))).toMatchObject({
        OPEN: 1,
        WAITING_ON_CUSTOMER: 1,
        RESOLVED: 1,
        CLOSED: 1,
      });
      expect(a.series.reduce((n, s) => n + s.created, 0)).toBe(3);
    });

    it("never mixes in other people's or other projects' numbers", async () => {
      const b = (await api('/reports/me', await authAs(app, w.supportB, w.B1.id))).body;
      expect(b.totals).toMatchObject({ created: 1, resolved: 1, openNow: 0 });
      expect(b.csat).toMatchObject({ count: 1, average: 3 });
      // supportBoth is assigned T7 in A2; selecting only A1 hides it
      const narrowed = (await api('/reports/me', await authAs(app, w.supportBoth, w.A1.id))).body;
      expect(narrowed.totals.created).toBe(0);
      const both = (await api('/reports/me', await authAs(app, w.supportBoth, 'ALL'))).body;
      expect(both.totals.created).toBe(1);
      expect(
        (await api(`/reports/me?projectId=${w.B1.id}`, await authAs(app, w.supportA, 'ALL')))
          .status,
      ).toBe(404);
    });

    it('works for an admin with nothing assigned', async () => {
      const b = (await api('/reports/me', await authAs(app, w.admin, 'ALL'))).body;
      expect(b.totals).toMatchObject({ created: 0, resolved: 0, openNow: 0 });
    });
  });

  describe('FAQ deflection', () => {
    it('reports deflected searches and respects scope and range', async () => {
      const art = await prisma.faqArticle.create({
        data: { projectId: w.A1.id, question: 'Deflect me', answer: 'a', status: 'PUBLISHED' },
      });
      await prisma.kbSearchLog.createMany({
        data: [
          { projectId: w.A1.id, userId: w.bob.id, query: 'invoice', resultCount: 0 },
          {
            projectId: w.A1.id,
            userId: w.bob.id,
            query: 'reset',
            resultCount: 2,
            clickedArticleId: art.id,
          },
          {
            projectId: w.A1.id,
            userId: w.alice.id,
            query: 'refund',
            resultCount: 1,
            clickedArticleId: art.id,
            createdTicketAfter: true,
          },
          { projectId: w.B1.id, userId: w.carol.id, query: 'org b secret', resultCount: 0 },
        ],
      });
      const all = (await api('/reports/deflection', await authAs(app, w.admin, 'ALL'))).body;
      expect(all.totals).toEqual({
        searches: 4,
        zeroResults: 2,
        clicked: 2,
        ticketsAfter: 1,
        deflected: 1,
        deflectionRate: 25,
      });
      expect(all.zeroResults.map((z) => z.query).sort()).toEqual(['invoice', 'org b secret']);
      const scoped = (await api('/reports/deflection', await authAs(app, w.admin, w.A1.id))).body;
      expect(scoped.totals.searches).toBe(3);
      expect(JSON.stringify(scoped)).not.toContain('org b secret');
      const past = (
        await api(
          `/reports/deflection?from=${iso(100)}&to=${iso(90)}`,
          await authAs(app, w.admin, 'ALL'),
        )
      ).body;
      expect(past.totals).toMatchObject({ searches: 0, deflectionRate: null });
    });
  });
});

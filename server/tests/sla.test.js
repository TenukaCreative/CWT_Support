import request from 'supertest';
import { createApp } from '../src/app.js';
import { HOUR, computeDueDates, slaPatchForTransition, slaState } from '../src/lib/sla.js';
import { prisma, resetDb, makeWorld, authAs } from './helpers.js';

const T0 = new Date('2026-03-01T09:00:00Z');
const at = (h) => new Date(T0.getTime() + h * HOUR);
const policy = { firstResponseHours: 4, resolutionHours: 24 };

describe('computeDueDates', () => {
  it('adds the targets to the creation time, plus time already paused', () => {
    expect(computeDueDates(T0, policy)).toEqual({
      firstResponseDueAt: at(4),
      resolutionDueAt: at(24),
    });
    const paused = computeDueDates(T0, policy, 3600);
    expect(paused.resolutionDueAt).toEqual(at(25));
  });
});

describe('slaPatchForTransition (pause / resume)', () => {
  const base = {
    slaPausedAt: null,
    slaPausedSeconds: 0,
    firstResponseAt: null,
    firstResponseDueAt: at(4),
    resolutionDueAt: at(24),
  };

  it('pausing stamps slaPausedAt and changes nothing else', () => {
    expect(slaPatchForTransition(base, 'WAITING_ON_CUSTOMER', at(1))).toEqual({
      slaPausedAt: at(1),
    });
  });

  it('resuming pushes both due dates out by the paused time and accumulates it', () => {
    const paused = { ...base, slaPausedAt: at(1) };
    const patch = slaPatchForTransition(paused, 'IN_PROGRESS', at(3)); // paused for 2h
    expect(patch).toEqual({
      slaPausedAt: null,
      slaPausedSeconds: 7200,
      resolutionDueAt: at(26),
      firstResponseDueAt: at(6),
    });
  });

  it('accumulates across several pauses', () => {
    const second = {
      ...base,
      slaPausedAt: at(10),
      slaPausedSeconds: 7200,
      resolutionDueAt: at(26),
    };
    const patch = slaPatchForTransition(second, 'IN_PROGRESS', at(11));
    expect(patch.slaPausedSeconds).toBe(7200 + 3600);
    expect(patch.resolutionDueAt).toEqual(at(27));
  });

  it('does not move a first-response target that was already met', () => {
    const patch = slaPatchForTransition(
      { ...base, slaPausedAt: at(1), firstResponseAt: at(0.5) },
      'IN_PROGRESS',
      at(3),
    );
    expect(patch.firstResponseDueAt).toBeUndefined();
    expect(patch.resolutionDueAt).toEqual(at(26));
  });

  it('moving straight from waiting to RESOLVED/CLOSED also resumes (and accounts for) the pause', () => {
    for (const to of ['RESOLVED', 'CLOSED']) {
      expect(
        slaPatchForTransition({ ...base, slaPausedAt: at(1) }, to, at(2)).slaPausedSeconds,
      ).toBe(3600);
    }
  });

  it('is a no-op for ordinary transitions', () => {
    expect(slaPatchForTransition(base, 'IN_PROGRESS', at(1))).toEqual({});
    expect(
      slaPatchForTransition({ ...base, slaPausedAt: at(1) }, 'WAITING_ON_CUSTOMER', at(2)),
    ).toEqual({});
  });
});

describe('slaState', () => {
  const ticket = (over = {}) => ({
    status: 'OPEN',
    createdAt: T0,
    firstResponseAt: null,
    resolvedAt: null,
    slaPausedAt: null,
    slaPausedSeconds: 0,
    mergedIntoId: null,
    firstResponseDueAt: at(4),
    resolutionDueAt: at(24),
    ...over,
  });

  it('OK well before the target, WARNING in the last quarter, BREACHED after it', () => {
    expect(slaState(ticket({ firstResponseDueAt: null }), at(1)).resolution.state).toBe('OK');
    // 24h window: warning from 18h onwards (25% left = 6h)
    expect(slaState(ticket({ firstResponseDueAt: null }), at(17.9)).resolution.state).toBe('OK');
    expect(slaState(ticket({ firstResponseDueAt: null }), at(18)).resolution.state).toBe('WARNING');
    expect(slaState(ticket({ firstResponseDueAt: null }), at(23.9)).resolution.state).toBe(
      'WARNING',
    );
    expect(slaState(ticket({ firstResponseDueAt: null }), at(24)).resolution.state).toBe(
      'BREACHED',
    );
    expect(
      slaState(ticket({ firstResponseDueAt: null }), at(30)).resolution.remainingMs,
    ).toBeLessThan(0);
  });

  it('a response/resolution that happened is MET or MET_LATE and never breaches afterwards', () => {
    expect(slaState(ticket({ firstResponseAt: at(2) }), at(100)).firstResponse.state).toBe('MET');
    expect(slaState(ticket({ firstResponseAt: at(5) }), at(100)).firstResponse.state).toBe(
      'MET_LATE',
    );
    expect(
      slaState(ticket({ status: 'RESOLVED', resolvedAt: at(20), firstResponseAt: at(1) }), at(100))
        .overall,
    ).toBe('MET');
  });

  it('is PAUSED (no countdown, cannot breach) while waiting on the customer', () => {
    const s = slaState(ticket({ status: 'WAITING_ON_CUSTOMER', slaPausedAt: at(2) }), at(500));
    expect(s.resolution.state).toBe('PAUSED');
    expect(s.firstResponse.state).toBe('PAUSED');
    expect(s.paused).toBe(true);
  });

  it('measures the warning window against the target excluding paused time', () => {
    // due was pushed out by 10h of pause; the real target is still 24h, so warning starts 6h before due
    const t = ticket({
      firstResponseDueAt: null,
      resolutionDueAt: at(34),
      slaPausedSeconds: 10 * 3600,
    });
    expect(slaState(t, at(27.9)).resolution.state).toBe('OK');
    expect(slaState(t, at(28)).resolution.state).toBe('WARNING');
  });

  it('closed-without-milestone and merged tickets stop counting', () => {
    expect(slaState(ticket({ status: 'CLOSED' }), at(100)).overall).toBe('NONE');
    expect(slaState(ticket({ status: 'CLOSED', mergedIntoId: 'x' }), at(100)).overall).toBe('NONE');
    expect(
      slaState(ticket({ firstResponseDueAt: null, resolutionDueAt: null }), at(100)).overall,
    ).toBe('NONE');
  });

  it('overall reports the most severe clock', () => {
    const s = slaState(ticket(), at(5)); // first response (4h) breached, resolution fine
    expect(s.firstResponse.state).toBe('BREACHED');
    expect(s.overall).toBe('BREACHED');
  });
});

describe('SLA in the ticket flows', () => {
  const app = createApp();
  let w;
  const api = (m, p, h) => request(app)[m](`/api/v1${p}`).set(h);
  const create = (h, f = {}) =>
    api('post', '/tickets', h)
      .field('subject', 'Something is broken')
      .field('description', 'Details of the problem here.')
      .field('priority', f.priority ?? 'MEDIUM');

  beforeEach(async () => {
    await resetDb();
    w = await makeWorld();
  });
  afterAll(() => prisma.$disconnect());

  it('sets due dates from the built-in defaults when no policy exists', async () => {
    const res = await create(await authAs(app, w.bob, w.A1.id));
    const t = await prisma.ticket.findUnique({ where: { id: res.body.ticket.id } });
    expect(t.resolutionDueAt.getTime() - t.createdAt.getTime()).toBe(24 * HOUR);
    expect(t.firstResponseDueAt.getTime() - t.createdAt.getTime()).toBe(8 * HOUR);
  });

  it('a project override beats the global policy, which beats the defaults', async () => {
    await prisma.slaPolicy.create({
      data: { projectId: null, priority: 'HIGH', firstResponseHours: 2, resolutionHours: 6 },
    });
    await prisma.slaPolicy.create({
      data: { projectId: w.A1.id, priority: 'HIGH', firstResponseHours: 1, resolutionHours: 3 },
    });
    const bob = await authAs(app, w.bob, w.A1.id);
    const a1 = await prisma.ticket.findUnique({
      where: { id: (await create(bob, { priority: 'HIGH' })).body.ticket.id },
    });
    expect(a1.resolutionDueAt.getTime() - a1.createdAt.getTime()).toBe(3 * HOUR);
    const a2 = await prisma.ticket.findUnique({
      where: {
        id: (await create(await authAs(app, w.alice, w.A2.id), { priority: 'HIGH' })).body.ticket
          .id,
      },
    });
    expect(a2.resolutionDueAt.getTime() - a2.createdAt.getTime()).toBe(6 * HOUR);
  });

  it('changing priority recomputes the targets from creation time and clears the flags', async () => {
    const id = (await create(await authAs(app, w.bob, w.A1.id))).body.ticket.id;
    await prisma.ticket.update({
      where: { id },
      data: { slaBreachedAt: new Date(), slaWarnedAt: new Date() },
    });
    await api('patch', `/tickets/${id}`, await authAs(app, w.supportA, w.A1.id)).send({
      priority: 'URGENT',
    });
    const t = await prisma.ticket.findUnique({ where: { id } });
    expect(t.resolutionDueAt.getTime() - t.createdAt.getTime()).toBe(4 * HOUR);
    expect(t.firstResponseDueAt.getTime() - t.createdAt.getTime()).toBe(1 * HOUR);
    expect(t.slaBreachedAt).toBeNull();
    expect(t.slaWarnedAt).toBeNull();
  });

  it("waiting on the customer pauses the clock; the customer's reply resumes it and extends the due dates", async () => {
    const id = (await create(await authAs(app, w.bob, w.A1.id))).body.ticket.id;
    const support = await authAs(app, w.supportA, w.A1.id);
    const before = await prisma.ticket.findUnique({ where: { id } });

    await api('post', `/tickets/${id}/status`, support).send({ status: 'WAITING_ON_CUSTOMER' });
    const paused = await prisma.ticket.findUnique({ where: { id } });
    expect(paused.slaPausedAt).toBeInstanceOf(Date);
    expect((await api('get', `/tickets/${id}`, support)).body.ticket.sla.overall).toBe('PAUSED');

    // pretend the pause started 2 hours ago
    await prisma.ticket.update({
      where: { id },
      data: { slaPausedAt: new Date(Date.now() - 2 * HOUR) },
    });
    await api('post', `/tickets/${id}/messages`, await authAs(app, w.bob, w.A1.id)).field(
      'body',
      'Here is the info you asked for',
    );

    const resumed = await prisma.ticket.findUnique({ where: { id } });
    expect(resumed.status).toBe('IN_PROGRESS');
    expect(resumed.slaPausedAt).toBeNull();
    expect(resumed.slaPausedSeconds).toBeGreaterThanOrEqual(7199);
    expect(resumed.slaPausedSeconds).toBeLessThanOrEqual(7202);
    const shift = resumed.resolutionDueAt.getTime() - before.resolutionDueAt.getTime();
    expect(Math.abs(shift - 2 * HOUR)).toBeLessThan(3000);
  });

  it('staff resolving a waiting ticket also resumes (accounts for) the pause', async () => {
    const id = (await create(await authAs(app, w.bob, w.A1.id))).body.ticket.id;
    const support = await authAs(app, w.supportA, w.A1.id);
    await api('post', `/tickets/${id}/status`, support).send({ status: 'WAITING_ON_CUSTOMER' });
    await prisma.ticket.update({
      where: { id },
      data: { slaPausedAt: new Date(Date.now() - HOUR) },
    });
    await api('post', `/tickets/${id}/status`, support).send({ status: 'RESOLVED' });
    const t = await prisma.ticket.findUnique({ where: { id } });
    expect(t.slaPausedAt).toBeNull();
    expect(t.slaPausedSeconds).toBeGreaterThanOrEqual(3599);
  });

  it('SLA data is for staff only', async () => {
    const id = w.tA1.ticket.id;
    const staff = (await api('get', `/tickets/${id}`, await authAs(app, w.supportA, w.A1.id))).body
      .ticket;
    expect(staff.sla).toMatchObject({
      overall: expect.any(String),
      firstResponse: expect.any(Object),
      resolution: expect.any(Object),
    });
    const bob = await api('get', `/tickets/${id}`, await authAs(app, w.bob, w.A1.id));
    expect(bob.body.ticket.sla).toBeUndefined();
    expect(JSON.stringify(bob.body)).not.toMatch(/DueAt|slaPaused|slaBreached/);
    const list = await api('get', '/tickets', await authAs(app, w.bob, w.A1.id));
    expect(JSON.stringify(list.body)).not.toMatch(/DueAt|slaPaused|slaBreached|"sla"/);
    expect(
      (await api('get', '/tickets', await authAs(app, w.supportA, w.A1.id))).body.items[0].sla,
    ).toBeDefined();
  });
});

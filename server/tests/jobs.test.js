import { runAutoClose } from '../src/jobs/autoClose.job.js';
import { runSlaCheck } from '../src/jobs/sla.job.js';
import { HOUR } from '../src/lib/sla.js';
import { prisma, outbox, resetDb, makeWorld } from './helpers.js';

let w;
const mk = async (project, creator, over = {}) => {
  const { ticketSeq } = await prisma.project.update({
    where: { id: project.id },
    data: { ticketSeq: { increment: 1 } },
  });
  return prisma.ticket.create({
    data: {
      projectId: project.id,
      createdById: creator.id,
      subject: 'Job test ticket',
      description: 'Description text here',
      sequence: ticketSeq,
      number: `${project.key}-${String(ticketSeq).padStart(4, '0')}`,
      ...over,
    },
  });
};
const hoursAgo = (h) => new Date(Date.now() - h * HOUR);
const hoursAhead = (h) => new Date(Date.now() + h * HOUR);
const events = (ticketId, type) => prisma.ticketEvent.findMany({ where: { ticketId, type } });
const notifs = (type) => prisma.notification.findMany({ where: { type } });

beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  await prisma.ticket.deleteMany(); // jobs look at ALL tickets: start from none
});
afterAll(() => prisma.$disconnect());

describe('SLA check job', () => {
  it('flags a breach once: event, flag, in-app + email to the assignee and every admin', async () => {
    const t = await mk(w.A1, w.bob, {
      assigneeId: w.supportA.id,
      createdAt: hoursAgo(30),
      resolutionDueAt: hoursAgo(1),
    });
    outbox.length = 0;
    expect(await runSlaCheck()).toMatchObject({ breached: 1, warned: 0 });

    expect((await prisma.ticket.findUnique({ where: { id: t.id } })).slaBreachedAt).toBeInstanceOf(
      Date,
    );
    expect(await events(t.id, 'SLA_BREACHED')).toHaveLength(1);
    expect((await events(t.id, 'SLA_BREACHED'))[0].toValue).toBe('resolution');
    expect((await notifs('SLA_BREACHED')).map((n) => n.userId).sort()).toEqual(
      [w.admin.id, w.supportA.id].sort(),
    );
    expect(outbox.map((m) => m.to).sort()).toEqual(['admin@test.dev', 'supporta@test.dev']);
    expect(outbox[0].subject).toContain('SLA breached');

    // idempotent: the next tick must not notify again
    expect(await runSlaCheck()).toMatchObject({ breached: 0, warned: 0 });
    expect(await events(t.id, 'SLA_BREACHED')).toHaveLength(1);
    expect(await notifs('SLA_BREACHED')).toHaveLength(2);
  });

  it('warns once when little time is left (assignee only), then still flags the later breach', async () => {
    const t = await mk(w.A1, w.bob, {
      assigneeId: w.supportA.id,
      createdAt: hoursAgo(20),
      resolutionDueAt: hoursAhead(4),
    }); // 24h window, 4h left < 6h
    expect(await runSlaCheck()).toMatchObject({ warned: 1, breached: 0 });
    expect(await runSlaCheck()).toMatchObject({ warned: 0, breached: 0 });
    expect((await notifs('SLA_WARNING')).map((n) => n.userId)).toEqual([w.supportA.id]);
    expect(await notifs('SLA_BREACHED')).toHaveLength(0);

    await prisma.ticket.update({ where: { id: t.id }, data: { resolutionDueAt: hoursAgo(1) } });
    expect(await runSlaCheck()).toMatchObject({ breached: 1 });
    expect(await events(t.id, 'SLA_WARNING')).toHaveLength(1);
    expect(await events(t.id, 'SLA_BREACHED')).toHaveLength(1);
  });

  it('flags a missed first response on a ticket nobody has answered', async () => {
    const t = await mk(w.A1, w.bob, {
      createdAt: hoursAgo(10),
      firstResponseDueAt: hoursAgo(2),
      resolutionDueAt: hoursAhead(14),
    });
    await runSlaCheck();
    expect((await events(t.id, 'SLA_BREACHED'))[0].toValue).toBe('firstResponse');
  });

  it('alerts project support when the ticket is unassigned, and not support of other projects', async () => {
    await mk(w.A1, w.bob, { createdAt: hoursAgo(30), resolutionDueAt: hoursAgo(1) });
    await runSlaCheck();
    const ids = (await notifs('SLA_BREACHED')).map((n) => n.userId);
    expect(ids).toEqual(expect.arrayContaining([w.supportA.id, w.supportBoth.id, w.admin.id]));
    expect(ids).not.toContain(w.supportB.id);
  });

  it('ignores paused, resolved, closed, merged and healthy tickets', async () => {
    const overdue = {
      createdAt: hoursAgo(30),
      resolutionDueAt: hoursAgo(1),
      firstResponseDueAt: hoursAgo(20),
    };
    await mk(w.A1, w.bob, { ...overdue, status: 'WAITING_ON_CUSTOMER', slaPausedAt: hoursAgo(3) });
    await mk(w.A1, w.bob, {
      ...overdue,
      status: 'RESOLVED',
      resolvedAt: hoursAgo(2),
      firstResponseAt: hoursAgo(25),
    });
    await mk(w.A1, w.bob, { ...overdue, status: 'CLOSED' });
    await mk(w.A1, w.bob, {
      createdAt: hoursAgo(1),
      resolutionDueAt: hoursAhead(23),
      firstResponseDueAt: hoursAhead(7),
    });
    const target = await mk(w.A1, w.bob, {
      createdAt: hoursAgo(1),
      resolutionDueAt: hoursAhead(23),
    });
    await mk(w.A1, w.bob, { ...overdue, mergedIntoId: target.id });
    expect(await runSlaCheck()).toMatchObject({ warned: 0, breached: 0 });
    expect(
      await prisma.ticketEvent.count({ where: { type: { in: ['SLA_WARNING', 'SLA_BREACHED'] } } }),
    ).toBe(0);
  });

  it('survives running twice at the same time (only one run wins the flag)', async () => {
    const t = await mk(w.A1, w.bob, {
      assigneeId: w.supportA.id,
      createdAt: hoursAgo(30),
      resolutionDueAt: hoursAgo(1),
    });
    const [a, b] = await Promise.all([runSlaCheck(), runSlaCheck()]);
    expect(a.breached + b.breached).toBe(1);
    expect(await events(t.id, 'SLA_BREACHED')).toHaveLength(1);
  });
});

describe('auto-close job', () => {
  it('closes tickets resolved longer ago than the setting, with event, system message and notification', async () => {
    const old = await mk(w.A1, w.bob, { status: 'RESOLVED', resolvedAt: hoursAgo(24 * 8) });
    const fresh = await mk(w.A1, w.bob, { status: 'RESOLVED', resolvedAt: hoursAgo(24 * 3) });
    outbox.length = 0;
    expect(await runAutoClose()).toEqual({ closed: 1 });

    const closed = await prisma.ticket.findUnique({ where: { id: old.id } });
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect((await prisma.ticket.findUnique({ where: { id: fresh.id } })).status).toBe('RESOLVED');
    const ev = await prisma.ticketEvent.findFirst({ where: { ticketId: old.id } });
    expect(ev).toMatchObject({
      type: 'STATUS_CHANGED',
      fromValue: 'RESOLVED',
      toValue: 'CLOSED',
      actorId: null,
    });
    const msg = await prisma.ticketMessage.findFirst({
      where: { ticketId: old.id, type: 'SYSTEM' },
    });
    expect(msg.body).toBe('Automatically closed after 7 days without a reply');
    expect((await notifs('TICKET_STATUS_CHANGED')).map((n) => n.userId)).toEqual([w.bob.id]);
    expect(outbox[0].to).toBe('bob@test.dev');
    expect(await runAutoClose()).toEqual({ closed: 0 }); // idempotent
  });

  it('respects the configurable number of days', async () => {
    const t = await mk(w.A1, w.bob, { status: 'RESOLVED', resolvedAt: hoursAgo(24 * 3) });
    expect(await runAutoClose()).toEqual({ closed: 0 });
    await prisma.setting.create({ data: { key: 'autoCloseAfterDays', value: 2 } });
    expect(await runAutoClose()).toEqual({ closed: 1 });
    expect((await prisma.ticket.findUnique({ where: { id: t.id } })).status).toBe('CLOSED');
  });

  it('never touches reopened, waiting or already closed tickets', async () => {
    await mk(w.A1, w.bob, { status: 'REOPENED' });
    await mk(w.A1, w.bob, { status: 'WAITING_ON_CUSTOMER', resolvedAt: hoursAgo(24 * 30) });
    await mk(w.A1, w.bob, { status: 'CLOSED', resolvedAt: hoursAgo(24 * 30) });
    expect(await runAutoClose()).toEqual({ closed: 0 });
  });
});

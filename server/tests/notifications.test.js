import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, outbox, resetDb, makeWorld, authAs } from './helpers.js';

const app = createApp();
let w;
const api = (m, p, h) => request(app)[m](`/api/v1${p}`).set(h);
const reply = (h, id, body, type = 'PUBLIC') =>
  api('post', `/tickets/${id}/messages`, h).field('body', body).field('type', type);
const status = (h, id, s) => api('post', `/tickets/${id}/status`, h).send({ status: s });
const inApp = (userId, type) =>
  prisma.notification.findMany({ where: { userId, ...(type ? { type } : {}) } });
const mailTo = (email) => outbox.filter((m) => m.to === email);

beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});
afterAll(() => prisma.$disconnect());

describe('who gets notified', () => {
  it('ticket creation sends the customer a confirmation (email + in-app)', async () => {
    const res = await api('post', '/tickets', await authAs(app, w.bob, w.A1.id))
      .field('subject', 'Brand new problem')
      .field('description', 'This is the description.');
    const n = (await inApp(w.bob.id, 'TICKET_CREATED'))[0];
    expect(n).toMatchObject({
      ticketId: res.body.ticket.id,
      title: expect.stringContaining(res.body.ticket.number),
      readAt: null,
    });
    expect(mailTo('bob@test.dev')[0].subject).toContain(res.body.ticket.number);
    expect(mailTo('bob@test.dev')[0].text).toContain(`/app/tickets/${res.body.ticket.id}`);
  });

  it('assigning notifies the assignee, but never the person who did it', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    await api('post', `/tickets/${w.tA1.ticket.id}/assign`, support).send({
      assigneeId: w.supportBoth.id,
    });
    expect((await inApp(w.supportBoth.id, 'TICKET_ASSIGNED')).length).toBe(1);
    expect(mailTo('supportboth@test.dev')).toHaveLength(1);
    outbox.length = 0;
    await api('post', `/tickets/${w.tA1.ticket.id}/assign`, support).send({
      assigneeId: w.supportA.id,
    }); // self-assign
    expect(await inApp(w.supportA.id, 'TICKET_ASSIGNED')).toHaveLength(0);
    expect(mailTo('supporta@test.dev')).toHaveLength(0);
  });

  it('bulk assignment sends ONE email but one in-app notification per ticket', async () => {
    const both = await authAs(app, w.supportBoth, 'ALL');
    await api('post', '/tickets/bulk-assign', await authAs(app, w.admin, 'ALL')).send({
      ticketIds: [w.tA1.ticket.id, w.tA2.ticket.id],
      assigneeId: w.supportBoth.id,
    });
    expect(await inApp(w.supportBoth.id, 'TICKET_ASSIGNED')).toHaveLength(2);
    expect(mailTo('supportboth@test.dev')).toHaveLength(1);
    expect(mailTo('supportboth@test.dev')[0].text).toContain('2 tickets');
    void both;
  });

  it('a staff reply notifies the customer who raised the ticket, with a snippet of the reply', async () => {
    await reply(
      await authAs(app, w.supportA, w.A1.id),
      w.tA1.ticket.id,
      'We found the cause and are fixing it.',
    );
    const n = (await inApp(w.bob.id, 'TICKET_REPLY'))[0];
    expect(n.body).toContain('We found the cause');
    expect(mailTo('bob@test.dev')[0].text).toContain('We found the cause');
    // other customers of the project are not spammed
    expect(await inApp(w.alice.id)).toHaveLength(0);
  });

  it('a customer reply notifies the assignee; unassigned tickets notify nobody', async () => {
    const bob = await authAs(app, w.bob, w.A1.id);
    await reply(bob, w.tA1.ticket.id, 'Any news?');
    expect(await prisma.notification.count()).toBe(0);
    await prisma.ticket.update({
      where: { id: w.tA1.ticket.id },
      data: { assigneeId: w.supportA.id },
    });
    await reply(bob, w.tA1.ticket.id, 'Still waiting');
    expect((await inApp(w.supportA.id, 'TICKET_REPLY')).length).toBe(1);
    expect(mailTo('supporta@test.dev')).toHaveLength(1);
  });

  it('internal notes notify NOBODY', async () => {
    await prisma.ticket.update({
      where: { id: w.tA1.ticket.id },
      data: { assigneeId: w.supportA.id },
    });
    await reply(
      await authAs(app, w.supportBoth, w.A1.id),
      w.tA1.ticket.id,
      'private remark for the team',
      'INTERNAL_NOTE',
    );
    expect(await prisma.notification.count()).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it('resolving notifies the customer with a feedback link; closing/reopening by the customer notifies the assignee', async () => {
    await prisma.ticket.update({
      where: { id: w.tA1.ticket.id },
      data: { assigneeId: w.supportA.id },
    });
    await status(await authAs(app, w.supportA, w.A1.id), w.tA1.ticket.id, 'RESOLVED');
    const n = (await inApp(w.bob.id, 'TICKET_RESOLVED'))[0];
    expect(n.title).toContain('was resolved');
    expect(mailTo('bob@test.dev')[0].text).toContain(`/app/tickets/${w.tA1.ticket.id}?rate=1`);

    const bob = await authAs(app, w.bob, w.A1.id);
    await status(bob, w.tA1.ticket.id, 'REOPENED');
    const n2 = await inApp(w.supportA.id, 'TICKET_STATUS_CHANGED');
    expect(n2[0].title).toContain('was reopened');
    expect(await inApp(w.bob.id, 'TICKET_STATUS_CHANGED')).toHaveLength(0); // actor is not told about own action
  });

  it("other status changes notify the customer; a merge notifies the duplicate's creator", async () => {
    await status(await authAs(app, w.supportA, w.A1.id), w.tA1.ticket.id, 'WAITING_ON_CUSTOMER');
    expect((await inApp(w.bob.id, 'TICKET_STATUS_CHANGED'))[0].title).toContain(
      'waiting for your reply',
    );

    const { ticketSeq } = await prisma.project.update({
      where: { id: w.A1.id },
      data: { ticketSeq: { increment: 1 } },
    });
    const dup = await prisma.ticket.create({
      data: {
        projectId: w.A1.id,
        createdById: w.alice.id,
        subject: 'Dup of bobs',
        description: 'duplicate text here',
        sequence: ticketSeq,
        number: `A-ONE-000${ticketSeq}`,
      },
    });
    await api('post', `/tickets/${dup.id}/merge`, await authAs(app, w.supportA, w.A1.id)).send({
      targetTicketId: w.tA1.ticket.id,
    });
    expect((await inApp(w.alice.id, 'TICKET_STATUS_CHANGED'))[0].title).toContain(
      'was merged into A-ONE-0001',
    );
  });
});

describe('preferences', () => {
  const setPrefs = (user, prefs) =>
    prisma.user.update({ where: { id: user.id }, data: { notificationPrefs: prefs } });
  const all = {
    emailOnReply: true,
    emailOnStatusChange: true,
    emailOnAssignment: true,
    inApp: true,
  };
  const trigger = () => reply(authAs ? null : null, '', '');

  it('emailOnReply=false keeps the in-app notification but sends no email', async () => {
    await setPrefs(w.bob, { ...all, emailOnReply: false });
    await reply(await authAs(app, w.supportA, w.A1.id), w.tA1.ticket.id, 'Here is an answer');
    expect(await inApp(w.bob.id, 'TICKET_REPLY')).toHaveLength(1);
    expect(mailTo('bob@test.dev')).toHaveLength(0);
  });

  it('inApp=false sends the email but creates no in-app notification', async () => {
    await setPrefs(w.bob, { ...all, inApp: false });
    await reply(await authAs(app, w.supportA, w.A1.id), w.tA1.ticket.id, 'Here is an answer');
    expect(await inApp(w.bob.id)).toHaveLength(0);
    expect(mailTo('bob@test.dev')).toHaveLength(1);
  });

  it('both off = silence; each event type uses its own switch', async () => {
    await setPrefs(w.bob, {
      emailOnReply: false,
      emailOnStatusChange: false,
      emailOnAssignment: false,
      inApp: false,
    });
    const support = await authAs(app, w.supportA, w.A1.id);
    await reply(support, w.tA1.ticket.id, 'answer');
    await status(support, w.tA1.ticket.id, 'RESOLVED');
    expect(await inApp(w.bob.id)).toHaveLength(0);
    expect(mailTo('bob@test.dev')).toHaveLength(0);

    // only the status switch on: reply stays silent, resolve is emailed
    await setPrefs(w.bob, { ...all, emailOnReply: false, inApp: false });
    await prisma.ticket.update({
      where: { id: w.tA1.ticket.id },
      data: { status: 'OPEN', resolvedAt: null },
    });
    await reply(support, w.tA1.ticket.id, 'another answer');
    expect(mailTo('bob@test.dev')).toHaveLength(0);
    await status(support, w.tA1.ticket.id, 'RESOLVED');
    expect(mailTo('bob@test.dev')).toHaveLength(1);
    void trigger;
  });

  it('transactional mail (ticket confirmation) ignores the email switches', async () => {
    await setPrefs(w.bob, {
      ...all,
      emailOnReply: false,
      emailOnStatusChange: false,
      emailOnAssignment: false,
    });
    await api('post', '/tickets', await authAs(app, w.bob, w.A1.id))
      .field('subject', 'Needs a confirmation')
      .field('description', 'Confirm that you got this.');
    expect(mailTo('bob@test.dev')).toHaveLength(1);
  });

  it('deactivated users are skipped', async () => {
    await prisma.user.update({ where: { id: w.bob.id }, data: { status: 'DEACTIVATED' } });
    await reply(await authAs(app, w.supportA, w.A1.id), w.tA1.ticket.id, 'hello');
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe('in-app notification API', () => {
  const seed = async () => {
    await prisma.notification.createMany({
      data: [
        { userId: w.bob.id, type: 'TICKET_REPLY', title: 'Reply 1', ticketId: w.tA1.ticket.id },
        {
          userId: w.bob.id,
          type: 'TICKET_REPLY',
          title: 'Reply 2',
          ticketId: w.tA1.ticket.id,
          readAt: new Date(),
        },
        { userId: w.bob.id, type: 'TICKET_RESOLVED', title: 'Resolved', ticketId: w.tA1.ticket.id },
        {
          userId: w.carol.id,
          type: 'TICKET_REPLY',
          title: 'Carols private one',
          ticketId: w.tB1.ticket.id,
        },
      ],
    });
    return prisma.notification.findFirst({ where: { title: 'Carols private one' } });
  };

  it('lists only my own notifications, newest first, with the ticket reference', async () => {
    await seed();
    const res = await api('get', '/notifications', await authAs(app, w.bob, w.A1.id));
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((n) => n.title).sort()).toEqual(['Reply 1', 'Reply 2', 'Resolved']);
    expect(res.body.items[0].ticket).toEqual({
      id: w.tA1.ticket.id,
      number: 'A-ONE-0001',
      projectId: w.A1.id,
    });
    expect(JSON.stringify(res.body)).not.toContain('Carols');
  });

  it('counts, filters and pages unread notifications', async () => {
    await seed();
    const bob = await authAs(app, w.bob, w.A1.id);
    expect((await api('get', '/notifications/unread-count', bob)).body).toEqual({ unread: 2 });
    expect((await api('get', '/notifications?unread=true', bob)).body.total).toBe(2);
    const p = await api('get', '/notifications?limit=2&page=2', bob);
    expect(p.body).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect(p.body.items).toHaveLength(1);
  });

  it("marks one or all as read; someone else's notification is a 404", async () => {
    const carols = await seed();
    const bob = await authAs(app, w.bob, w.A1.id);
    const mine = (await api('get', '/notifications?unread=true', bob)).body.items[0];
    expect((await api('post', `/notifications/${mine.id}/read`, bob)).status).toBe(204);
    expect((await api('get', '/notifications/unread-count', bob)).body.unread).toBe(1);
    expect((await api('post', `/notifications/${carols.id}/read`, bob)).status).toBe(404);
    expect((await prisma.notification.findUnique({ where: { id: carols.id } })).readAt).toBeNull();
    expect((await api('post', '/notifications/read-all', bob)).body).toEqual({ updated: 1 });
    expect((await api('get', '/notifications/unread-count', bob)).body.unread).toBe(0);
    expect((await prisma.notification.findUnique({ where: { id: carols.id } })).readAt).toBeNull(); // read-all is mine only
  });

  it('requires authentication but not a selected project', async () => {
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
    expect((await api('get', '/notifications', await authAs(app, w.alice))).status).toBe(200); // alice has not picked a project
  });
});

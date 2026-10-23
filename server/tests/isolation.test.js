import request from 'supertest';
import { createApp } from '../src/app.js';
import { AppError } from '../src/lib/errors.js';
import { buildScope } from '../src/lib/scope.js';
import { scopedDb } from '../src/lib/scopedDb.js';
import { prisma, resetDb, makeWorld, authAs } from './helpers.js';

const app = createApp();
const get = (path, headers) => request(app).get(`/api/v1${path}`).set(headers);
let w;

beforeAll(async () => {
  await resetDb();
  w = await makeWorld();
});
afterAll(() => prisma.$disconnect());

const expect404 = (res) => {
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('NOT_FOUND');
};

describe('HTTP: customer', () => {
  it('reads own project tickets, but never sees internal notes', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    const res = await get(`/tickets/${w.tA1.ticket.id}`, h);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m) => m.type)).toEqual(['PUBLIC']);
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });

  it('cannot read a ticket from another organisation, or a project they are not in', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    expect404(await get(`/tickets/${w.tB1.ticket.id}`, h)); // other org
    expect404(await get(`/tickets/${w.tA2.ticket.id}`, h)); // same org, not a member
  });

  it('cannot reach another project even when they belong to it, until they switch', async () => {
    const onA1 = await authAs(app, w.alice, w.A1.id);
    expect((await get(`/tickets/${w.tA1.ticket.id}`, onA1)).status).toBe(200);
    expect404(await get(`/tickets/${w.tA2.ticket.id}`, onA1));
    const onA2 = await authAs(app, w.alice, w.A2.id);
    expect((await get(`/tickets/${w.tA2.ticket.id}`, onA2)).status).toBe(200);
    expect404(await get(`/tickets/${w.tA1.ticket.id}`, onA2));
  });

  it('attachments: own public file yes; internal-note file, other project, other org no', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    const ok = await get(`/attachments/${w.tA1.pubAttachment.id}`, h);
    expect(ok.status).toBe(200);
    expect(ok.body.attachment.storedName).toBeUndefined();
    expect404(await get(`/attachments/${w.tA1.noteAttachment.id}`, h));
    expect404(await get(`/attachments/${w.tA2.pubAttachment.id}`, h));
    expect404(await get(`/attachments/${w.tB1.pubAttachment.id}`, h));
  });

  it('FAQ: own project + global published only; drafts and other tenants are invisible', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    expect((await get(`/faq/articles/${w.faq.A1.id}`, h)).status).toBe(200);
    expect((await get(`/faq/articles/${w.faq.global.id}`, h)).status).toBe(200);
    expect404(await get(`/faq/articles/${w.faq.A1Draft.id}`, h));
    expect404(await get(`/faq/articles/${w.faq.A2.id}`, h));
    expect404(await get(`/faq/articles/${w.faq.B1.id}`, h));
  });

  it('out-of-scope and nonexistent ids are indistinguishable', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    const real = await get(`/tickets/${w.tB1.ticket.id}`, h);
    const fake = await get('/tickets/does-not-exist', h);
    expect(real.status).toBe(fake.status);
    expect(real.body).toEqual(fake.body);
  });
});

describe('HTTP: support', () => {
  it('sees internal notes and internal-note attachments in assigned projects', async () => {
    const h = await authAs(app, w.supportA, w.A1.id);
    const res = await get(`/tickets/${w.tA1.ticket.id}`, h);
    expect(res.body.messages.map((m) => m.type)).toEqual(['PUBLIC', 'INTERNAL_NOTE']);
    expect((await get(`/attachments/${w.tA1.noteAttachment.id}`, h)).status).toBe(200);
    expect((await get(`/faq/articles/${w.faq.A1Draft.id}`, h)).status).toBe(200);
  });

  it('cannot access unassigned projects, in the same or another org', async () => {
    const h = await authAs(app, w.supportA, w.A1.id);
    expect404(await get(`/tickets/${w.tA2.ticket.id}`, h));
    expect404(await get(`/tickets/${w.tB1.ticket.id}`, h));
    expect404(await get(`/attachments/${w.tB1.pubAttachment.id}`, h));
    expect404(await get(`/faq/articles/${w.faq.B1.id}`, h));
  });

  it('"All projects" widens only to assigned projects', async () => {
    const h = await authAs(app, w.supportBoth, 'ALL');
    expect((await get(`/tickets/${w.tA1.ticket.id}`, h)).status).toBe(200);
    expect((await get(`/tickets/${w.tA2.ticket.id}`, h)).status).toBe(200);
    expect404(await get(`/tickets/${w.tB1.ticket.id}`, h));
  });
});

describe('HTTP: admin', () => {
  it('"All projects" reaches everything; a specific project narrows', async () => {
    const all = await authAs(app, w.admin, 'ALL');
    for (const t of [w.tA1, w.tA2, w.tB1])
      expect((await get(`/tickets/${t.ticket.id}`, all)).status).toBe(200);
    const one = await authAs(app, w.admin, w.A1.id);
    expect((await get(`/tickets/${w.tA1.ticket.id}`, one)).status).toBe(200);
    expect404(await get(`/tickets/${w.tB1.ticket.id}`, one));
  });
});

describe('HTTP: unauthenticated', () => {
  it('is rejected', async () => {
    expect((await request(app).get(`/api/v1/tickets/${w.tA1.ticket.id}`)).status).toBe(401);
  });
});

describe('scopedDb (data layer)', () => {
  const scopeFor = (user, activeProjectId, accessible) =>
    buildScope({
      role: user.role,
      userId: user.id,
      organizationId: user.organizationId,
      activeProjectId,
      accessibleProjectIds: accessible,
    });
  const bobDb = () => scopedDb(scopeFor(w.bob, w.A1.id, [w.A1.id]));
  const staffDb = () => scopedDb(scopeFor(w.supportA, w.A1.id, [w.A1.id]));

  it('findMany/count are constrained to the project', async () => {
    const tickets = await bobDb().ticket.findMany();
    expect(tickets.map((t) => t.id)).toEqual([w.tA1.ticket.id]);
    expect(await bobDb().ticket.count()).toBe(1);
    expect(await bobDb().ticketMessage.count()).toBe(1); // internal note filtered out
    expect(await staffDb().ticketMessage.count()).toBe(2);
  });

  it('caller-supplied filters cannot widen the scope (OR injection)', async () => {
    const rows = await bobDb().ticket.findMany({
      where: { OR: [{ projectId: w.B1.id }, { id: w.tB1.ticket.id }] },
    });
    expect(rows).toEqual([]);
  });

  it('updates and deletes outside the scope do nothing / fail', async () => {
    await expect(
      bobDb().ticket.update({ where: { id: w.tB1.ticket.id }, data: { subject: 'pwned' } }),
    ).rejects.toMatchObject({ code: 'P2025' });
    expect(
      (await bobDb().ticket.updateMany({ where: {}, data: { priority: 'URGENT' } })).count,
    ).toBe(1);
    expect((await bobDb().ticket.deleteMany({ where: { id: w.tB1.ticket.id } })).count).toBe(0);
    expect((await prisma.ticket.findUnique({ where: { id: w.tB1.ticket.id } })).subject).toBe(
      'B1 ticket',
    );
  });

  it('creates in another project are refused', async () => {
    const data = {
      projectId: w.B1.id,
      createdById: w.bob.id,
      subject: 'x',
      description: 'x',
      sequence: 99,
      number: 'B-ONE-0099',
    };
    await expect(bobDb().ticket.create({ data })).rejects.toBeInstanceOf(AppError);
    await expect(
      bobDb().ticketMessage.create({
        data: { ticketId: w.tB1.ticket.id, authorId: w.bob.id, body: 'hi', type: 'PUBLIC' },
      }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      bobDb().faqArticle.create({ data: { projectId: null, question: 'g', answer: 'a' } }),
    ).rejects.toBeInstanceOf(AppError);
    expect(await prisma.ticket.count({ where: { number: 'B-ONE-0099' } })).toBe(0);
  });

  it('refuses nested relation includes that would bypass message scoping (customers)', async () => {
    await expect(bobDb().ticket.findMany({ include: { messages: true } })).rejects.toThrow(
      /Unscoped nested relation/,
    );
    await expect(
      bobDb().ticket.findMany({ select: { messages: { select: { body: true } } } }),
    ).rejects.toThrow(/Unscoped nested relation/);
    await expect(
      bobDb().ticketMessage.findMany({ include: { ticket: { include: { attachments: true } } } }),
    ).rejects.toThrow(/Unscoped nested relation/);
  });

  it('upsert is not available on scoped models', async () => {
    await expect(
      bobDb().ticket.upsert({ where: { id: 'x' }, create: {}, update: {} }),
    ).rejects.toThrow(/upsert/);
  });

  it('staff-only models are empty for customers; notifications are per-user', async () => {
    await prisma.cannedReply.create({ data: { title: 't', body: 'b' } });
    expect(await bobDb().cannedReply.count()).toBe(0);
    expect(await staffDb().cannedReply.count()).toBe(1);
    await prisma.notification.create({
      data: { userId: w.bob.id, type: 'TICKET_CREATED', title: 'n' },
    });
    expect(await bobDb().notification.count()).toBe(1);
    expect(await staffDb().notification.count()).toBe(0);
  });

  it('a customer with an empty scope (no/forged project) sees nothing at all', async () => {
    const db = scopedDb(scopeFor(w.bob, w.B1.id, [w.A1.id]));
    expect(await db.ticket.count()).toBe(0);
    expect(await db.attachment.count()).toBe(0);
    expect(await db.feedback.count()).toBe(0);
  });
});

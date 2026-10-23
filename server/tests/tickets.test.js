import fs from 'node:fs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { UPLOAD_ROOT } from '../src/middleware/upload.js';
import { prisma, resetDb, makeWorld, authAs } from './helpers.js';

const app = createApp();
let w;

const api = (method, path, headers) => request(app)[method](`/api/v1${path}`).set(headers);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const filesOnDisk = () => (fs.existsSync(UPLOAD_ROOT) ? fs.readdirSync(UPLOAD_ROOT).length : 0);

const create = (headers, fields = {}, files = []) => {
  let r = api('post', '/tickets', headers);
  const all = {
    subject: 'Printer is on fire',
    description: 'It started smoking this morning.',
    ...fields,
  };
  for (const [k, v] of Object.entries(all)) if (v !== undefined) r = r.field(k, v);
  for (const f of files) r = r.attach('files', f.buf, { filename: f.name, contentType: f.type });
  return r;
};
const file = (name, type, buf) => ({ name, type, buf });
const reply = (headers, id, body, type = 'PUBLIC') =>
  api('post', `/tickets/${id}/messages`, headers).field('body', body).field('type', type);

beforeEach(async () => {
  await resetDb();
  fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true });
  w = await makeWorld();
});
afterAll(() => prisma.$disconnect());

describe('creating tickets', () => {
  it('creates a ticket with a per-project number, first message and CREATED event', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    const res = await create(h);
    expect(res.status).toBe(201);
    expect(res.body.ticket).toMatchObject({
      number: 'A-ONE-0002',
      status: 'OPEN',
      priority: 'MEDIUM',
      subject: 'Printer is on fire',
    });
    expect(res.body.ticket.createdBy).toEqual({ id: w.bob.id, name: 'bob' }); // no email for customers
    const detail = await api('get', `/tickets/${res.body.ticket.id}`, h);
    expect(detail.body.messages).toHaveLength(1);
    expect(detail.body.messages[0]).toMatchObject({
      type: 'PUBLIC',
      body: 'It started smoking this morning.',
    });
    expect(detail.body.events.map((e) => e.type)).toEqual(['CREATED']);
  });

  it('numbers tickets independently per project', async () => {
    const a2 = await create(await authAs(app, w.alice, w.A2.id));
    expect(a2.body.ticket.number).toBe('A-TWO-0002');
    const b1 = await create(await authAs(app, w.carol, w.B1.id));
    expect(b1.body.ticket.number).toBe('B-ONE-0002');
  });

  it('never produces duplicate numbers under concurrent creation', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => create(h, { subject: `Concurrent ticket ${i}` })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.ticket.number).sort();
    expect(new Set(numbers).size).toBe(10);
    expect(numbers[0]).toBe('A-ONE-0002');
    expect(numbers[9]).toBe('A-ONE-0011'); // gap-free
    expect((await prisma.project.findUnique({ where: { id: w.A1.id } })).ticketSeq).toBe(11);
  });

  it('validates input', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    expect((await create(h, { subject: 'hi' })).status).toBe(400);
    expect((await create(h, { description: 'short' })).status).toBe(400);
    expect((await create(h, { priority: 'URGENT' })).status).toBe(400); // staff-only level
    expect((await create(h, { priority: 'HIGH' })).body.ticket.priority).toBe('HIGH');
    const otherCat = await prisma.category.create({
      data: { projectId: w.A2.id, name: 'Sibling only' },
    });
    expect((await create(h, { categoryId: otherCat.id })).status).toBe(400);
    const own = await prisma.category.create({ data: { projectId: w.A1.id, name: 'Mine' } });
    expect((await create(h, { categoryId: own.id })).body.ticket.category.name).toBe('Mine');
  });

  it('is for customers with a selected project only', async () => {
    expect((await create(await authAs(app, w.supportA, w.A1.id))).status).toBe(403);
    expect((await create(await authAs(app, w.admin, 'ALL'))).status).toBe(403);
    expect((await create(await authAs(app, w.alice))).status).toBe(409); // multi-project, none chosen
    expect((await create({})).status).toBe(401);
  });

  it('marks the originating FAQ search as having led to a ticket', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    const log = await prisma.kbSearchLog.create({
      data: { projectId: w.A1.id, userId: w.bob.id, query: 'printer fire', resultCount: 0 },
    });
    await create(h, { searchLogId: log.id });
    expect(
      (await prisma.kbSearchLog.findUnique({ where: { id: log.id } })).createdTicketAfter,
    ).toBe(true);
    // someone else's search id is ignored silently
    const other = await prisma.kbSearchLog.create({
      data: { projectId: w.A1.id, userId: w.alice.id, query: 'x', resultCount: 0 },
    });
    await create(h, { searchLogId: other.id });
    expect(
      (await prisma.kbSearchLog.findUnique({ where: { id: other.id } })).createdTicketAfter,
    ).toBe(false);
  });
});

describe('attachments', () => {
  it('accepts allowed files, stores them under random names, and serves them through the scoped endpoint', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    const res = await create(h, {}, [
      file('Invoice (final).pdf', 'application/pdf', PDF),
      file('screen.png', 'image/png', PNG),
    ]);
    expect(res.status).toBe(201);
    expect(filesOnDisk()).toBe(2);

    const detail = (await api('get', `/tickets/${res.body.ticket.id}`, h)).body;
    const atts = detail.messages[0].attachments;
    expect(atts.map((a) => a.filename).sort()).toEqual(['Invoice (final).pdf', 'screen.png']);
    const stored = await prisma.attachment.findMany({ where: { uploadedById: { not: null } } });
    expect(stored.every((a) => /^[0-9a-f-]{36}$/.test(a.storedName))).toBe(true); // never user input

    const dl = await api(
      'get',
      `/attachments/${atts.find((a) => a.mimeType === 'application/pdf').id}/download`,
      h,
    );
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['content-disposition']).toContain('Invoice');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-type']).toMatch(/application\/pdf/);
    expect(Buffer.compare(dl.body, PDF)).toBe(0);
  });

  it('rejects disallowed types, spoofed content, too many and too large files, and leaves nothing behind', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    const exe = await create(h, {}, [
      file('virus.exe', 'application/x-msdownload', Buffer.from('MZ')),
    ]);
    expect(exe.status).toBe(400);
    expect(exe.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');

    const spoof = await create(h, {}, [
      file('photo.png', 'image/png', Buffer.from('<?php system($_GET[0]); ?>')),
    ]);
    expect(spoof.status).toBe(400);
    expect(spoof.body.error.message).toMatch(/does not look like a real/);

    const wrongMime = await create(h, {}, [file('a.pdf', 'text/html', PDF)]);
    expect(wrongMime.status).toBe(400);

    const many = await create(
      h,
      {},
      Array.from({ length: 6 }, (_, i) => file(`f${i}.txt`, 'text/plain', Buffer.from('hello'))),
    );
    expect(many.status).toBe(400);

    const big = await create(h, {}, [
      file(
        'big.zip',
        'application/zip',
        Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(11 * 1024 * 1024)]),
      ),
    ]);
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('FILE_TOO_LARGE');

    // a valid file attached to an otherwise invalid request must be cleaned up
    const invalid = await create(h, { subject: 'x' }, [file('ok.pdf', 'application/pdf', PDF)]);
    expect(invalid.status).toBe(400);
    expect(filesOnDisk()).toBe(0);
    expect(
      await prisma.attachment.count({
        where: { filename: { in: ['virus.exe', 'photo.png', 'ok.pdf'] } },
      }),
    ).toBe(0);
  });

  it('keeps files from internal notes and other projects away from customers', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    const note = await reply(support, w.tA1.ticket.id, 'see attached', 'INTERNAL_NOTE').attach(
      'files',
      PDF,
      { filename: 'secret.pdf', contentType: 'application/pdf' },
    );
    expect(note.status).toBe(201);
    const attId = note.body.message.attachments[0].id;
    await fs.promises
      .writeFile(
        `${UPLOAD_ROOT}/${(await prisma.attachment.findUnique({ where: { id: attId } })).storedName}`,
        PDF,
      )
      .catch(() => {});

    expect((await api('get', `/attachments/${attId}/download`, support)).status).toBe(200);
    const bob = await authAs(app, w.bob, w.A1.id);
    expect((await api('get', `/attachments/${attId}/download`, bob)).status).toBe(404);
    expect((await api('get', `/attachments/${attId}`, bob)).status).toBe(404);
    const detail = (await api('get', `/tickets/${w.tA1.ticket.id}`, bob)).body;
    expect(JSON.stringify(detail)).not.toContain('secret.pdf');

    const other = await authAs(app, w.carol, w.B1.id);
    expect((await api('get', `/attachments/${attId}/download`, other)).status).toBe(404);
  });

  it('404s when the file vanished from disk instead of leaking paths', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    expect((await api('get', `/attachments/${w.tA1.pubAttachment.id}/download`, h)).status).toBe(
      404,
    );
  });
});

describe('listing and searching', () => {
  const mk = async (project, creator, over = {}) => {
    const { ticketSeq } = await prisma.project.update({
      where: { id: project.id },
      data: { ticketSeq: { increment: 1 } },
    });
    return prisma.ticket.create({
      data: {
        projectId: project.id,
        createdById: creator.id,
        subject: 'Subject',
        description: 'Description text',
        sequence: ticketSeq,
        number: `${project.key}-${String(ticketSeq).padStart(4, '0')}`,
        ...over,
      },
    });
  };

  it('scopes lists by role: customer = active project, support = assigned, admin = all', async () => {
    const bob = await api('get', '/tickets', await authAs(app, w.bob, w.A1.id));
    expect(bob.body.items.map((t) => t.number)).toEqual(['A-ONE-0001']);
    expect(
      await api('get', '/tickets', await authAs(app, w.carol, w.B1.id)).then((r) => r.body.total),
    ).toBe(1);
    expect((await api('get', '/tickets', await authAs(app, w.supportA, w.A1.id))).body.total).toBe(
      1,
    );
    expect((await api('get', '/tickets', await authAs(app, w.supportBoth, 'ALL'))).body.total).toBe(
      2,
    );
    expect((await api('get', '/tickets', await authAs(app, w.admin, 'ALL'))).body.total).toBe(3);
    // asking for another project's tickets through a filter returns nothing, not an error leak
    const sneaky = await api(
      'get',
      `/tickets?projectId=${w.B1.id}`,
      await authAs(app, w.bob, w.A1.id),
    );
    expect(sneaky.body.total).toBe(0);
  });

  it('filters by status list, priority, assignee, mine, category and text', async () => {
    const cat = await prisma.category.create({ data: { name: 'Billing' } });
    await mk(w.A1, w.bob, {
      subject: 'Invoice is wrong',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assigneeId: w.supportA.id,
      categoryId: cat.id,
    });
    await mk(w.A1, w.alice, {
      subject: 'Cannot log in',
      status: 'RESOLVED',
      priority: 'URGENT',
      assigneeId: w.supportBoth.id,
    });
    await mk(w.A1, w.alice, {
      subject: 'Feature idea',
      status: 'WAITING_ON_CUSTOMER',
      priority: 'LOW',
    });

    const sup = await authAs(app, w.supportA, w.A1.id);
    const q = async (qs) => (await api('get', `/tickets${qs}`, sup)).body;
    expect((await q('?status=IN_PROGRESS,RESOLVED')).total).toBe(2);
    expect((await q('?priority=URGENT')).items[0].subject).toBe('Cannot log in');
    expect((await q('?assigneeId=me')).items.map((t) => t.subject)).toEqual(['Invoice is wrong']);
    expect((await q('?assigneeId=unassigned')).total).toBe(2); // seed ticket + Feature idea
    expect((await q(`?assigneeId=${w.supportBoth.id}`)).total).toBe(1);
    expect((await q(`?categoryId=${cat.id}`)).total).toBe(1);
    expect((await q('?q=INVOICE')).total).toBe(1);
    expect((await q('?q=a-one-0003')).items[0].number).toBe('A-ONE-0003'); // by ticket number
    expect((await q('?status=NOPE')).total).toBeUndefined();

    const bob = await authAs(app, w.bob, w.A1.id);
    expect((await api('get', '/tickets?mine=true', bob)).body.total).toBe(2);
    expect((await api('get', '/tickets', bob)).body.total).toBe(4);
  });

  it('sorts (priority puts urgent first) and paginates; rejects bad parameters', async () => {
    await mk(w.A1, w.bob, { subject: 'low one', priority: 'LOW' });
    await mk(w.A1, w.bob, { subject: 'urgent one', priority: 'URGENT' });
    const h = await authAs(app, w.supportA, w.A1.id);
    const sorted = await api('get', '/tickets?sort=priority&dir=desc', h);
    expect(sorted.body.items[0].subject).toBe('urgent one');
    const p = await api('get', '/tickets?limit=2&page=2&sort=number&dir=asc', h);
    expect(p.body).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(p.body.items).toHaveLength(1);
    expect((await api('get', '/tickets?sort=description', h)).status).toBe(400);
    expect((await api('get', '/tickets?status=NOPE', h)).status).toBe(400);
    expect((await api('get', '/tickets?limit=500', h)).status).toBe(400);
  });
});

describe('ticket detail', () => {
  it('shows history without internal housekeeping to customers; staff see everything and customer details', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    await api('post', `/tickets/${w.tA1.ticket.id}/assign`, support).send({
      assigneeId: w.supportA.id,
    });
    await api('patch', `/tickets/${w.tA1.ticket.id}`, support).send({ priority: 'HIGH' });
    await api('post', `/tickets/${w.tA1.ticket.id}/status`, support).send({
      status: 'IN_PROGRESS',
    });

    const bob = (await api('get', `/tickets/${w.tA1.ticket.id}`, await authAs(app, w.bob, w.A1.id)))
      .body;
    expect(bob.events.map((e) => e.type)).toEqual(['STATUS_CHANGED']);
    expect(bob.ticket.createdBy.email).toBeUndefined();
    expect(bob.messages.map((m) => m.type)).toEqual(['PUBLIC', 'SYSTEM']);

    const staff = (await api('get', `/tickets/${w.tA1.ticket.id}`, support)).body;
    expect(staff.events.map((e) => e.type)).toEqual([
      'ASSIGNED',
      'PRIORITY_CHANGED',
      'STATUS_CHANGED',
    ]);
    expect(staff.ticket.createdBy).toMatchObject({
      email: 'bob@test.dev',
      organization: { name: 'Org A' },
    });
    expect(staff.messages.map((m) => m.type)).toEqual(['PUBLIC', 'INTERNAL_NOTE', 'SYSTEM']);
  });

  it('tells each role what it may do', async () => {
    const bob = (await api('get', `/tickets/${w.tA1.ticket.id}`, await authAs(app, w.bob, w.A1.id)))
      .body.ticket;
    expect(bob).toMatchObject({ canReply: true, canAddNote: false, allowedStatuses: ['CLOSED'] });
    const alice = (
      await api('get', `/tickets/${w.tA1.ticket.id}`, await authAs(app, w.alice, w.A1.id))
    ).body.ticket;
    expect(alice.allowedStatuses).toEqual([]); // not her ticket
    const staff = (
      await api('get', `/tickets/${w.tA1.ticket.id}`, await authAs(app, w.supportA, w.A1.id))
    ).body.ticket;
    expect(staff).toMatchObject({ canAddNote: true });
    expect(staff.allowedStatuses).toEqual(['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED']);
  });
});

describe('conversation', () => {
  it('customers reply publicly but cannot write internal notes', async () => {
    const bob = await authAs(app, w.bob, w.A1.id);
    const ok = await reply(bob, w.tA1.ticket.id, 'Any update?');
    expect(ok.status).toBe(201);
    expect(ok.body.message).toMatchObject({ type: 'PUBLIC', author: { name: 'bob' } });
    expect((await reply(bob, w.tA1.ticket.id, 'sneaky', 'INTERNAL_NOTE')).status).toBe(403);
    expect((await reply(bob, w.tA1.ticket.id, '   ')).status).toBe(400);
  });

  it("a customer can reply on another member's ticket in the same project; not on other projects", async () => {
    const alice = await authAs(app, w.alice, w.A1.id);
    expect((await reply(alice, w.tA1.ticket.id, 'Same problem here')).status).toBe(201);
    expect((await reply(alice, w.tA2.ticket.id, 'wrong project')).status).toBe(404);
    expect((await reply(alice, w.tB1.ticket.id, 'other org')).status).toBe(404);
  });

  it('internal notes are invisible to customers and trigger no status/first-response change', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    const res = await reply(support, w.tA1.ticket.id, 'private thoughts', 'INTERNAL_NOTE');
    expect(res.status).toBe(201);
    const t = await prisma.ticket.findUnique({ where: { id: w.tA1.ticket.id } });
    expect(t.status).toBe('OPEN');
    expect(t.firstResponseAt).toBeNull();
    const bob = (await api('get', `/tickets/${w.tA1.ticket.id}`, await authAs(app, w.bob, w.A1.id)))
      .body;
    expect(JSON.stringify(bob)).not.toContain('private thoughts');
  });

  it('first public staff reply sets firstResponseAt and moves OPEN to IN_PROGRESS with a system message', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    await reply(support, w.tA1.ticket.id, 'We are on it');
    const t = await prisma.ticket.findUnique({ where: { id: w.tA1.ticket.id } });
    expect(t.status).toBe('IN_PROGRESS');
    expect(t.firstResponseAt).toBeInstanceOf(Date);
    const detail = (await api('get', `/tickets/${w.tA1.ticket.id}`, support)).body;
    expect(detail.messages.at(-1)).toMatchObject({
      type: 'SYSTEM',
      body: 'Status changed from Open to In progress',
    });
    expect(detail.events.at(-1)).toMatchObject({
      type: 'STATUS_CHANGED',
      fromValue: 'OPEN',
      toValue: 'IN_PROGRESS',
    });

    const first = t.firstResponseAt;
    await reply(support, w.tA1.ticket.id, 'Second reply');
    expect(
      (await prisma.ticket.findUnique({ where: { id: w.tA1.ticket.id } })).firstResponseAt,
    ).toEqual(first);
  });

  it('a customer reply on WAITING_ON_CUSTOMER resumes the ticket', async () => {
    await prisma.ticket.update({
      where: { id: w.tA1.ticket.id },
      data: { status: 'WAITING_ON_CUSTOMER' },
    });
    await reply(await authAs(app, w.bob, w.A1.id), w.tA1.ticket.id, 'Here is the info');
    expect((await prisma.ticket.findUnique({ where: { id: w.tA1.ticket.id } })).status).toBe(
      'IN_PROGRESS',
    );
  });

  it('blocks replies on closed tickets, and customer replies on resolved ones', async () => {
    const bob = await authAs(app, w.bob, w.A1.id);
    const support = await authAs(app, w.supportA, w.A1.id);
    await prisma.ticket.update({
      where: { id: w.tA1.ticket.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    const r = await reply(bob, w.tA1.ticket.id, 'one more thing');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('TICKET_RESOLVED');
    expect((await reply(support, w.tA1.ticket.id, 'staff may still answer')).status).toBe(201);

    await prisma.ticket.update({ where: { id: w.tA1.ticket.id }, data: { status: 'CLOSED' } });
    expect((await reply(bob, w.tA1.ticket.id, 'hello?')).body.error.code).toBe('TICKET_CLOSED');
    expect((await reply(support, w.tA1.ticket.id, 'hello?')).body.error.code).toBe('TICKET_CLOSED');
    expect((await reply(support, w.tA1.ticket.id, 'closing note', 'INTERNAL_NOTE')).status).toBe(
      201,
    );
  });
});

describe('status changes', () => {
  const status = (headers, id, s) =>
    api('post', `/tickets/${id}/status`, headers).send({ status: s });
  const id = () => w.tA1.ticket.id;

  it('staff move tickets along the allowed path, stamping timestamps, events and system messages', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    expect((await status(support, id(), 'RESOLVED')).body.ticket).toMatchObject({
      status: 'RESOLVED',
    });
    let t = await prisma.ticket.findUnique({ where: { id: id() } });
    expect(t.resolvedAt).toBeInstanceOf(Date);
    expect((await status(support, id(), 'CLOSED')).body.ticket.status).toBe('CLOSED');
    t = await prisma.ticket.findUnique({ where: { id: id() } });
    expect(t.closedAt).toBeInstanceOf(Date);
    const events = await prisma.ticketEvent.findMany({
      where: { ticketId: id() },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => [e.type, e.fromValue, e.toValue])).toEqual([
      ['STATUS_CHANGED', 'OPEN', 'RESOLVED'],
      ['STATUS_CHANGED', 'RESOLVED', 'CLOSED'],
    ]);
  });

  it('rejects illegal moves with 409 INVALID_TRANSITION', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    const bad = await status(support, id(), 'CLOSED'); // must resolve first
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('INVALID_TRANSITION');
    expect((await status(support, id(), 'OPEN')).status).toBe(409);
    await prisma.ticket.update({ where: { id: id() }, data: { status: 'CLOSED' } });
    expect((await status(support, id(), 'REOPENED')).status).toBe(409); // CLOSED is terminal
    expect((await status(support, id(), 'NOPE')).status).toBe(400);
  });

  it("customers can close their own ticket, but nobody else's, and cannot set staff statuses", async () => {
    const bob = await authAs(app, w.bob, w.A1.id);
    const alice = await authAs(app, w.alice, w.A1.id);
    expect((await status(bob, id(), 'RESOLVED')).status).toBe(409);
    expect((await status(bob, id(), 'IN_PROGRESS')).status).toBe(409);
    expect((await status(alice, id(), 'CLOSED')).status).toBe(403);
    expect((await status(bob, id(), 'CLOSED')).body.ticket.status).toBe('CLOSED');
  });

  it('customers can reopen a resolved ticket inside the window, recorded as REOPENED', async () => {
    const bob = await authAs(app, w.bob, w.A1.id);
    await prisma.ticket.update({
      where: { id: id() },
      data: { status: 'RESOLVED', resolvedAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    const detail = (await api('get', `/tickets/${id()}`, bob)).body.ticket;
    expect(detail.allowedStatuses.sort()).toEqual(['CLOSED', 'REOPENED']);
    expect(new Date(detail.reopenUntil).getTime()).toBeGreaterThan(Date.now());

    const res = await status(bob, id(), 'REOPENED');
    expect(res.body.ticket).toMatchObject({ status: 'REOPENED', resolvedAt: null });
    const ev = await prisma.ticketEvent.findFirst({ where: { ticketId: id(), type: 'REOPENED' } });
    expect(ev).toMatchObject({ fromValue: 'RESOLVED', toValue: 'REOPENED', actorId: w.bob.id });
    const msg = await prisma.ticketMessage.findFirst({ where: { ticketId: id(), type: 'SYSTEM' } });
    expect(msg.body).toBe('Ticket reopened by the customer');
  });

  it('refuses reopening after the window; staff can still reopen; the window is configurable', async () => {
    const bob = await authAs(app, w.bob, w.A1.id);
    const support = await authAs(app, w.supportA, w.A1.id);
    await prisma.ticket.update({
      where: { id: id() },
      data: { status: 'RESOLVED', resolvedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    const late = await status(bob, id(), 'REOPENED');
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('REOPEN_WINDOW_EXPIRED');
    expect((await api('get', `/tickets/${id()}`, bob)).body.ticket.allowedStatuses).toEqual([
      'CLOSED',
    ]);

    await prisma.setting.create({ data: { key: 'reopenWindowDays', value: 14 } });
    expect((await status(bob, id(), 'REOPENED')).status).toBe(200);

    await prisma.ticket.update({
      where: { id: id() },
      data: { status: 'RESOLVED', resolvedAt: new Date(Date.now() - 100 * 86_400_000) },
    });
    expect((await status(support, id(), 'REOPENED')).status).toBe(200);
  });
});

describe('details, assignment and bulk assignment', () => {
  const id = () => w.tA1.ticket.id;

  it('staff change priority and category, with events; customers cannot', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    const cat = await prisma.category.create({ data: { name: 'Bug' } });
    const res = await api('patch', `/tickets/${id()}`, support).send({
      priority: 'URGENT',
      categoryId: cat.id,
    });
    expect(res.body.ticket).toMatchObject({ priority: 'URGENT', category: { name: 'Bug' } });
    const events = await prisma.ticketEvent.findMany({
      where: { ticketId: id(), type: { in: ['PRIORITY_CHANGED', 'CATEGORY_CHANGED'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => [e.type, e.fromValue, e.toValue])).toEqual([
      ['PRIORITY_CHANGED', 'MEDIUM', 'URGENT'],
      ['CATEGORY_CHANGED', null, 'Bug'],
    ]);
    expect(
      (
        await api('patch', `/tickets/${id()}`, await authAs(app, w.bob, w.A1.id)).send({
          priority: 'LOW',
        })
      ).status,
    ).toBe(403);
    expect(
      (await api('patch', `/tickets/${id()}`, support).send({ status: 'CLOSED' })).status,
    ).toBe(400); // not editable here
    const foreignCat = await prisma.category.create({
      data: { projectId: w.A2.id, name: 'Sibling' },
    });
    expect(
      (await api('patch', `/tickets/${id()}`, support).send({ categoryId: foreignCat.id })).status,
    ).toBe(400);
  });

  it('assigns, reassigns and unassigns with named events', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    const assign = (assigneeId) =>
      api('post', `/tickets/${id()}/assign`, support).send({ assigneeId });
    expect((await assign(w.supportA.id)).body.ticket.assignee).toEqual({
      id: w.supportA.id,
      name: 'supportA',
    });
    expect((await assign(w.supportBoth.id)).status).toBe(200); // staff of the same project
    expect((await assign(w.admin.id)).status).toBe(200); // admins are assignable
    expect((await assign(null)).body.ticket.assignee).toBeNull();
    const ev = await prisma.ticketEvent.findMany({
      where: { ticketId: id(), type: 'ASSIGNED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(ev.map((e) => [e.fromValue, e.toValue])).toEqual([
      [null, 'supportA'],
      ['supportA', 'supportBoth'],
      ['supportBoth', 'admin'],
      ['admin', null],
    ]);
    await assign(null); // no-op, no extra event
    expect(await prisma.ticketEvent.count({ where: { ticketId: id(), type: 'ASSIGNED' } })).toBe(4);
  });

  it("refuses assignees who are not staff of the ticket's project, customers, and closed tickets", async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    const assign = (assigneeId) =>
      api('post', `/tickets/${id()}/assign`, support).send({ assigneeId });
    expect((await assign(w.supportB.id)).status).toBe(400); // staff of another project
    expect((await assign(w.bob.id)).status).toBe(400); // a customer
    expect((await assign('ghost')).status).toBe(400);
    await prisma.user.update({ where: { id: w.supportBoth.id }, data: { status: 'DEACTIVATED' } });
    expect((await assign(w.supportBoth.id)).status).toBe(400);
    await prisma.ticket.update({ where: { id: id() }, data: { status: 'CLOSED' } });
    expect((await assign(w.supportA.id)).status).toBe(409);
    expect(
      (
        await api('post', `/tickets/${id()}/assign`, await authAs(app, w.bob, w.A1.id)).send({
          assigneeId: null,
        })
      ).status,
    ).toBe(403);
  });

  it('support cannot touch tickets outside their projects', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    expect(
      (await api('post', `/tickets/${w.tA2.ticket.id}/assign`, support).send({ assigneeId: null }))
        .status,
    ).toBe(404);
    expect(
      (await api('patch', `/tickets/${w.tB1.ticket.id}`, support).send({ priority: 'LOW' })).status,
    ).toBe(404);
    expect(
      (
        await api('post', `/tickets/${w.tB1.ticket.id}/status`, support).send({
          status: 'RESOLVED',
        })
      ).status,
    ).toBe(404);
  });

  it('bulk assignment is all-or-nothing', async () => {
    const both = await authAs(app, w.supportBoth, 'ALL');
    const ids = [w.tA1.ticket.id, w.tA2.ticket.id];
    const ok = await api('post', '/tickets/bulk-assign', both).send({
      ticketIds: ids,
      assigneeId: w.supportBoth.id,
    });
    expect(ok.body).toEqual({ updated: 2 });
    expect(
      (await prisma.ticket.findMany({ where: { id: { in: ids } } })).every(
        (t) => t.assigneeId === w.supportBoth.id,
      ),
    ).toBe(true);

    // out-of-scope ticket in the list -> nothing changes
    const bad = await api('post', '/tickets/bulk-assign', both).send({
      ticketIds: [...ids, w.tB1.ticket.id],
      assigneeId: null,
    });
    expect(bad.status).toBe(404);
    expect(
      (await prisma.ticket.findMany({ where: { id: { in: ids } } })).every(
        (t) => t.assigneeId === w.supportBoth.id,
      ),
    ).toBe(true);

    // assignee who does not fit one of the projects -> nothing changes
    const misfit = await api('post', '/tickets/bulk-assign', both).send({
      ticketIds: ids,
      assigneeId: w.supportA.id,
    });
    expect(misfit.status).toBe(400);
    expect((await prisma.ticket.findUnique({ where: { id: ids[0] } })).assigneeId).toBe(
      w.supportBoth.id,
    );

    expect(
      (await api('post', '/tickets/bulk-assign', both).send({ ticketIds: [], assigneeId: null }))
        .status,
    ).toBe(400);
    expect(
      (
        await api('post', '/tickets/bulk-assign', await authAs(app, w.bob, w.A1.id)).send({
          ticketIds: ids,
          assigneeId: null,
        })
      ).status,
    ).toBe(403);
  });

  it('lists assignable staff for a project, only within scope', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    const res = await api('get', '/tickets/assignees', support);
    expect(res.body.assignees.map((a) => a.name)).toEqual(['admin', 'supportA', 'supportBoth']);
    expect((await api('get', `/tickets/assignees?projectId=${w.B1.id}`, support)).status).toBe(404);
    expect((await api('get', '/tickets/assignees', await authAs(app, w.bob, w.A1.id))).status).toBe(
      403,
    );
    const all = await authAs(app, w.supportBoth, 'ALL');
    expect((await api('get', '/tickets/assignees', all)).status).toBe(400); // must say which project
    expect(
      (await api('get', `/tickets/assignees?projectId=${w.A2.id}`, all)).body.assignees.map(
        (a) => a.name,
      ),
    ).toEqual(['admin', 'supportBoth']);
  });
});

describe('merging duplicates', () => {
  const merge = (headers, from, into) =>
    api('post', `/tickets/${from}/merge`, headers).send({ targetTicketId: into });
  let dup;
  beforeEach(async () => {
    const { ticketSeq } = await prisma.project.update({
      where: { id: w.A1.id },
      data: { ticketSeq: { increment: 1 } },
    });
    dup = await prisma.ticket.create({
      data: {
        projectId: w.A1.id,
        createdById: w.bob.id,
        subject: 'Duplicate',
        description: 'dup dup dup dup',
        sequence: ticketSeq,
        number: `A-ONE-000${ticketSeq}`,
      },
    });
  });

  it('closes the duplicate into the target with events and system messages on both', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    const res = await merge(support, dup.id, w.tA1.ticket.id);
    expect(res.status).toBe(200);
    expect(res.body.ticket).toMatchObject({
      status: 'CLOSED',
      mergedInto: { id: w.tA1.ticket.id, number: 'A-ONE-0001' },
    });
    const srcMsg = await prisma.ticketMessage.findFirst({
      where: { ticketId: dup.id, type: 'SYSTEM' },
    });
    expect(srcMsg.body).toContain('merged into A-ONE-0001');
    const tgtMsg = await prisma.ticketMessage.findFirst({
      where: { ticketId: w.tA1.ticket.id, type: 'SYSTEM' },
    });
    expect(tgtMsg.body).toContain(`${dup.number} was merged into this ticket`);
    expect(await prisma.ticketEvent.count({ where: { type: 'MERGED' } })).toBe(2);
    // the target stays live and the closed duplicate rejects replies
    expect((await prisma.ticket.findUnique({ where: { id: w.tA1.ticket.id } })).status).toBe(
      'OPEN',
    );
    expect((await reply(support, dup.id, 'x')).body.error.code).toBe('TICKET_CLOSED');
  });

  it('refuses self-merge, cross-project, already-merged, closed and out-of-scope targets, and customers', async () => {
    const both = await authAs(app, w.supportBoth, 'ALL');
    expect((await merge(both, dup.id, dup.id)).status).toBe(400);
    expect((await merge(both, dup.id, w.tA2.ticket.id)).status).toBe(400); // other project
    expect(
      (await merge(await authAs(app, w.supportA, w.A1.id), dup.id, w.tB1.ticket.id)).status,
    ).toBe(404);
    expect((await merge(await authAs(app, w.bob, w.A1.id), dup.id, w.tA1.ticket.id)).status).toBe(
      403,
    );

    await merge(both, dup.id, w.tA1.ticket.id);
    expect((await merge(both, dup.id, w.tA1.ticket.id)).status).toBe(409); // already merged
    const another = await prisma.ticket.create({
      data: {
        projectId: w.A1.id,
        createdById: w.bob.id,
        subject: 'Another',
        description: 'another one',
        sequence: 99,
        number: 'A-ONE-0099',
      },
    });
    expect((await merge(both, w.tA1.ticket.id, dup.id)).status).toBe(409); // target is closed/merged
    expect((await merge(both, another.id, dup.id)).status).toBe(409);
  });
});

describe('canned replies', () => {
  const body = (over) => ({
    title: 'Thanks',
    body: 'Thanks for contacting us.',
    scope: 'PERSONAL',
    ...over,
  });

  it('is invisible to customers', async () => {
    const bob = await authAs(app, w.bob, w.A1.id);
    expect((await api('get', '/canned-replies', bob)).status).toBe(403);
    expect((await api('post', '/canned-replies', bob).send(body())).status).toBe(403);
  });

  it('shows global replies to all staff, project replies within scope, personal replies to their owner', async () => {
    const admin = await authAs(app, w.admin, 'ALL');
    await api('post', '/canned-replies', admin).send(body({ title: 'G', scope: 'GLOBAL' }));
    const a = await authAs(app, w.supportA, w.A1.id);
    await api('post', '/canned-replies', a).send(
      body({ title: 'P-A1', scope: 'PROJECT', projectId: w.A1.id }),
    );
    await api('post', '/canned-replies', a).send(body({ title: 'Mine' }));
    const b = await authAs(app, w.supportB, w.B1.id);
    await api('post', '/canned-replies', b).send(
      body({ title: 'P-B1', scope: 'PROJECT', projectId: w.B1.id }),
    );

    const titles = async (h) =>
      (await api('get', '/canned-replies', h)).body.replies.map((r) => r.title).sort();
    expect(await titles(a)).toEqual(['G', 'Mine', 'P-A1']);
    expect(await titles(b)).toEqual(['G', 'P-B1']);
    expect(await titles(await authAs(app, w.supportBoth, 'ALL'))).toEqual(['G', 'P-A1']); // not A's personal one
    expect(await titles(admin)).toEqual(['G', 'P-A1', 'P-B1']); // not anyone's personal reply
  });

  it('enforces who may create which kind', async () => {
    const a = await authAs(app, w.supportA, w.A1.id);
    expect((await api('post', '/canned-replies', a).send(body({ scope: 'GLOBAL' }))).status).toBe(
      403,
    );
    expect(
      (await api('post', '/canned-replies', a).send(body({ scope: 'PROJECT', projectId: w.B1.id })))
        .status,
    ).toBe(404);
    expect((await api('post', '/canned-replies', a).send(body({ scope: 'PROJECT' }))).status).toBe(
      400,
    );
    expect((await api('post', '/canned-replies', a).send(body({ title: '' }))).status).toBe(400);
    expect(
      (
        await api('post', '/canned-replies', a).send(
          body({ scope: 'PERSONAL', projectId: w.B1.id }),
        )
      ).body.reply,
    ).toMatchObject({ projectId: null, ownerId: w.supportA.id });
  });

  it('lets only owners edit personal replies and only admins edit global ones', async () => {
    const admin = await authAs(app, w.admin, 'ALL');
    const a = await authAs(app, w.supportA, w.A1.id);
    const both = await authAs(app, w.supportBoth, w.A1.id);
    const global = (await api('post', '/canned-replies', admin).send(body({ scope: 'GLOBAL' })))
      .body.reply;
    const mine = (await api('post', '/canned-replies', a).send(body())).body.reply;
    const proj = (
      await api('post', '/canned-replies', a).send(body({ scope: 'PROJECT', projectId: w.A1.id }))
    ).body.reply;

    expect(
      (await api('patch', `/canned-replies/${global.id}`, a).send({ title: 'hack' })).status,
    ).toBe(403);
    expect(
      (await api('patch', `/canned-replies/${global.id}`, admin).send({ title: 'Updated' })).body
        .reply.title,
    ).toBe('Updated');
    expect(
      (await api('patch', `/canned-replies/${mine.id}`, both).send({ title: 'x' })).status,
    ).toBe(404); // invisible to others
    expect(
      (await api('patch', `/canned-replies/${proj.id}`, both).send({ body: 'edited by colleague' }))
        .status,
    ).toBe(200);
    expect((await api('delete', `/canned-replies/${mine.id}`, a)).status).toBe(204);
    expect((await api('delete', `/canned-replies/${global.id}`, a)).status).toBe(403);
  });
});

describe('categories', () => {
  it('customers see global and own-project active categories only', async () => {
    await prisma.category.createMany({
      data: [
        { name: 'Global' },
        { projectId: w.A1.id, name: 'A1 cat' },
        { projectId: w.A2.id, name: 'A2 cat' },
        { projectId: w.B1.id, name: 'B1 cat' },
        { projectId: w.A1.id, name: 'A1 retired', isActive: false },
      ],
    });
    const names = async (h) =>
      (await api('get', '/categories', h)).body.categories.map((c) => c.name).sort();
    expect(await names(await authAs(app, w.bob, w.A1.id))).toEqual(['A1 cat', 'Global']);
    expect(await names(await authAs(app, w.supportA, w.A1.id))).toEqual([
      'A1 cat',
      'A1 retired',
      'Global',
    ]);
  });
});

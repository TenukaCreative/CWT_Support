import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, resetDb, makeWorld, authAs } from './helpers.js';

const app = createApp();
let w;
const api = (m, p, h) => request(app)[m](`/api/v1${p}`).set(h);
const rate = (h, id, body) => api('post', `/tickets/${id}/feedback`, h).send(body);
const resolve = (id, over = {}) =>
  prisma.ticket.update({
    where: { id },
    data: { status: 'RESOLVED', resolvedAt: new Date(), ...over },
  });
const id = () => w.tA1.ticket.id;

beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});
afterAll(() => prisma.$disconnect());

describe('rating a ticket', () => {
  it('the customer who raised a resolved ticket can rate it once; staff and the creator then see it', async () => {
    await resolve(id());
    const bob = await authAs(app, w.bob, w.A1.id);
    const res = await rate(bob, id(), { rating: 4, comment: '  Fast and friendly  ' });
    expect(res.status).toBe(201);
    expect(res.body.feedback).toMatchObject({ rating: 4, comment: 'Fast and friendly' });

    const mine = (await api('get', `/tickets/${id()}`, bob)).body.ticket;
    expect(mine.feedback).toMatchObject({ rating: 4 });
    expect(mine.canRate).toBe(true); // may still edit inside the window
    const staff = (await api('get', `/tickets/${id()}`, await authAs(app, w.supportA, w.A1.id)))
      .body.ticket;
    expect(staff.feedback).toMatchObject({ rating: 4, comment: 'Fast and friendly' });
    expect(staff.canRate).toBe(false);
    expect(await prisma.feedback.count({ where: { ticketId: id() } })).toBe(1);
  });

  it('other customers of the project cannot see or give feedback on it', async () => {
    await resolve(id());
    await rate(await authAs(app, w.bob, w.A1.id), id(), { rating: 2, comment: 'meh' });
    const alice = await authAs(app, w.alice, w.A1.id);
    const view = (await api('get', `/tickets/${id()}`, alice)).body.ticket;
    expect(view.feedback).toBeNull();
    expect(view.canRate).toBe(false);
    expect((await rate(alice, id(), { rating: 5 })).status).toBe(403);
  });

  it('is only possible once the ticket has been resolved', async () => {
    const bob = await authAs(app, w.bob, w.A1.id);
    const early = await rate(bob, id(), { rating: 5 });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('FEEDBACK_NOT_AVAILABLE');
    await prisma.ticket.update({ where: { id: id() }, data: { status: 'CLOSED' } }); // closed without ever being resolved
    expect((await rate(bob, id(), { rating: 5 })).status).toBe(409);
    await prisma.ticket.update({
      where: { id: id() },
      data: { status: 'CLOSED', resolvedAt: new Date() },
    }); // auto-closed after resolve
    expect((await rate(bob, id(), { rating: 5 })).status).toBe(201);
  });

  it('merged duplicates cannot be rated; staff cannot rate', async () => {
    await resolve(id());
    expect((await rate(await authAs(app, w.supportA, w.A1.id), id(), { rating: 5 })).status).toBe(
      403,
    );
    await prisma.ticket.update({
      where: { id: id() },
      data: { mergedIntoId: w.tA2.ticket.id, status: 'CLOSED' },
    });
    expect((await rate(await authAs(app, w.bob, w.A1.id), id(), { rating: 5 })).status).toBe(409);
  });

  it('validates the rating and comment', async () => {
    await resolve(id());
    const bob = await authAs(app, w.bob, w.A1.id);
    for (const rating of [0, 6, 3.5, '5', null, undefined, -1])
      expect((await rate(bob, id(), { rating })).status).toBe(400);
    expect((await rate(bob, id(), { rating: 5, comment: 'x'.repeat(2001) })).status).toBe(400);
    expect((await rate(bob, id(), { rating: 5, extra: 1 })).status).toBe(400);
    expect((await rate(bob, id(), { rating: 5, comment: '   ' })).body.feedback.comment).toBeNull();
  });

  it('the database itself refuses out-of-range ratings', async () => {
    await expect(
      prisma.feedback.create({ data: { ticketId: id(), rating: 6, createdById: w.bob.id } }),
    ).rejects.toThrow(/Feedback_rating_range|check constraint/i);
    await expect(
      prisma.feedback.create({ data: { ticketId: id(), rating: 0, createdById: w.bob.id } }),
    ).rejects.toThrow();
  });
});

describe('editing a rating', () => {
  it('can be changed inside the window (still one row), then locks', async () => {
    await resolve(id());
    const bob = await authAs(app, w.bob, w.A1.id);
    await rate(bob, id(), { rating: 2, comment: 'slow' });
    expect(
      (await rate(bob, id(), { rating: 5, comment: 'ok after all' })).body.feedback,
    ).toMatchObject({ rating: 5, comment: 'ok after all' });
    expect(await prisma.feedback.count()).toBe(1);

    await prisma.feedback.update({
      where: { ticketId: id() },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    const late = await rate(bob, id(), { rating: 1 });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('FEEDBACK_LOCKED');
    expect((await api('get', `/tickets/${id()}`, bob)).body.ticket.canRate).toBe(false);
    expect((await prisma.feedback.findUnique({ where: { ticketId: id() } })).rating).toBe(5);
  });

  it('the edit window is configurable', async () => {
    await resolve(id());
    const bob = await authAs(app, w.bob, w.A1.id);
    await rate(bob, id(), { rating: 3 });
    await prisma.feedback.update({
      where: { ticketId: id() },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    await prisma.setting.create({ data: { key: 'feedbackEditWindowHours', value: 48 } });
    expect((await rate(bob, id(), { rating: 4 })).status).toBe(201);
  });
});

describe('reopening instead of rating', () => {
  it('is recorded as a REOPENED event, and an existing rating survives a reopen', async () => {
    await resolve(id());
    const bob = await authAs(app, w.bob, w.A1.id);
    await rate(bob, id(), { rating: 3 });
    await api('post', `/tickets/${id()}/status`, bob).send({ status: 'REOPENED' });
    expect(await prisma.ticketEvent.count({ where: { ticketId: id(), type: 'REOPENED' } })).toBe(1);
    expect(await prisma.feedback.count({ where: { ticketId: id() } })).toBe(1);
    // while reopened there is nothing to rate
    expect((await api('get', `/tickets/${id()}`, bob)).body.ticket.canRate).toBe(false);
  });
});

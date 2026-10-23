import request from 'supertest';
import { createApp } from '../src/app.js';
import { HOUR } from '../src/lib/sla.js';
import { prisma, resetDb, makeWorld, authAs } from './helpers.js';

const app = createApp();
let w;
let admin;
const api = (m, p, h = admin) => request(app)[m](`/api/v1/admin${p}`).set(h);

beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  admin = await authAs(app, w.admin, 'ALL');
});
afterAll(() => prisma.$disconnect());

describe('authorization', () => {
  it.each([
    ['get', '/categories'],
    ['post', '/categories'],
    ['get', '/sla-policies'],
    ['put', '/sla-policies'],
    ['patch', '/settings'],
  ])('%s %s is admin only', async (m, p) => {
    expect((await request(app)[m](`/api/v1/admin${p}`).send({})).status).toBe(401);
    for (const u of [w.supportA, w.bob])
      expect(
        (
          await api(m, p, await authAs(app, u, u.role === 'CUSTOMER' ? w.A1.id : undefined)).send(
            {},
          )
        ).status,
      ).toBe(403);
  });
});

describe('categories', () => {
  it('creates global and project categories, rejects case-insensitive duplicates within a scope', async () => {
    expect((await api('post', '/categories').send({ name: 'Billing' })).status).toBe(201);
    expect((await api('post', '/categories').send({ name: 'billing' })).status).toBe(409);
    expect(
      (await api('post', '/categories').send({ projectId: w.A1.id, name: 'Billing' })).status,
    ).toBe(201); // same name, other scope
    expect((await api('post', '/categories').send({ projectId: 'ghost', name: 'X' })).status).toBe(
      400,
    );
    expect((await api('post', '/categories').send({ name: '' })).status).toBe(400);
    const list = await api('get', '/categories');
    expect(list.body.categories).toHaveLength(2);
    expect(await prisma.auditLog.count({ where: { action: 'category.create' } })).toBe(2);
  });

  it('renames and deactivates; deactivated categories vanish for customers but keep labelling old tickets', async () => {
    const cat = (await api('post', '/categories').send({ name: 'Old name' })).body.category;
    await prisma.ticket.update({ where: { id: w.tA1.ticket.id }, data: { categoryId: cat.id } });
    expect(
      (await api('patch', `/categories/${cat.id}`).send({ name: 'Payments' })).body.category.name,
    ).toBe('Payments');
    const names = async () =>
      (
        await request(app)
          .get('/api/v1/categories')
          .set(await authAs(app, w.bob, w.A1.id))
      ).body.categories.map((c) => c.name);
    expect(await names()).toEqual(['Payments']);

    await api('patch', `/categories/${cat.id}`).send({ isActive: false });
    expect(await names()).toEqual([]);
    const detail = (
      await request(app)
        .get(`/api/v1/tickets/${w.tA1.ticket.id}`)
        .set(await authAs(app, w.bob, w.A1.id))
    ).body.ticket;
    expect(detail.category.name).toBe('Payments');
    expect((await api('get', '/categories')).body.categories[0]._count.tickets).toBe(1);
    expect((await api('patch', '/categories/ghost').send({ name: 'x' })).status).toBe(404);
    expect((await api('patch', `/categories/${cat.id}`).send({ projectId: 'x' })).status).toBe(400);
  });
});

describe('SLA policies', () => {
  const put = (body) => api('put', '/sla-policies').send(body);

  it('lists policies together with the built-in defaults', async () => {
    const res = await api('get', '/sla-policies');
    expect(res.body.policies).toEqual([]);
    expect(res.body.defaults.URGENT).toEqual({ firstResponseHours: 1, resolutionHours: 4 });
  });

  it('upserts: one row per project+priority, global rows included', async () => {
    await put({ priority: 'HIGH', firstResponseHours: 2, resolutionHours: 6 });
    await put({ priority: 'HIGH', firstResponseHours: 3, resolutionHours: 9 });
    await put({ projectId: w.A1.id, priority: 'HIGH', firstResponseHours: 1, resolutionHours: 2 });
    await put({ projectId: w.A1.id, priority: 'HIGH', firstResponseHours: 1, resolutionHours: 3 });
    const rows = await prisma.slaPolicy.findMany({ orderBy: { projectId: 'asc' } });
    expect(
      rows.map((r) => [r.projectId, r.priority, r.firstResponseHours, r.resolutionHours]),
    ).toEqual([
      [w.A1.id, 'HIGH', 1, 3],
      [null, 'HIGH', 3, 9],
    ]);
    expect(await prisma.auditLog.count({ where: { action: 'sla.upsert' } })).toBe(4);
  });

  it('validates hours and ordering', async () => {
    expect(
      (await put({ priority: 'HIGH', firstResponseHours: 8, resolutionHours: 4 })).status,
    ).toBe(400);
    expect(
      (await put({ priority: 'HIGH', firstResponseHours: 0, resolutionHours: 4 })).status,
    ).toBe(400);
    expect(
      (await put({ priority: 'HIGH', firstResponseHours: 1.5, resolutionHours: 4 })).status,
    ).toBe(400);
    expect(
      (await put({ priority: 'NOPE', firstResponseHours: 1, resolutionHours: 4 })).status,
    ).toBe(400);
    expect(
      (
        await put({
          projectId: 'ghost',
          priority: 'HIGH',
          firstResponseHours: 1,
          resolutionHours: 4,
        })
      ).status,
    ).toBe(400);
  });

  it('new tickets use the new policy; removing an override falls back to the global one', async () => {
    await put({ priority: 'MEDIUM', firstResponseHours: 2, resolutionHours: 10 });
    const override = (
      await put({
        projectId: w.A1.id,
        priority: 'MEDIUM',
        firstResponseHours: 1,
        resolutionHours: 5,
      })
    ).body.policy;
    const make = async () => {
      const r = await request(app)
        .post('/api/v1/tickets')
        .set(await authAs(app, w.bob, w.A1.id))
        .field('subject', 'SLA policy check')
        .field('description', 'Checking the policy applies.');
      return prisma.ticket.findUnique({ where: { id: r.body.ticket.id } });
    };
    let t = await make();
    expect(t.resolutionDueAt.getTime() - t.createdAt.getTime()).toBe(5 * HOUR);
    expect((await api('delete', `/sla-policies/${override.id}`)).status).toBe(204);
    t = await make();
    expect(t.resolutionDueAt.getTime() - t.createdAt.getTime()).toBe(10 * HOUR);
  });

  it('refuses to delete the global policy', async () => {
    const global = (await put({ priority: 'LOW', firstResponseHours: 24, resolutionHours: 72 }))
      .body.policy;
    expect((await api('delete', `/sla-policies/${global.id}`)).status).toBe(409);
    expect((await api('delete', '/sla-policies/ghost')).status).toBe(404);
  });
});

describe('general settings', () => {
  it('updates the windows and rejects out-of-range values', async () => {
    const res = await api('patch', '/settings').send({
      reopenWindowDays: 14,
      autoCloseAfterDays: 3,
      feedbackEditWindowHours: 48,
      faqRequireApproval: true,
    });
    expect(res.body.settings).toMatchObject({
      reopenWindowDays: 14,
      autoCloseAfterDays: 3,
      feedbackEditWindowHours: 48,
      faqRequireApproval: true,
    });
    expect((await api('get', '/settings')).body.settings.reopenWindowDays).toBe(14);
    for (const bad of [
      { reopenWindowDays: 0 },
      { reopenWindowDays: 91 },
      { autoCloseAfterDays: 1.5 },
      { feedbackEditWindowHours: 200 },
      { reopenWindowDays: '7' },
      { unknown: 1 },
    ]) {
      expect((await api('patch', '/settings').send(bad)).status).toBe(400);
    }
    expect(await prisma.auditLog.count({ where: { action: 'settings.update' } })).toBe(1);
  });

  it('the reopen window setting changes what customers may do', async () => {
    await prisma.ticket.update({
      where: { id: w.tA1.ticket.id },
      data: { status: 'RESOLVED', resolvedAt: new Date(Date.now() - 3 * 24 * HOUR) },
    });
    await api('patch', '/settings').send({ reopenWindowDays: 2 });
    const bob = await authAs(app, w.bob, w.A1.id);
    expect(
      (
        await request(app)
          .post(`/api/v1/tickets/${w.tA1.ticket.id}/status`)
          .set(bob)
          .send({ status: 'REOPENED' })
      ).body.error.code,
    ).toBe('REOPEN_WINDOW_EXPIRED');
    await api('patch', '/settings').send({ reopenWindowDays: 5 });
    expect(
      (
        await request(app)
          .post(`/api/v1/tickets/${w.tA1.ticket.id}/status`)
          .set(bob)
          .send({ status: 'REOPENED' })
      ).status,
    ).toBe(200);
  });
});

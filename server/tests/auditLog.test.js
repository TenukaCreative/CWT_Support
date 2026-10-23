import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, resetDb, makeWorld, authAs } from './helpers.js';

const app = createApp();
let w;
let admin;
const api = (method, path, headers = admin) =>
  request(app)[method](`/api/v1/admin${path}`).set(headers);
const at = (iso) => new Date(iso);

beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  admin = await authAs(app, w.admin, 'ALL');
  await prisma.auditLog.createMany({
    data: [
      {
        actorId: w.admin.id,
        action: 'user.create',
        entity: 'User',
        entityId: 'u-1',
        metadata: { email: 'a@x.co' },
        createdAt: at('2026-03-01T10:00:00Z'),
      },
      {
        actorId: w.admin.id,
        action: 'user.deactivate',
        entity: 'User',
        entityId: 'u-2',
        metadata: { previousStatus: 'ACTIVE' },
        createdAt: at('2026-03-02T10:00:00Z'),
      },
      {
        actorId: w.supportA.id,
        action: 'faq.article.create',
        entity: 'FaqArticle',
        entityId: 'f-1',
        metadata: null,
        createdAt: at('2026-03-02T23:59:00Z'),
      },
      {
        actorId: w.supportA.id,
        action: 'tickets.export',
        entity: 'Ticket',
        entityId: null,
        metadata: { rows: 12 },
        createdAt: at('2026-03-04T08:00:00Z'),
      },
      {
        actorId: null,
        action: 'project.update',
        entity: 'Project',
        entityId: 'p-1',
        metadata: { changes: { name: 'X' } },
        createdAt: at('2026-03-05T08:00:00Z'),
      },
    ],
  });
});
afterAll(() => prisma.$disconnect());

describe('audit log API', () => {
  it('is admin-only', async () => {
    for (const path of ['/audit-logs', '/audit-logs/filters']) {
      expect((await request(app).get(`/api/v1/admin${path}`)).status).toBe(401);
      expect((await api('get', path, await authAs(app, w.supportA, w.A1.id))).status).toBe(403);
      expect((await api('get', path, await authAs(app, w.bob, w.A1.id))).status).toBe(403);
    }
  });

  it('lists newest first with the actor and structured metadata', async () => {
    const res = await api('get', '/audit-logs');
    expect(res.body.total).toBe(5);
    expect(res.body.items.map((l) => l.action)).toEqual([
      'project.update',
      'tickets.export',
      'faq.article.create',
      'user.deactivate',
      'user.create',
    ]);
    expect(res.body.items[0].actor).toBeNull(); // system action
    expect(res.body.items[1]).toMatchObject({
      actor: { name: 'supportA', role: 'SUPPORT' },
      metadata: { rows: 12 },
    });
    expect(res.body.items[4].metadata).toEqual({ email: 'a@x.co' });
  });

  it('filters by action prefix, exact action, actor, entity and free text', async () => {
    const actions = async (q) =>
      (await api('get', `/audit-logs${q}`)).body.items.map((l) => l.action).sort();
    expect(await actions('?action=user.')).toEqual(['user.create', 'user.deactivate']);
    expect(await actions('?action=user.create')).toEqual(['user.create']);
    expect(await actions(`?actorId=${w.supportA.id}`)).toEqual([
      'faq.article.create',
      'tickets.export',
    ]);
    expect(await actions('?entity=Project')).toEqual(['project.update']);
    expect(await actions('?q=export')).toEqual(['tickets.export']);
    expect(await actions('?q=f-1')).toEqual(['faq.article.create']); // entity id
    expect(await actions(`?action=user.&actorId=${w.supportA.id}`)).toEqual([]);
  });

  it('filters by inclusive date range', async () => {
    const actions = async (q) =>
      (await api('get', `/audit-logs${q}`)).body.items.map((l) => l.action).sort();
    expect(await actions('?from=2026-03-02&to=2026-03-02')).toEqual([
      'faq.article.create',
      'user.deactivate',
    ]); // includes 23:59
    expect(await actions('?from=2026-03-04')).toEqual(['project.update', 'tickets.export']);
    expect(await actions('?to=2026-03-01')).toEqual(['user.create']);
    expect((await api('get', '/audit-logs?from=03/01/2026')).status).toBe(400);
  });

  it('paginates and sorts with whitelisted fields', async () => {
    const p2 = await api('get', '/audit-logs?limit=2&page=2');
    expect(p2.body).toMatchObject({ page: 2, limit: 2, total: 5, totalPages: 3 });
    expect(p2.body.items.map((l) => l.action)).toEqual(['faq.article.create', 'user.deactivate']);
    const asc = await api('get', '/audit-logs?sort=createdAt&dir=asc&limit=1');
    expect(asc.body.items[0].action).toBe('user.create');
    expect((await api('get', '/audit-logs?sort=metadata')).status).toBe(400);
    expect((await api('get', '/audit-logs?limit=1000')).status).toBe(400);
  });

  it('offers the filter options', async () => {
    const res = await api('get', '/audit-logs/filters');
    expect(res.body.actions).toEqual([
      'faq.article.create',
      'project.update',
      'tickets.export',
      'user.create',
      'user.deactivate',
    ]);
    expect(res.body.entities).toEqual(['FaqArticle', 'Project', 'Ticket', 'User']);
    expect(res.body.actors.map((a) => a.name)).toEqual(['admin', 'supportA']);
  });

  it('is strictly read-only: there is no way to change or delete entries', async () => {
    const id = (await api('get', '/audit-logs')).body.items[0].id;
    for (const [method, path] of [
      ['post', '/audit-logs'],
      ['put', `/audit-logs/${id}`],
      ['patch', `/audit-logs/${id}`],
      ['delete', `/audit-logs/${id}`],
      ['delete', '/audit-logs'],
    ]) {
      expect((await api(method, path).send({})).status).toBe(404);
    }
    expect(await prisma.auditLog.count()).toBe(5);
  });

  it('records real admin actions so they show up in the viewer', async () => {
    await api('post', '/organizations').send({ name: 'Initech' });
    const res = await api('get', '/audit-logs?action=organization.');
    expect(res.body.items[0]).toMatchObject({
      action: 'organization.create',
      actor: { name: 'admin' },
      metadata: { name: 'Initech' },
    });
  });
});

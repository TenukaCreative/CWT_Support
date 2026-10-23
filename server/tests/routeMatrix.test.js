import request from 'supertest';
import { createApp } from '../src/app.js';
import { collectRoutes } from '../src/docs/routeTable.js';
import { prisma, resetDb, makeWorld, authAs } from './helpers.js';

// SECURITY NET. This enumerates EVERY endpoint the app registers (not a hand-kept list) and checks:
//  1. each one either requires a login or is on the explicit public allow-list below, so a new
//     route cannot ship unauthenticated by accident;
//  2. each role-restricted route rejects the roles that are not allowed (403), for every role.
const app = createApp();
const routes = collectRoutes();
const fill = (p) => p.replace(/:[A-Za-z]+/g, 'x');
const key = (r) => `${r.method} ${r.expressPath.replace('/api/v1', '')}`;

// Deliberately reachable without a bearer token (each is rate-limited and returns nothing private).
const PUBLIC = new Set([
  'GET /health',
  'GET /health/ready',
  'GET /auth/organizations',
  'POST /auth/register',
  'POST /auth/verify-email',
  'POST /auth/resend-verification',
  'POST /auth/login',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'GET /auth/invitations/:token',
  'POST /auth/accept-invite',
  'POST /auth/refresh',
  'POST /auth/logout', // cookie + CSRF header instead of a bearer token
]);

let w;
beforeAll(async () => {
  await resetDb();
  w = await makeWorld();
});
afterAll(() => prisma.$disconnect());

describe('route inventory', () => {
  it('finds the whole API (guards against the walker silently missing routers)', () => {
    expect(routes.length).toBeGreaterThan(85);
    const paths = new Set(routes.map(key));
    for (const expected of [
      'POST /tickets',
      'GET /tickets/:id',
      'GET /admin/audit-logs',
      'GET /reports/overview',
      'POST /auth/login',
      'GET /tickets/export.csv',
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it('every route is either authenticated (or CSRF-protected cookie auth) or explicitly public', () => {
    const open = routes.filter((r) => !r.auth && !r.csrf).map(key);
    expect(open.filter((k) => !PUBLIC.has(k))).toEqual([]); // anything listed here lacks authentication
    // and the allow-list itself must not rot: every entry has to exist
    const all = new Set(routes.map(key));
    expect([...PUBLIC].filter((k) => !all.has(k))).toEqual([]);
  });
});

describe('unauthenticated access', () => {
  const protectedRoutes = routes.filter((r) => r.auth && !PUBLIC.has(key(r)));

  it.each(protectedRoutes.map((r) => [key(r), r]))('%s -> 401 without a token', async (_k, r) => {
    const res = await request(app)[r.method.toLowerCase()](fill(r.expressPath)).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('a garbage bearer token is rejected everywhere it matters', async () => {
    for (const r of protectedRoutes.slice(0, 12)) {
      const res = await request(app)
        [r.method.toLowerCase()](fill(r.expressPath))
        .set('Authorization', 'Bearer not.a.jwt')
        .send({});
      expect(res.status).toBe(401);
    }
  });

  it('cookie-authenticated endpoints refuse requests without the CSRF header', async () => {
    for (const r of routes.filter((x) => x.csrf)) {
      expect((await request(app).post(fill(r.expressPath)).send({})).status).toBe(403);
    }
  });
});

describe('role restrictions', () => {
  const restricted = routes.filter((r) => r.roles);
  const ALL_ROLES = ['ADMIN', 'SUPPORT', 'CUSTOMER'];
  const actor = {
    ADMIN: () => authAs(app, w.admin, 'ALL'),
    SUPPORT: () => authAs(app, w.supportA, w.A1.id),
    CUSTOMER: () => authAs(app, w.bob, w.A1.id),
  };

  it('there are role-restricted routes to test', () => {
    expect(restricted.length).toBeGreaterThan(50);
  });

  it.each(restricted.map((r) => [key(r), r]))(
    '%s refuses roles it does not list',
    async (_k, r) => {
      for (const role of ALL_ROLES.filter((x) => !r.roles.includes(x))) {
        const res = await request(app)
          [r.method.toLowerCase()](fill(r.expressPath))
          .set(await actor[role]())
          .send({});
        expect({ role, status: res.status }).toEqual({ role, status: 403 });
      }
    },
  );
});

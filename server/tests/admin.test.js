import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  prisma,
  outbox,
  resetDb,
  makeWorld,
  login,
  authAs,
  csrf,
  PASSWORD,
  tokenFromLastMail,
} from './helpers.js';

const app = createApp();
let w;
let auth; // admin Authorization header

const call = (method, path, headers = auth) =>
  request(app)[method](`/api/v1/admin${path}`).set(headers);
const auditActions = async () =>
  (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map((a) => a.action);

beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  auth = await authAs(app, w.admin, 'ALL');
});
afterAll(() => prisma.$disconnect());

describe('authorization', () => {
  const endpoints = [
    ['get', '/organizations'],
    ['post', '/organizations'],
    ['get', '/projects'],
    ['post', '/projects'],
    ['get', '/users'],
    ['post', '/users'],
    ['patch', '/users/x'],
    ['post', '/users/x/approve'],
    ['put', '/users/x/projects'],
    ['get', '/invitations'],
    ['post', '/projects/x/members'],
  ];

  it.each(endpoints)('%s %s requires authentication', async (method, path) => {
    expect((await request(app)[method](`/api/v1/admin${path}`).send({})).status).toBe(401);
  });

  it.each(endpoints)('%s %s is forbidden to support and customers', async (method, path) => {
    for (const user of [w.supportA, w.bob]) {
      const headers = await authAs(app, user);
      expect((await call(method, path, headers).send({})).status).toBe(403);
    }
  });
});

describe('pagination, sorting, filtering', () => {
  it('pages results and reports totals', async () => {
    const p1 = await call('get', '/users?limit=3&page=1&sort=name&dir=asc');
    expect(p1.body.items).toHaveLength(3);
    expect(p1.body).toMatchObject({ page: 1, limit: 3, total: 7, totalPages: 3 });
    const p3 = await call('get', '/users?limit=3&page=3&sort=name&dir=asc');
    expect(p3.body.items).toHaveLength(1);
    const names = [
      ...p1.body.items,
      ...(await call('get', '/users?limit=3&page=2&sort=name&dir=asc')).body.items,
      ...p3.body.items,
    ].map((u) => u.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('filters by role, search, organization and project, and never leaks hashes', async () => {
    expect((await call('get', '/users?role=SUPPORT')).body.total).toBe(3);
    expect((await call('get', '/users?q=ALIC')).body.items.map((u) => u.name)).toEqual(['alice']);
    expect((await call('get', `/users?organizationId=${w.orgB.id}`)).body.total).toBe(1);
    expect((await call('get', `/users?projectId=${w.A2.id}`)).body.total).toBe(2); // alice + supportBoth
    expect(JSON.stringify((await call('get', '/users')).body)).not.toMatch(
      /passwordHash|\$2[aby]\$/,
    );
  });

  it('rejects unknown sort fields and oversized limits', async () => {
    expect((await call('get', '/users?sort=passwordHash')).status).toBe(400);
    expect((await call('get', '/users?limit=1000')).status).toBe(400);
  });
});

describe('organizations', () => {
  it('creates, validates, lists and audits', async () => {
    const res = await call('post', '/organizations').send({
      name: 'Initech',
      domain: 'Initech.COM',
    });
    expect(res.status).toBe(201);
    expect(res.body.organization.domain).toBe('initech.com');
    expect(
      (await call('post', '/organizations').send({ name: 'Dup', domain: 'initech.com' })).status,
    ).toBe(409);
    expect(
      (await call('post', '/organizations').send({ name: 'Bad', domain: 'not a domain' })).status,
    ).toBe(400);
    expect((await call('post', '/organizations').send({ name: '' })).status).toBe(400);
    expect((await call('get', '/organizations?q=init')).body.items).toHaveLength(1);
    expect(await auditActions()).toContain('organization.create');
  });

  it('archiving an organization archives its projects and removes customer access', async () => {
    const bob = await authAs(app, w.bob, w.A1.id);
    expect((await request(app).get(`/api/v1/tickets/${w.tA1.ticket.id}`).set(bob)).status).toBe(
      200,
    );

    const res = await call('patch', `/organizations/${w.orgA.id}`).send({ status: 'ARCHIVED' });
    expect(res.body.organization.status).toBe('ARCHIVED');
    expect((await prisma.project.findUnique({ where: { id: w.A1.id } })).status).toBe('ARCHIVED');
    expect((await request(app).get(`/api/v1/tickets/${w.tA1.ticket.id}`).set(bob)).status).toBe(
      409,
    ); // PROJECT_REQUIRED

    const logged = await login(app, w.bob);
    expect(logged.res.body.projects).toEqual([]);
    expect(
      (await call('post', '/projects').send({ organizationId: w.orgA.id, name: 'X', key: 'XX' }))
        .status,
    ).toBe(400);
  });

  it('404s for unknown ids and rejects unknown fields', async () => {
    expect((await call('get', '/organizations/nope')).status).toBe(404);
    expect((await call('patch', `/organizations/${w.orgA.id}`).send({ id: 'hack' })).status).toBe(
      400,
    );
  });
});

describe('projects', () => {
  it('creates with a normalised unique key and an audit entry', async () => {
    const res = await call('post', '/projects').send({
      organizationId: w.orgB.id,
      name: 'Portal',
      key: 'glx-portal',
      description: '',
    });
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({ key: 'GLX-PORTAL', description: null, ticketSeq: 0 });
    expect(
      (
        await call('post', '/projects').send({
          organizationId: w.orgB.id,
          name: 'Again',
          key: 'GLX-PORTAL',
        })
      ).status,
    ).toBe(409);
    expect(await auditActions()).toContain('project.create');
  });

  it.each(['A', 'has space', '-BAD', 'bad--key', 'under_score'])(
    'rejects invalid key %p',
    async (key) => {
      expect(
        (await call('post', '/projects').send({ organizationId: w.orgA.id, name: 'X', key }))
          .status,
      ).toBe(400);
    },
  );

  it('keeps the key immutable', async () => {
    expect((await call('patch', `/projects/${w.A1.id}`).send({ key: 'NEW-KEY' })).status).toBe(400);
    const ok = await call('patch', `/projects/${w.A1.id}`).send({
      name: 'Renamed',
      description: 'Hello',
    });
    expect(ok.body.project).toMatchObject({ name: 'Renamed', key: 'A-ONE' });
  });

  it("archived projects disappear from customers' project lists", async () => {
    await call('patch', `/projects/${w.A2.id}`).send({ status: 'ARCHIVED' });
    const { res } = await login(app, w.alice);
    expect(res.body.projects.map((p) => p.key)).toEqual(['A-ONE']);
    expect(res.body.activeProjectId).toBe(w.A1.id); // now a single choice -> auto-selected
  });

  it('lists with counts and filters by organization', async () => {
    const res = await call('get', `/projects?organizationId=${w.orgA.id}&sort=key&dir=asc`);
    expect(res.body.items.map((p) => p.key)).toEqual(['A-ONE', 'A-TWO']);
    expect(res.body.items[0]._count.members).toBe(4); // supportA, supportBoth, alice, bob
  });
});

describe('project membership', () => {
  it('adds members and grants real access immediately', async () => {
    const carolAttempt = await authAs(app, w.bob);
    const sel = (pid) =>
      request(app).post('/api/v1/auth/select-project').set(carolAttempt).send({ projectId: pid });
    expect((await sel(w.A2.id)).status).toBe(404);

    const res = await call('post', `/projects/${w.A2.id}/members`).send({
      userIds: [w.bob.id, w.supportA.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.project.members.map((m) => m.name)).toEqual(
      expect.arrayContaining(['bob', 'supportA']),
    );
    expect((await sel(w.A2.id)).status).toBe(200);
    expect(await auditActions()).toContain('project.members.add');
  });

  it('refuses customers from another organization and admins', async () => {
    const other = await call('post', `/projects/${w.A1.id}/members`).send({
      userIds: [w.carol.id],
    });
    expect(other.status).toBe(400);
    expect(
      (await call('post', `/projects/${w.A1.id}/members`).send({ userIds: [w.admin.id] })).status,
    ).toBe(400);
    expect(
      (await call('post', `/projects/${w.A1.id}/members`).send({ userIds: ['ghost'] })).status,
    ).toBe(400);
    expect(
      await prisma.projectMember.count({ where: { userId: w.carol.id, projectId: w.A1.id } }),
    ).toBe(0);
  });

  it('is atomic: one bad user means nobody is added', async () => {
    const res = await call('post', `/projects/${w.A2.id}/members`).send({
      userIds: [w.bob.id, w.carol.id],
    });
    expect(res.status).toBe(400);
    expect(
      await prisma.projectMember.count({ where: { userId: w.bob.id, projectId: w.A2.id } }),
    ).toBe(0);
  });

  it('removes members, and removal takes effect on the next request', async () => {
    const bob = await authAs(app, w.bob, w.A1.id);
    const read = () => request(app).get(`/api/v1/tickets/${w.tA1.ticket.id}`).set(bob);
    expect((await read()).status).toBe(200);
    expect((await call('delete', `/projects/${w.A1.id}/members/${w.bob.id}`)).status).toBe(204);
    expect((await read()).status).toBe(409);
    expect((await call('delete', `/projects/${w.A1.id}/members/${w.bob.id}`)).status).toBe(404);
  });

  it('cannot add members to an archived project', async () => {
    await call('patch', `/projects/${w.A2.id}`).send({ status: 'ARCHIVED' });
    expect(
      (await call('post', `/projects/${w.A2.id}/members`).send({ userIds: [w.bob.id] })).status,
    ).toBe(409);
  });

  it("replaces a user's projects from the user side with the same rules", async () => {
    const ok = await call('put', `/users/${w.alice.id}/projects`).send({ projectIds: [w.A2.id] });
    expect(ok.body.user.projects.map((p) => p.key)).toEqual(['A-TWO']);
    expect(
      (await call('put', `/users/${w.alice.id}/projects`).send({ projectIds: [w.B1.id] })).status,
    ).toBe(400);
    expect(
      (
        await call('put', `/users/${w.supportA.id}/projects`).send({
          projectIds: [w.B1.id, w.A1.id],
        })
      ).status,
    ).toBe(200);
    expect(
      (await call('put', `/users/${w.admin.id}/projects`).send({ projectIds: [w.A1.id] })).status,
    ).toBe(400);
  });
});

describe('users', () => {
  it('creates a user who sets their own password through an emailed link', async () => {
    const res = await call('post', '/users').send({
      name: 'New Agent',
      email: 'Agent@Test.dev',
      role: 'SUPPORT',
      projectIds: [w.A1.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: 'agent@test.dev',
      status: 'ACTIVE',
      role: 'SUPPORT',
    });
    expect(outbox.at(-1).to).toBe('agent@test.dev');

    const set = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenFromLastMail(), password: 'Fr3shPassword!!' });
    expect(set.status).toBe(200);
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'agent@test.dev', password: 'Fr3shPassword!!' });
    expect(loginRes.body.activeProjectId).toBe(w.A1.id);
  });

  it('requires an organization for customers and rejects duplicates / cross-org projects', async () => {
    expect(
      (await call('post', '/users').send({ name: 'C', email: 'c@test.dev', role: 'CUSTOMER' }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('post', '/users').send({
          name: 'C',
          email: 'c@test.dev',
          role: 'CUSTOMER',
          organizationId: w.orgA.id,
          projectIds: [w.B1.id],
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('post', '/users').send({ name: 'C', email: w.bob.email, role: 'SUPPORT' }))
        .status,
    ).toBe(409);
  });

  it('role change clears memberships, ends sessions and cannot target yourself', async () => {
    const session = await login(app, w.supportA);
    const res = await call('patch', `/users/${w.supportA.id}`).send({
      role: 'CUSTOMER',
      organizationId: w.orgA.id,
    });
    expect(res.body.user).toMatchObject({ role: 'CUSTOMER', projects: [] });
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(csrf).set('Cookie', session.cookie))
        .status,
    ).toBe(401);

    expect((await call('patch', `/users/${w.admin.id}`).send({ role: 'SUPPORT' })).status).toBe(
      409,
    );
  });

  it('moving a customer to another organization clears their old-org memberships', async () => {
    const res = await call('patch', `/users/${w.bob.id}`).send({ organizationId: w.orgB.id });
    expect(res.body.user.organization.name).toBe('Org B');
    expect(res.body.user.projects).toEqual([]);
  });

  it('deactivation kills access immediately; reactivation restores it', async () => {
    const header = await authAs(app, w.bob, w.A1.id);
    const me = () => request(app).get('/api/v1/auth/me').set(header);
    expect((await me()).status).toBe(200);
    expect((await call('post', `/users/${w.bob.id}/deactivate`)).body.user.status).toBe(
      'DEACTIVATED',
    );
    expect((await me()).status).toBe(401);
    expect((await call('post', `/users/${w.bob.id}/reactivate`)).body.user.status).toBe('ACTIVE');
    expect((await me()).status).toBe(200);
  });

  it('protects administrators from locking themselves out', async () => {
    expect((await call('post', `/users/${w.admin.id}/deactivate`)).status).toBe(409);
    expect((await call('patch', `/users/${w.admin.id}`).send({ role: 'SUPPORT' })).status).toBe(
      409,
    );

    // A second admin may demote the first; the remaining one is then protected from itself.
    const second = await prisma.user.create({
      data: {
        name: 'admin2',
        email: 'admin2@test.dev',
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: w.admin.passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const header = await authAs(app, second, 'ALL');
    expect(
      (await call('patch', `/users/${w.admin.id}`, header).send({ role: 'SUPPORT' })).status,
    ).toBe(200);
    expect((await call('post', `/users/${second.id}/deactivate`, header)).status).toBe(409);
    expect((await prisma.user.findUnique({ where: { id: second.id } })).status).toBe('ACTIVE');
  });

  it('unlocks a locked account', async () => {
    for (let i = 0; i < 5; i++)
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: w.bob.email, password: 'Wr0ngPassword!' });
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: w.bob.email, password: PASSWORD })
      ).status,
    ).toBe(423);
    await call('post', `/users/${w.bob.id}/unlock`);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: w.bob.email, password: PASSWORD })
      ).status,
    ).toBe(200);
  });
});

describe('registration approval', () => {
  const register = async (email = 'newbie@orga.test') => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Newbie', email, password: PASSWORD, organizationId: w.orgA.id });
    const token = tokenFromLastMail();
    return { token, user: await prisma.user.findUnique({ where: { email } }) };
  };
  const verify = (token) => request(app).post('/api/v1/auth/verify-email').send({ token });

  it('lists pending registrations, approves with projects, and the user can then log in', async () => {
    const { token, user } = await register();
    await verify(token);

    const pending = await call('get', '/users?status=PENDING&role=CUSTOMER');
    expect(pending.body.items.map((u) => u.email)).toEqual(['newbie@orga.test']);
    expect(pending.body.items[0].organization.name).toBe('Org A');

    const res = await call('post', `/users/${user.id}/approve`).send({
      projectIds: [w.A1.id, w.A2.id],
    });
    expect(res.body.user).toMatchObject({ status: 'ACTIVE' });
    expect(res.body.user.projects).toHaveLength(2);
    expect(outbox.at(-1).subject).toMatch(/approved/i);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'newbie@orga.test', password: PASSWORD });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.needsProjectSelection).toBe(true);
    expect(await auditActions()).toContain('user.approve');
  });

  it('refuses unverified emails, other-org projects, and non-pending users', async () => {
    const { token, user } = await register();
    expect((await call('post', `/users/${user.id}/approve`).send({ projectIds: [] })).status).toBe(
      409,
    ); // not verified
    await verify(token);
    expect(
      (await call('post', `/users/${user.id}/approve`).send({ projectIds: [w.B1.id] })).status,
    ).toBe(400);
    expect((await call('post', `/users/${w.bob.id}/approve`).send({ projectIds: [] })).status).toBe(
      409,
    ); // already active
  });

  it('rejects a registration: it stays on record, cannot log in, and is emailed', async () => {
    const { token, user } = await register();
    await verify(token);
    const res = await call('post', `/users/${user.id}/reject`).send({ reason: 'Not a client' });
    expect(res.body.user.status).toBe('DEACTIVATED');
    expect(outbox.at(-1).text).toContain('Not a client');
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'newbie@orga.test', password: PASSWORD });
    expect(loginRes.body.error.code).toBe('ACCOUNT_DEACTIVATED');
    expect((await call('post', `/users/${user.id}/reactivate`)).status).toBe(200); // verified, so an admin may reverse it
  });
});

describe('invitations (admin)', () => {
  it('lists open invitations and revokes them', async () => {
    await call('post', '/invitations').send({
      email: 'inv@orga.test',
      role: 'CUSTOMER',
      organizationId: w.orgA.id,
      projectIds: [w.A1.id],
    });
    const raw = tokenFromLastMail();
    const list = await call('get', '/invitations');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      email: 'inv@orga.test',
      organization: { name: 'Org A' },
    });
    expect(list.body.items[0].projects[0].key).toBe('A-ONE');
    expect(JSON.stringify(list.body)).not.toContain('tokenHash');

    expect((await call('delete', `/invitations/${list.body.items[0].id}`)).status).toBe(204);
    expect((await request(app).get(`/api/v1/auth/invitations/${raw}`)).status).toBe(400);
    expect((await call('get', '/invitations')).body.items).toHaveLength(0);
    expect(await auditActions()).toEqual(
      expect.arrayContaining(['invitation.create', 'invitation.revoke']),
    );
  });
});

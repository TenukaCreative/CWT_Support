import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  prisma,
  outbox,
  resetDb,
  makeWorld,
  login,
  csrf,
  PASSWORD,
  tokenFromLastMail,
} from './helpers.js';

const app = createApp();
const api = (m, path) => request(app)[m](`/api/v1${path}`);
let w;

beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});
afterAll(() => prisma.$disconnect());

describe('registration & verification', () => {
  const body = (over = {}) => ({
    name: 'New Person',
    email: 'new@orga.test',
    password: PASSWORD,
    organizationId: w.orgA.id,
    ...over,
  });

  it('lists organisations for the register form', async () => {
    const res = await api('get', '/auth/organizations');
    expect(res.body.organizations.map((o) => o.name).sort()).toEqual(['Org A', 'Org B']);
  });

  it('creates a PENDING account, requires email verification, then approval', async () => {
    expect((await api('post', '/auth/register').send(body())).status).toBe(201);
    expect(outbox).toHaveLength(1);

    const beforeVerify = await api('post', '/auth/login').send({
      email: 'new@orga.test',
      password: PASSWORD,
    });
    expect(beforeVerify.status).toBe(403);
    expect(beforeVerify.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const verify = await api('post', '/auth/verify-email').send({ token: tokenFromLastMail() });
    expect(verify.body.status).toBe('PENDING');

    const afterVerify = await api('post', '/auth/login').send({
      email: 'new@orga.test',
      password: PASSWORD,
    });
    expect(afterVerify.body.error.code).toBe('ACCOUNT_PENDING_APPROVAL');
  });

  it('verification tokens are single-use', async () => {
    await api('post', '/auth/register').send(body());
    const token = tokenFromLastMail();
    expect((await api('post', '/auth/verify-email').send({ token })).status).toBe(200);
    expect((await api('post', '/auth/verify-email').send({ token })).status).toBe(400);
  });

  it('does not reveal whether an email is already registered', async () => {
    const res = await api('post', '/auth/register').send(body({ email: w.bob.email }));
    expect(res.status).toBe(201);
    expect(outbox).toHaveLength(0);
    expect(await prisma.user.count({ where: { email: w.bob.email } })).toBe(1);
  });

  it('rejects weak passwords and unknown organisations', async () => {
    expect((await api('post', '/auth/register').send(body({ password: 'short' }))).status).toBe(
      400,
    );
    expect(
      (await api('post', '/auth/register').send(body({ password: 'alllettersnodigit' }))).status,
    ).toBe(400);
    expect(
      (await api('post', '/auth/register').send(body({ organizationId: 'nope' }))).status,
    ).toBe(400);
  });

  it('a registration matching an open invitation goes live after verifying email', async () => {
    const { token: adminToken } = await login(app, w.admin);
    await api('post', '/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'new@orga.test',
        role: 'CUSTOMER',
        organizationId: w.orgA.id,
        projectIds: [w.A1.id],
      });
    outbox.length = 0;

    await api('post', '/auth/register').send(body());
    const verify = await api('post', '/auth/verify-email').send({ token: tokenFromLastMail() });
    expect(verify.body.status).toBe('ACTIVE');
    const res = await api('post', '/auth/login').send({
      email: 'new@orga.test',
      password: PASSWORD,
    });
    expect(res.body.activeProjectId).toBe(w.A1.id);
  });
});

describe('login', () => {
  it('gives identical errors for unknown email and wrong password', async () => {
    const a = await api('post', '/auth/login').send({
      email: 'ghost@test.dev',
      password: PASSWORD,
    });
    const b = await api('post', '/auth/login').send({
      email: w.bob.email,
      password: 'Wr0ngPassword!',
    });
    expect(a.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('sets an httpOnly refresh cookie and never puts the refresh token in the body', async () => {
    const { res } = await login(app, w.bob);
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/sd_refresh=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(JSON.stringify(res.body)).not.toMatch(/refresh/i);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('auto-selects the project when there is only one, otherwise asks for a choice', async () => {
    const bob = (await login(app, w.bob)).res.body;
    expect(bob.activeProjectId).toBe(w.A1.id);
    expect(bob.needsProjectSelection).toBe(false);

    const alice = (await login(app, w.alice)).res.body;
    expect(alice.activeProjectId).toBeNull();
    expect(alice.needsProjectSelection).toBe(true);
    expect(alice.projects.map((p) => p.key).sort()).toEqual(['A-ONE', 'A-TWO']);

    const admin = (await login(app, w.admin)).res.body;
    expect(admin.projects).toHaveLength(3);
    expect(admin.needsProjectSelection).toBe(true);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    for (let i = 0; i < 5; i++) {
      await api('post', '/auth/login').send({ email: w.bob.email, password: 'Wr0ngPassword!' });
    }
    const res = await api('post', '/auth/login').send({ email: w.bob.email, password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('refuses deactivated accounts and kills their existing access tokens immediately', async () => {
    const { token } = await login(app, w.bob);
    expect((await api('get', '/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    await prisma.user.update({ where: { id: w.bob.id }, data: { status: 'DEACTIVATED' } });
    expect((await api('get', '/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    const res = await api('post', '/auth/login').send({ email: w.bob.email, password: PASSWORD });
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('rejects missing, malformed and tampered tokens', async () => {
    expect((await api('get', '/auth/me')).status).toBe(401);
    expect((await api('get', '/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
    const { token } = await login(app, w.bob);
    const tampered = token.slice(0, -3) + (token.endsWith('aaa') ? 'bbb' : 'aaa');
    expect((await api('get', '/auth/me').set('Authorization', `Bearer ${tampered}`)).status).toBe(
      401,
    );
  });
});

describe('project selection & switching', () => {
  it('re-issues the token for a project the user belongs to and remembers it', async () => {
    const { token } = await login(app, w.alice);
    const res = await api('post', '/auth/select-project')
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId: w.A2.id });
    expect(res.status).toBe(200);
    expect(res.body.activeProjectId).toBe(w.A2.id);
    expect((await prisma.user.findUnique({ where: { id: w.alice.id } })).lastProjectId).toBe(
      w.A2.id,
    );

    const me = await api('get', '/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.body.activeProjectId).toBe(w.A2.id);
  });

  it('404s when selecting a project the user is not a member of', async () => {
    const { token } = await login(app, w.bob);
    for (const id of [w.A2.id, w.B1.id, 'nope']) {
      const res = await api('post', '/auth/select-project')
        .set('Authorization', `Bearer ${token}`)
        .send({ projectId: id });
      expect(res.status).toBe(404);
    }
  });

  it('"All projects" is allowed for admin and support, never for customers', async () => {
    const ok = async (user) => {
      const { token } = await login(app, user);
      return api('post', '/auth/select-project')
        .set('Authorization', `Bearer ${token}`)
        .send({ projectId: 'ALL' });
    };
    expect((await ok(w.admin)).status).toBe(200);
    expect((await ok(w.supportBoth)).status).toBe(200);
    expect((await ok(w.alice)).status).toBe(404);
  });

  it('tenant routes demand a selected project', async () => {
    const { token } = await login(app, w.alice);
    const res = await api('get', `/tickets/${w.tA1.ticket.id}`).set(
      'Authorization',
      `Bearer ${token}`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_REQUIRED');
  });

  it('a membership removed mid-session takes effect on the next request', async () => {
    const { token } = await login(app, w.bob); // auto-selected A1
    expect(
      (await api('get', `/tickets/${w.tA1.ticket.id}`).set('Authorization', `Bearer ${token}`))
        .status,
    ).toBe(200);
    await prisma.projectMember.deleteMany({ where: { userId: w.bob.id } });
    const res = await api('get', `/tickets/${w.tA1.ticket.id}`).set(
      'Authorization',
      `Bearer ${token}`,
    );
    expect(res.status).toBe(409);
  });

  it('restores the remembered project on refresh', async () => {
    const first = await login(app, w.alice);
    await api('post', '/auth/select-project')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ projectId: w.A2.id });
    const res = await api('post', '/auth/refresh').set(csrf).set('Cookie', first.cookie);
    expect(res.body.activeProjectId).toBe(w.A2.id);
  });
});

describe('refresh tokens', () => {
  it('requires the CSRF header and an allowed Origin', async () => {
    const { cookie } = await login(app, w.bob);
    expect((await api('post', '/auth/refresh').set('Cookie', cookie)).status).toBe(403);
    expect(
      (
        await api('post', '/auth/refresh')
          .set(csrf)
          .set('Origin', 'http://evil.example')
          .set('Cookie', cookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await api('post', '/auth/refresh')
          .set(csrf)
          .set('Origin', 'http://localhost:5173')
          .set('Cookie', cookie)
      ).status,
    ).toBe(200);
  });

  it('rotates on every use and revokes the whole family if an old token is replayed', async () => {
    const { cookie: c1 } = await login(app, w.bob);
    const r1 = await api('post', '/auth/refresh').set(csrf).set('Cookie', c1);
    expect(r1.status).toBe(200);
    const c2 = r1.headers['set-cookie'][0].split(';')[0];
    expect(c2).not.toBe(c1);

    // Replay of the already-rotated token = theft signal.
    expect((await api('post', '/auth/refresh').set(csrf).set('Cookie', c1)).status).toBe(401);
    // ...and the legitimate newest token is now dead too.
    expect((await api('post', '/auth/refresh').set(csrf).set('Cookie', c2)).status).toBe(401);
  });

  it('logout revokes the session', async () => {
    const { cookie } = await login(app, w.bob);
    expect((await api('post', '/auth/logout').set(csrf).set('Cookie', cookie)).status).toBe(204);
    expect((await api('post', '/auth/refresh').set(csrf).set('Cookie', cookie)).status).toBe(401);
  });

  it('fails without a cookie', async () => {
    expect((await api('post', '/auth/refresh').set(csrf)).status).toBe(401);
  });
});

describe('password reset', () => {
  it('answers identically for unknown emails and sends nothing', async () => {
    const res = await api('post', '/auth/forgot-password').send({ email: 'ghost@test.dev' });
    expect(res.status).toBe(200);
    expect(outbox).toHaveLength(0);
  });

  it('resets once, signs out all sessions, and lets the new password work', async () => {
    const { cookie } = await login(app, w.bob);
    await api('post', '/auth/forgot-password').send({ email: w.bob.email });
    const token = tokenFromLastMail();

    expect(
      (await api('post', '/auth/reset-password').send({ token, password: 'N3wPassword!!' })).status,
    ).toBe(200);
    expect(
      (await api('post', '/auth/reset-password').send({ token, password: 'An0therOne!!!' })).status,
    ).toBe(400);

    expect((await api('post', '/auth/refresh').set(csrf).set('Cookie', cookie)).status).toBe(401);
    expect(
      (await api('post', '/auth/login').send({ email: w.bob.email, password: PASSWORD })).status,
    ).toBe(401);
    expect(
      (await api('post', '/auth/login').send({ email: w.bob.email, password: 'N3wPassword!!' }))
        .status,
    ).toBe(200);
  });

  it('rejects expired tokens', async () => {
    await api('post', '/auth/forgot-password').send({ email: w.bob.email });
    const token = tokenFromLastMail();
    await prisma.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(
      (await api('post', '/auth/reset-password').send({ token, password: 'N3wPassword!!' })).status,
    ).toBe(400);
  });
});

describe('invitations', () => {
  const invite = (token, over = {}) =>
    api('post', '/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'invitee@orga.test',
        role: 'CUSTOMER',
        organizationId: w.orgA.id,
        projectIds: [w.A1.id],
        ...over,
      });

  it('is admin-only', async () => {
    const { token } = await login(app, w.supportA);
    expect((await invite(token)).status).toBe(403);
    const { token: cust } = await login(app, w.bob);
    expect((await invite(cust)).status).toBe(403);
  });

  it('pre-assigns organisation and projects, and creates an active account on accept', async () => {
    const { token } = await login(app, w.admin);
    expect((await invite(token)).status).toBe(201);
    const raw = tokenFromLastMail();

    const preview = await api('get', `/auth/invitations/${raw}`);
    expect(preview.body).toMatchObject({
      email: 'invitee@orga.test',
      role: 'CUSTOMER',
      organization: 'Org A',
    });

    const accept = await api('post', '/auth/accept-invite').send({
      token: raw,
      name: 'Invitee',
      password: PASSWORD,
    });
    expect(accept.status).toBe(201);
    expect(
      (
        await api('post', '/auth/accept-invite').send({
          token: raw,
          name: 'Again',
          password: PASSWORD,
        })
      ).status,
    ).toBe(400);

    const res = await api('post', '/auth/login').send({
      email: 'invitee@orga.test',
      password: PASSWORD,
    });
    expect(res.body.activeProjectId).toBe(w.A1.id);
    expect(res.body.user.organization.name).toBe('Org A');
    expect(await prisma.auditLog.count({ where: { action: 'invitation.create' } })).toBe(1);
  });

  it("refuses projects that do not belong to the invited customer's organisation", async () => {
    const { token } = await login(app, w.admin);
    expect((await invite(token, { projectIds: [w.B1.id] })).status).toBe(400);
  });

  it('refuses expired invitations and existing users', async () => {
    const { token } = await login(app, w.admin);
    await invite(token);
    const raw = tokenFromLastMail();
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api('get', `/auth/invitations/${raw}`)).status).toBe(400);
    expect((await invite(token, { email: w.bob.email })).status).toBe(409);
  });
});

describe('profile', () => {
  it('updates name and notification preferences, rejects unknown fields', async () => {
    const { token } = await login(app, w.bob);
    const prefs = {
      emailOnReply: false,
      emailOnStatusChange: true,
      emailOnAssignment: true,
      inApp: true,
    };
    const res = await api('patch', '/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Robert', notificationPrefs: prefs });
    expect(res.body.user).toMatchObject({ name: 'Robert', notificationPrefs: prefs });
    expect(
      (
        await api('patch', '/users/me')
          .set('Authorization', `Bearer ${token}`)
          .send({ role: 'ADMIN' })
      ).status,
    ).toBe(400);
  });

  it('changes password with the current one and signs out other devices only', async () => {
    const mine = await login(app, w.bob);
    const other = await login(app, w.bob);
    const bad = await api('post', '/users/me/password')
      .set('Authorization', `Bearer ${mine.token}`)
      .set('Cookie', mine.cookie)
      .send({ currentPassword: 'Wr0ngPassword!', newPassword: 'N3wPassword!!' });
    expect(bad.status).toBe(400);
    const ok = await api('post', '/users/me/password')
      .set('Authorization', `Bearer ${mine.token}`)
      .set('Cookie', mine.cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'N3wPassword!!' });
    expect(ok.status).toBe(200);
    expect((await api('post', '/auth/refresh').set(csrf).set('Cookie', other.cookie)).status).toBe(
      401,
    );
    expect((await api('post', '/auth/refresh').set(csrf).set('Cookie', mine.cookie)).status).toBe(
      200,
    );
  });
});

import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { sniffMatches } from '../src/middleware/upload.js';
import {
  prisma,
  outbox,
  resetDb,
  makeWorld,
  authAs,
  login,
  csrf,
  PASSWORD,
  tokenFromLastMail,
} from './helpers.js';

const app = createApp();
let w;
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});
afterAll(() => prisma.$disconnect());

describe('health endpoints', () => {
  it('liveness is cheap and readiness checks the database', async () => {
    expect((await request(app).get('/api/v1/health')).body).toMatchObject({
      status: 'ok',
      uptime: expect.any(Number),
    });
    expect((await request(app).get('/api/v1/health/ready')).body).toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('readiness answers 503 (not 500) when the database is down, so load balancers drop the instance', async () => {
    const spy = jest
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', database: 'down' });
    expect(JSON.stringify(res.body)).not.toMatch(/refused/); // no internals
    spy.mockRestore();
    expect((await request(app).get('/api/v1/health/ready')).status).toBe(200);
  });
});

describe('central error handler', () => {
  const run = (err) => {
    const res = {
      statusCode: null,
      payload: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.payload = b;
        return this;
      },
    };
    errorHandler(err, { log: { error: () => {} } }, res, () => {});
    return res;
  };
  const prismaErr = (code) =>
    new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });

  it('maps Prisma unique and not-found errors without leaking details', () => {
    expect(run(prismaErr('P2002'))).toMatchObject({
      statusCode: 409,
      payload: { error: { code: 'CONFLICT' } },
    });
    expect(run(prismaErr('P2025'))).toMatchObject({
      statusCode: 404,
      payload: { error: { code: 'NOT_FOUND' } },
    });
    expect(run(prismaErr('P9999'))).toMatchObject({
      statusCode: 500,
      payload: { error: { code: 'INTERNAL_ERROR' } },
    });
  });

  it('maps upload errors to stable codes', () => {
    const multer = (code) => Object.assign(new Error(code), { name: 'MulterError', code });
    expect(run(multer('LIMIT_FILE_SIZE'))).toMatchObject({
      statusCode: 413,
      payload: { error: { code: 'FILE_TOO_LARGE' } },
    });
    expect(run(multer('LIMIT_FILE_COUNT'))).toMatchObject({
      statusCode: 400,
      payload: {
        error: { code: 'UPLOAD_ERROR', message: expect.stringMatching(/Too many files/) },
      },
    });
    expect(run(multer('LIMIT_UNEXPECTED_FIELD'))).toMatchObject({
      statusCode: 400,
      payload: { error: { code: 'UPLOAD_ERROR' } },
    });
  });

  it('unknown errors become a generic 500 (internals stay in the log)', () => {
    const r = run(new TypeError('secret path /etc/passwd'));
    expect(r.statusCode).toBe(500);
    expect(JSON.stringify(r.payload)).not.toMatch(/passwd|TypeError/);
  });
});

describe('upload file signatures', () => {
  const bytes = (...b) => Buffer.from(b);
  it('accepts the real thing and refuses impostors for every allowed type', () => {
    expect(sniffMatches('.png', bytes(0x89, 0x50, 0x4e, 0x47))).toBe(true);
    expect(sniffMatches('.png', bytes(0xff, 0xd8, 0xff))).toBe(false);
    expect(sniffMatches('.jpg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(sniffMatches('.jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(sniffMatches('.gif', Buffer.from('GIF89a'))).toBe(true);
    expect(
      sniffMatches(
        '.webp',
        Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('WEBP')]),
      ),
    ).toBe(true);
    expect(
      sniffMatches(
        '.webp',
        Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('WAVE')]),
      ),
    ).toBe(false);
    expect(sniffMatches('.pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    for (const ext of ['.docx', '.xlsx', '.zip']) {
      expect(sniffMatches(ext, bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true);
      expect(sniffMatches(ext, bytes(0x50, 0x4b, 0x05, 0x06))).toBe(true); // empty archive
      expect(sniffMatches(ext, Buffer.from('MZ\x90\x00'))).toBe(false); // an .exe renamed
    }
    expect(sniffMatches('.txt', Buffer.from('plain text'))).toBe(true);
    expect(sniffMatches('.txt', bytes(0x68, 0x00, 0x69))).toBe(false); // NUL byte = binary
    expect(sniffMatches('.exe', Buffer.from('MZ'))).toBe(false); // unknown extension never passes
  });
});

describe('registration helpers', () => {
  it('resending the verification email only helps unverified pending accounts, and reveals nothing', async () => {
    await request(app).post('/api/v1/auth/register').send({
      name: 'Pending',
      email: 'pend@orga.test',
      password: PASSWORD,
      organizationId: w.orgA.id,
    });
    outbox.length = 0;
    expect(
      (
        await request(app)
          .post('/api/v1/auth/resend-verification')
          .send({ email: 'pend@orga.test' })
      ).status,
    ).toBe(200);
    expect(outbox).toHaveLength(1);
    outbox.length = 0;
    for (const email of ['ghost@orga.test', w.bob.email]) {
      expect(
        (await request(app).post('/api/v1/auth/resend-verification').send({ email })).body.message,
      ).toMatch(/If that is possible/);
    }
    expect(outbox).toHaveLength(0);
  });

  it("domain auto-join (feature flag) activates matching-domain users with their organisation's projects; off by default", async () => {
    await prisma.organization.update({ where: { id: w.orgA.id }, data: { domain: 'orga.test' } });
    const register = async (email) => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({ name: 'Joiner', email, password: PASSWORD, organizationId: w.orgA.id });
      return request(app).post('/api/v1/auth/verify-email').send({ token: tokenFromLastMail() });
    };
    expect((await register('off@orga.test')).body.status).toBe('PENDING'); // flag off

    env.FEATURE_DOMAIN_AUTOJOIN = true;
    try {
      expect((await register('on@orga.test')).body.status).toBe('ACTIVE');
      const joined = await prisma.user.findUnique({
        where: { email: 'on@orga.test' },
        include: { memberships: true },
      });
      expect(joined.memberships.map((m) => m.projectId).sort()).toEqual([w.A1.id, w.A2.id].sort());
      expect((await register('other@elsewhere.test')).body.status).toBe('PENDING'); // domain must match
    } finally {
      env.FEATURE_DOMAIN_AUTOJOIN = false;
    }
  });
});

describe('admin edge cases', () => {
  it('refuses to create customers in archived or unknown organisations, and invitations for unknown ones', async () => {
    const admin = await authAs(app, w.admin, 'ALL');
    await prisma.organization.update({ where: { id: w.orgB.id }, data: { status: 'ARCHIVED' } });
    const create = (organizationId) =>
      request(app)
        .post('/api/v1/admin/users')
        .set(admin)
        .send({ name: 'X', email: 'x@y.co', role: 'CUSTOMER', organizationId });
    expect((await create(w.orgB.id)).status).toBe(400);
    expect((await create('ghost')).status).toBe(400);
    const invite = await request(app)
      .post('/api/v1/admin/invitations')
      .set(admin)
      .send({ email: 'inv@y.co', role: 'CUSTOMER', organizationId: 'ghost', projectIds: [] });
    expect(invite.status).toBe(400);
  });

  it('adding members to a missing project or with unknown users fails cleanly', async () => {
    const admin = await authAs(app, w.admin, 'ALL');
    expect(
      (
        await request(app)
          .post('/api/v1/admin/projects/ghost/members')
          .set(admin)
          .send({ userIds: [w.bob.id] })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .put(`/api/v1/admin/users/${w.bob.id}/projects`)
          .set(admin)
          .send({ projectIds: ['ghost'] })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .put('/api/v1/admin/users/ghost/projects')
          .set(admin)
          .send({ projectIds: [] })
      ).status,
    ).toBe(404);
  });
});

describe('sessions and passwords', () => {
  it('changing a password without a session cookie signs out every device', async () => {
    const a = await login(app, w.bob);
    const b = await login(app, w.bob);
    const res = await request(app)
      .post('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'N3wPassword!!' });
    expect(res.status).toBe(200);
    for (const c of [a, b])
      expect(
        (await request(app).post('/api/v1/auth/refresh').set(csrf).set('Cookie', c.cookie)).status,
      ).toBe(401);
  });

  it('a revoked family cannot be revived: logout then replay the old refresh token', async () => {
    const s = await login(app, w.bob);
    await request(app).post('/api/v1/auth/logout').set(csrf).set('Cookie', s.cookie);
    expect(
      (await request(app).post('/api/v1/auth/refresh').set(csrf).set('Cookie', s.cookie)).status,
    ).toBe(401);
    expect((await request(app).post('/api/v1/auth/logout').set(csrf)).status).toBe(204); // logging out twice / without a cookie is harmless
  });
});

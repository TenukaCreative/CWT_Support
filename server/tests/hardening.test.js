import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMailer, outbox } from '../src/lib/mailer.js';
import { redactUrl } from '../src/lib/logger.js';
import { plainSnippet, renderMarkdown } from '../src/lib/markdown.js';
import { mountClient } from '../src/spa.js';
import { startJobs } from '../src/jobs/index.js';
import { prisma, resetDb, makeWorld, authAs, PASSWORD } from './helpers.js';

const app = createApp();
const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
let w;

beforeAll(async () => {
  await resetDb();
  w = await makeWorld();
});
afterAll(() => prisma.$disconnect());

describe('markdown sanitiser: known XSS / mutation-XSS vectors', () => {
  const VECTORS = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<svg><style><img src=x onerror=alert(1)></style></svg>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<a href="jav&#x09;ascript:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<form action="javascript:alert(1)"><input type=submit formaction="javascript:alert(1)"></form>',
    '<textarea></textarea/><img src=x onerror=alert(1)>',
    '<object data="javascript:alert(1)"></object><embed src="javascript:alert(1)">',
    "<style>@import 'javascript:alert(1)'</style>",
    '<div style="background:url(javascript:alert(1))">x</div>',
    '<body onload=alert(1)><base href="javascript:alert(1)//">',
    '[x](javascript:alert(1))',
    '[x](  javascript:alert(1))',
    '[x](vbscript:alert(1))',
    '![x](javascript:alert(1))',
    '<a href="//evil.example/x">protocol relative</a>',
    '<details open ontoggle=alert(1)>x</details>',
    '<a href="https://ok.example" onclick="steal()" target="_self" rel="opener">x</a>',
  ];
  const FORBIDDEN =
    /<script|onerror|onload|onclick|ontoggle|javascript:|vbscript:|data:text|<svg|<math|<img|<iframe|<meta|<style|<form|<input|<object|<embed|<base|<noscript|<textarea|srcdoc|style=|href="\/\//i;

  it.each(VECTORS.map((v) => [v.slice(0, 60), v]))('neutralises %s', (_name, vector) => {
    const html = renderMarkdown(`before\n\n${vector}\n\nafter`);
    expect(html).not.toMatch(FORBIDDEN);
    expect(html).toContain('before');
  });

  it('keeps legitimate formatting, and forces safe link attributes that authors cannot override', () => {
    const html = renderMarkdown(
      '**bold** _em_\n\n- a\n- b\n\n| h |\n|---|\n| c |\n\n[ok](https://example.com) [mail](mailto:a@b.co) <a href="https://x.test" target="_self" rel="opener">raw</a>',
    );
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<table>');
    expect(html).toMatch(
      /<a href="mailto:a@b.co" rel="noopener noreferrer nofollow" target="_blank">/,
    );
    expect(
      [...html.matchAll(/<a [^>]*>/g)].every(
        (m) => /rel="noopener noreferrer nofollow"/.test(m[0]) && /target="_blank"/.test(m[0]),
      ),
    ).toBe(true);
    expect(html).not.toMatch(/target="_self"|rel="opener"/);
    expect(renderMarkdown('# Title')).toContain('<h2>Title</h2>');
  });

  it('plain snippets contain no markup and decode entities', () => {
    expect(plainSnippet('<b>5 &lt; 6</b> & <script>alert(1)</script>fine')).toBe('5 < 6 & fine');
  });
});

describe('log hygiene', () => {
  it('scrubs tokens from URLs', () => {
    expect(redactUrl('/api/v1/auth/invitations/abc123_-XYZ?x=1')).toBe(
      '/api/v1/auth/invitations/[redacted]?x=1',
    );
    expect(redactUrl('/verify-email?token=secret&b=2')).toBe('/verify-email?token=[redacted]&b=2');
    expect(redactUrl('/a?x=1&token=secret')).toBe('/a?x=1&token=[redacted]');
    expect(redactUrl('/api/v1/tickets/123')).toBe('/api/v1/tickets/123');
    expect(redactUrl(undefined)).toBe('');
  });
});

describe('HTTP hardening', () => {
  it('gives every response a request id and ignores unsafe caller-supplied ids', async () => {
    const a = await request(app).get('/api/v1/health');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const ok = await request(app).get('/api/v1/health').set('X-Request-Id', 'trace-abc12345');
    expect(ok.headers['x-request-id']).toBe('trace-abc12345');
    const evil = await request(app).get('/api/v1/health').set('X-Request-Id', 'x y;rm -rf');
    expect(evil.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const short = await request(app).get('/api/v1/health').set('X-Request-Id', 'abc');
    expect(short.headers['x-request-id']).not.toBe('abc');
  });

  it('API responses are never cacheable, and security headers are present', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'self'/);
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBeDefined();
  });

  it('CORS: allow-listed origin with credentials; preflight cached; others get nothing', async () => {
    const pre = await request(app)
      .options('/api/v1/tickets')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(pre.headers['access-control-allow-credentials']).toBe('true');
    expect(pre.headers['access-control-max-age']).toBe('600');
    const bad = await request(app)
      .options('/api/v1/tickets')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const wildcard = await request(app).get('/api/v1/health').set('Origin', 'null');
    expect(wildcard.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('malformed and oversized request bodies get clean 4xx errors in the standard format', async () => {
    const bad = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BAD_REQUEST');
    const big = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(2 * 1024 * 1024) }));
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(JSON.stringify(bad.body)).not.toMatch(/SyntaxError|at JSON|node_modules/);
  });

  it('unknown routes and methods are JSON 404s with no framework banner', async () => {
    const res = await request(app).delete('/api/v1/definitely/not/here');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.text).not.toMatch(/Express|Cannot DELETE/);
  });
});

describe('access tokens', () => {
  const secret = process.env.JWT_ACCESS_SECRET;
  const claims = { pid: w?.A1?.id ?? null };
  const sign = (opts = {}, extra = {}) =>
    jwt.sign({ pid: null, ...extra }, secret, {
      subject: w.bob.id,
      algorithm: 'HS256',
      issuer: 'supportdesk',
      audience: 'supportdesk-api',
      expiresIn: '5m',
      ...opts,
    });
  const me = (token) => request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

  it('accepts a correctly issued token (control)', async () => {
    expect((await me(sign())).status).toBe(200);
    void claims;
  });

  it('rejects wrong issuer, wrong audience, wrong secret, expired and unsigned tokens', async () => {
    expect((await me(sign({ issuer: 'someone-else' }))).status).toBe(401);
    expect((await me(sign({ audience: 'another-api' }))).status).toBe(401);
    expect(
      (
        await me(
          jwt.sign({ pid: null }, 'a-completely-different-secret-of-sufficient-length', {
            subject: w.bob.id,
            issuer: 'supportdesk',
            audience: 'supportdesk-api',
          }),
        )
      ).status,
    ).toBe(401);
    expect((await me(sign({ expiresIn: -10 }))).status).toBe(401);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: w.admin.id, iss: 'supportdesk', aud: 'supportdesk-api' })).toString('base64url')}.`;
    expect((await me(none)).status).toBe(401);
  });

  it('the role inside a token is never trusted (it is read from the database)', async () => {
    const forged = sign({}, { role: 'ADMIN' });
    const res = await me(forged);
    expect(res.body.user.role).toBe('CUSTOMER');
    expect(
      (await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${forged}`))
        .status,
    ).toBe(403);
  });
});

describe('input edge cases', () => {
  it('bcrypt truncates at 72 BYTES, so longer multi-byte passwords are refused instead of silently shortened', async () => {
    const emoji = `Ab1${'😀'.repeat(20)}`; // 23 characters, 83 bytes
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Emoji', email: 'emoji@test.dev', password: emoji, organizationId: w.orgA.id });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toMatch(/72 bytes/);
    const ok = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Plain',
        email: 'plain@test.dev',
        password: `${PASSWORD}!`,
        organizationId: w.orgA.id,
      });
    expect(ok.status).toBe(201);
  });

  it('search text is treated literally: % and _ are not wildcards', async () => {
    const h = await authAs(app, w.supportA, w.A1.id);
    for (const q of ['%', '_', '%%', 'A1 t_cket']) {
      const res = await request(app).get('/api/v1/tickets').query({ q }).set(h);
      expect({ q, total: res.body.total }).toEqual({ q, total: 0 });
    }
    expect(
      (await request(app).get('/api/v1/tickets').query({ q: 'A1 ticket' }).set(h)).body.total,
    ).toBe(1);
  });

  it('upload display names cannot carry paths or control characters; disk names are random', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    const res = await request(app)
      .post('/api/v1/tickets')
      .set(h)
      .field('subject', 'Traversal attempt here')
      .field('description', 'Trying to escape the upload folder.')
      .attach('files', pdf, { filename: '../../etc/pass"wd.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    const att = await prisma.attachment.findFirst({
      where: { ticket: { number: res.body.ticket.number } },
    });
    expect(att.filename).toMatch(/^pass.*wd\.pdf$/);
    expect(att.filename).not.toMatch(/[/\\]|\.\./); // no directory parts survive
    expect(att.storedName).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('startup configuration guard', () => {
  const run = (env) => {
    try {
      execFileSync(
        process.execPath,
        ['--input-type=module', '-e', "await import('./src/config/env.js')"],
        {
          cwd: SERVER_DIR,
          env: { PATH: process.env.PATH, ...env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );
      return { code: 0, stderr: '' };
    } catch (e) {
      return { code: e.status, stderr: String(e.stderr) };
    }
  };
  const good = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db:5432/x',
    CLIENT_URL: 'https://support.example.com',
    CORS_ORIGINS: 'https://support.example.com',
    JWT_ACCESS_SECRET: 'a'.repeat(24) + 'Q9xK2vLm8TzR4wYb',
    JWT_REFRESH_SECRET: 'z'.repeat(20) + 'H7pN3cVd6GsJ1aEf',
  };

  it('accepts a sound production configuration', () => {
    expect(run(good)).toEqual({ code: 0, stderr: '' });
  });

  it('refuses to start in production with placeholder or reused secrets, plain-http origins or wildcard CORS', () => {
    const cases = [
      [{ JWT_ACCESS_SECRET: 'change-me-access-secret-at-least-32-chars' }, /JWT_ACCESS_SECRET/],
      [{ JWT_REFRESH_SECRET: good.JWT_ACCESS_SECRET }, /JWT_REFRESH_SECRET: must differ/],
      [{ CLIENT_URL: 'http://support.example.com' }, /CLIENT_URL/],
      [{ CORS_ORIGINS: '*' }, /CORS_ORIGINS/],
      [{ CORS_ORIGINS: 'https://ok.example.com,http://insecure.example.com' }, /CORS_ORIGINS/],
      [{ JWT_ACCESS_SECRET: 'short' }, /at least 32/],
      [{ DATABASE_URL: '' }, /DATABASE_URL/],
    ];
    for (const [override, message] of cases) {
      const r = run({ ...good, ...override });
      expect({ override, code: r.code }).toEqual({ override, code: 1 });
      expect(r.stderr).toMatch(message);
    }
  });

  it('the strict production rules do not apply to development', () => {
    expect(
      run({
        ...good,
        NODE_ENV: 'development',
        CLIENT_URL: 'http://localhost:5173',
        JWT_ACCESS_SECRET: 'change-me-access-secret-at-least-32-chars',
      }).code,
    ).toBe(0);
  });
});

describe('serving the web app from the API', () => {
  let dist;
  let spa;
  beforeAll(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(
      path.join(dist, 'index.html'),
      '<!doctype html><title>SupportDesk</title><div id="root"></div>',
    );
    fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log("app")');
    fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *');
    spa = createApp({ clientDist: dist });
  });
  afterAll(() => fs.rmSync(dist, { recursive: true, force: true }));

  it('serves the app shell for the root and for client-side routes, uncached', async () => {
    for (const p of ['/', '/login', '/app/tickets/abc123', '/app/admin/audit']) {
      const res = await request(spa).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['content-security-policy']).toBeDefined(); // security headers apply to the shell too
    }
  });

  it('fingerprinted assets are cached for a year; missing assets and files are real 404s, never index.html', async () => {
    const asset = await request(spa).get('/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toMatch(/max-age=31536000.*immutable/);
    const missing = await request(spa).get('/assets/nope.js');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('<div id="root">');
    expect((await request(spa).get('/favicon.ico')).status).toBe(404);
    expect((await request(spa).get('/robots.txt')).status).toBe(200);
  });

  it('the API is unaffected: JSON for api routes, JSON 404 for unknown api paths, no traversal', async () => {
    expect((await request(spa).get('/api/v1/health')).body.status).toBe('ok');
    const nope = await request(spa).get('/api/v1/nope');
    expect(nope.status).toBe(404);
    expect(nope.headers['content-type']).toMatch(/json/);
    for (const p of [
      '/..%2f..%2f..%2fetc%2fpasswd',
      '/assets/..%2f..%2fsecret',
      '/%2e%2e/%2e%2e/etc/passwd',
    ]) {
      const res = await request(spa).get(p);
      expect(res.text).not.toMatch(/root:/);
    }
    expect((await request(spa).post('/login').send({})).status).toBe(404); // the shell is GET-only
  });

  it('refuses to start when the build is missing', () => {
    expect(() =>
      mountClient(createApp(), path.join(os.tmpdir(), 'definitely-missing-dist')),
    ).toThrow(/npm run build/);
  });
});

describe('email delivery', () => {
  it('sends through the transport with the configured sender', async () => {
    const sent = [];
    const send = createMailer({
      capture: false,
      from: 'SupportDesk <no-reply@x.test>',
      transport: { sendMail: async (m) => sent.push(m) },
    });
    await send({ to: 'a@b.co', subject: 'Hi', text: 'Body' });
    expect(sent).toEqual([
      { from: 'SupportDesk <no-reply@x.test>', to: 'a@b.co', subject: 'Hi', text: 'Body' },
    ]);
  });

  it('a failing transport never throws (a mail outage must not break ticket updates)', async () => {
    const send = createMailer({
      capture: false,
      transport: {
        sendMail: async () => {
          throw new Error('SMTP down');
        },
      },
    });
    await expect(send({ to: 'a@b.co', subject: 'Hi', text: 'Body' })).resolves.toBeUndefined();
  });

  it('works end-to-end with the real nodemailer (json transport) and without any transport (dev log)', async () => {
    const { default: nodemailer } = await import('nodemailer');
    const info = await createMailer({
      capture: false,
      transport: nodemailer.createTransport({ jsonTransport: true }),
    })({ to: 'a@b.co', subject: 'Hi', text: 'Body' });
    expect(info).toBeUndefined();
    await expect(
      createMailer({ capture: false })({ to: 'a@b.co', subject: 'Dev', text: 'logged only' }),
    ).resolves.toBeUndefined();
    const before = outbox.length;
    await createMailer({ capture: true })({ to: 'cap@b.co', subject: 'S', text: 'T' });
    expect(outbox).toHaveLength(before + 1);
  });
});

describe('background job scheduling', () => {
  it('starts both schedules, catches up once, and stops cleanly', async () => {
    const stop = startJobs();
    expect(typeof stop).toBe('function');
    await new Promise((r) => setTimeout(r, 400)); // let the startup catch-up runs finish before the DB is torn down
    expect(() => stop()).not.toThrow();
  });
});

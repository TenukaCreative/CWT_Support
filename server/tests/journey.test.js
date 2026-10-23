import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  prisma,
  outbox,
  resetDb,
  makeWorld,
  authAs,
  login,
  PASSWORD,
  tokenFromLastMail,
} from './helpers.js';

// DEFINITION OF DONE, as one test: all three roles complete their core journeys end to end.
//   register -> verify -> admin approves -> login -> pick project -> search FAQ -> raise ticket ->
//   support assigns / replies / resolves -> customer is notified and rates -> admin sees it all.
// Everything goes through the real HTTP API and the real database; nothing is mocked.
const app = createApp();
const api = (method, path, headers = {}) => request(app)[method](`/api/v1${path}`).set(headers);

let w;
beforeAll(async () => {
  await resetDb();
  w = await makeWorld();
  await prisma.ticket.deleteMany(); // start from an empty desk: only this journey's data
  await prisma.faqArticle.deleteMany();
  await prisma.project.updateMany({ data: { ticketSeq: 0 } }); // the fixture's tickets used up numbers
});
afterAll(() => prisma.$disconnect());

it('a customer goes from sign-up to a rated, resolved ticket that the admin sees on the dashboard', async () => {
  const support = await authAs(app, w.supportA, w.A1.id);
  const admin = await authAs(app, w.admin, 'ALL');

  // ── support prepares the knowledge base
  const article = await api('post', '/faq/manage/articles', support).send({
    projectId: w.A1.id,
    question: 'How do I reset my password?',
    answer: 'Use **Forgot password** on the login page.',
    status: 'PUBLISHED',
  });
  expect(article.status).toBe(201);

  // ── customer registers; the account must be verified AND approved
  const email = 'journey@orga.test';
  expect(
    (
      await api('post', '/auth/register').send({
        name: 'Jo Journey',
        email,
        password: PASSWORD,
        organizationId: w.orgA.id,
      })
    ).status,
  ).toBe(201);
  expect(
    (await api('post', '/auth/login').send({ email, password: PASSWORD })).body.error.code,
  ).toBe('EMAIL_NOT_VERIFIED');
  expect(
    (await api('post', '/auth/verify-email').send({ token: tokenFromLastMail() })).body.status,
  ).toBe('PENDING');
  expect(
    (await api('post', '/auth/login').send({ email, password: PASSWORD })).body.error.code,
  ).toBe('ACCOUNT_PENDING_APPROVAL');

  // ── admin finds the registration in the approval queue and approves it for two projects
  const pending = await api('get', '/admin/users?status=PENDING&role=CUSTOMER', admin);
  const registration = pending.body.items.find((u) => u.email === email);
  expect(registration).toMatchObject({
    emailVerifiedAt: expect.any(String),
    organization: { name: 'Org A' },
  });
  const approved = await api('post', `/admin/users/${registration.id}/approve`, admin).send({
    projectIds: [w.A1.id, w.A2.id],
  });
  expect(approved.body.user.status).toBe('ACTIVE');
  expect(outbox.at(-1)).toMatchObject({ to: email, subject: expect.stringMatching(/approved/i) });

  // ── customer logs in, is asked which project, and picks one
  const session = await login(app, { email });
  expect(session.res.status).toBe(200);
  expect(session.res.body).toMatchObject({ needsProjectSelection: true, activeProjectId: null });
  expect(session.res.body.projects.map((p) => p.key).sort()).toEqual(['A-ONE', 'A-TWO']);
  const picked = await api('post', '/auth/select-project', {
    Authorization: `Bearer ${session.token}`,
  }).send({ projectId: w.A1.id });
  expect(picked.status).toBe(200);
  const customer = { Authorization: `Bearer ${picked.body.accessToken}` };

  // ── customer searches the Help Center: one search finds an article, another finds nothing
  const hit = await api('get', '/faq/search?q=reset password', customer);
  expect(hit.body.items.map((i) => i.question)).toEqual(['How do I reset my password?']);
  expect(
    (
      await api('post', `/faq/search-logs/${hit.body.searchLogId}/click`, customer).send({
        articleId: hit.body.items[0].id,
      })
    ).status,
  ).toBe(204);
  const miss = await api('get', '/faq/search?q=invoice download', customer);
  expect(miss.body.items).toEqual([]);

  // ── still stuck: raises a ticket (the zero-result search is attached to it)
  const created = await request(app)
    .post('/api/v1/tickets')
    .set(customer)
    .field('subject', 'Cannot download my invoice')
    .field('description', 'The invoice PDF will not download from the billing page.')
    .field('priority', 'HIGH')
    .field('searchLogId', miss.body.searchLogId);
  expect(created.status).toBe(201);
  const ticket = created.body.ticket;
  expect(ticket).toMatchObject({ number: 'A-ONE-0001', status: 'OPEN', priority: 'HIGH' });
  expect(outbox.at(-1)).toMatchObject({
    to: email,
    subject: expect.stringContaining('A-ONE-0001'),
  }); // confirmation

  // ── support finds it in the queue, takes it, answers the customer, leaves a private note, resolves
  const queue = await api('get', '/tickets?status=OPEN', support);
  expect(queue.body.items.map((t) => t.number)).toEqual(['A-ONE-0001']);
  expect(queue.body.items[0].createdBy.email).toBe(email); // staff see who raised it
  expect(
    (await api('post', `/tickets/${ticket.id}/assign`, support).send({ assigneeId: w.supportA.id }))
      .body.ticket.assignee.name,
  ).toBe('supportA');
  const reply = await request(app)
    .post(`/api/v1/tickets/${ticket.id}/messages`)
    .set(support)
    .field('body', 'Thanks! Please try again now, we fixed the PDF service.');
  expect(reply.status).toBe(201);
  await request(app)
    .post(`/api/v1/tickets/${ticket.id}/messages`)
    .set(support)
    .field('body', 'Root cause: expired font license on the renderer.')
    .field('type', 'INTERNAL_NOTE');
  expect(
    (await api('post', `/tickets/${ticket.id}/status`, support).send({ status: 'RESOLVED' })).body
      .ticket.status,
  ).toBe('RESOLVED');

  // ── customer is told (in-app and by email), sees the reply but never the note, and rates the support
  const notes = await api('get', '/notifications', customer);
  expect(notes.body.items.map((n) => n.type).sort()).toEqual([
    'TICKET_CREATED',
    'TICKET_REPLY',
    'TICKET_RESOLVED',
  ]);
  expect(outbox.filter((m) => m.to === email).at(-1).text).toContain(
    `/app/tickets/${ticket.id}?rate=1`,
  );
  const view = await api('get', `/tickets/${ticket.id}`, customer);
  expect(view.body.messages.filter((m) => m.type !== 'SYSTEM').map((m) => m.body)).toEqual([
    'The invoice PDF will not download from the billing page.',
    'Thanks! Please try again now, we fixed the PDF service.',
  ]);
  expect(JSON.stringify(view.body)).not.toMatch(/font license|DueAt|slaPaused/);
  expect(view.body.ticket).toMatchObject({ status: 'RESOLVED', canRate: true });
  const rated = await api('post', `/tickets/${ticket.id}/feedback`, customer).send({
    rating: 5,
    comment: 'Fast, friendly and fixed.',
  });
  expect(rated.status).toBe(201);

  // ── the other customer of the project could see none of the private parts either
  const other = await authAs(app, w.bob, w.A1.id);
  expect(JSON.stringify((await api('get', `/tickets/${ticket.id}`, other)).body)).not.toMatch(
    /font license|Fast, friendly/,
  );

  // ── admin sees the journey on the dashboard, in the reports, in the export and in the audit log
  const overview = (await api('get', '/reports/overview', admin)).body;
  expect(overview.totals).toMatchObject({ created: 1, resolved: 1, openNow: 0 });
  expect(overview.responseTimes.firstResponse.count).toBe(1);
  expect(overview.categories).toEqual([{ name: 'Uncategorised', count: 1 }]);
  const csat = (await api('get', '/reports/csat', admin)).body;
  expect(csat.summary).toMatchObject({ count: 1, average: 5 });
  expect(csat.byAgent).toEqual([{ id: w.supportA.id, name: 'supportA', count: 1, average: 5 }]);
  const faq = (await api('get', '/reports/deflection', admin)).body;
  expect(faq.totals).toMatchObject({
    searches: 2,
    zeroResults: 1,
    clicked: 1,
    ticketsAfter: 1,
    deflected: 1,
  });
  expect(faq.zeroResults.map((z) => z.query)).toEqual(['invoice download']);

  const csv = await request(app)
    .get('/api/v1/tickets/export.csv')
    .set(admin)
    .buffer(true)
    .parse((res, cb) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => cb(null, d));
    });
  expect(csv.body).toContain('A-ONE-0001');
  expect(csv.body).toContain('Cannot download my invoice');
  expect(csv.body).not.toContain('font license');

  const audit = (await api('get', '/admin/audit-logs?limit=50', admin)).body.items.map(
    (l) => l.action,
  );
  expect(audit).toEqual(
    expect.arrayContaining(['user.approve', 'faq.article.create', 'tickets.export']),
  );
});

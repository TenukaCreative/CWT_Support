import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, resetDb, makeWorld, authAs } from './helpers.js';

const app = createApp();
let w;
const H = 3_600_000;

// Minimal RFC 4180 parser so the tests read the file the way a spreadsheet would.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && src[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += ch;
  }
  return rows;
}
const download = (query, headers) =>
  request(app)
    .get(`/api/v1/tickets/export.csv${query}`)
    .set(headers)
    .buffer(true)
    .parse((res, cb) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => cb(null, d));
    });
const table = (res) => {
  const [head, ...rows] = parseCsv(res.body);
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};

beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});
afterAll(() => prisma.$disconnect());

describe('ticket CSV export', () => {
  it('returns a UTF-8 CSV download with the documented columns and one row per ticket', async () => {
    const res = await download('', await authAs(app, w.admin, 'ALL'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="tickets-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body.charCodeAt(0)).toBe(0xfeff); // BOM for Excel
    const [head] = parseCsv(res.body);
    expect(head).toEqual(
      expect.arrayContaining([
        'Ticket',
        'Project',
        'Subject',
        'Status',
        'Priority',
        'Assignee',
        'Customer email',
        'Created (UTC)',
        'Rating',
        'First response SLA',
      ]),
    );
    expect(
      table(res)
        .map((r) => r.Ticket)
        .sort(),
    ).toEqual(['A-ONE-0001', 'A-TWO-0001', 'B-ONE-0001']);
  });

  it('fills in names, dates, durations, SLA verdicts and the rating', async () => {
    const t = w.tA1.ticket;
    const created = new Date(Date.now() - 48 * H);
    await prisma.ticket.update({
      where: { id: t.id },
      data: {
        createdAt: created,
        status: 'RESOLVED',
        priority: 'HIGH',
        assigneeId: w.supportA.id,
        firstResponseAt: new Date(+created + 2 * H),
        firstResponseDueAt: new Date(+created + 4 * H),
        resolvedAt: new Date(+created + 12 * H),
        resolutionDueAt: new Date(+created + 8 * H),
        slaPausedSeconds: 3600,
      },
    });
    await prisma.feedback.create({
      data: {
        ticketId: t.id,
        createdById: w.bob.id,
        rating: 4,
        comment: 'PRIVATE feedback comment',
      },
    });
    const row = table(await download('', await authAs(app, w.supportA, w.A1.id))).find(
      (r) => r.Ticket === 'A-ONE-0001',
    );
    expect(row).toMatchObject({
      Project: 'A-ONE',
      Status: 'RESOLVED',
      Priority: 'HIGH',
      'Raised by': 'bob',
      'Customer email': 'bob@test.dev',
      Organization: 'Org A',
      Assignee: 'supportA',
      'Created (UTC)': created.toISOString(),
      'First response (hours)': '2',
      'Resolution (hours, excl. waiting on customer)': '11',
      'First response SLA': 'Met',
      'Resolution SLA': 'Missed',
      Rating: '4',
      'Merged into': '',
    });
  });

  it('is scoped: support gets only their projects, admin everything, customers nothing', async () => {
    const support = table(await download('', await authAs(app, w.supportA, w.A1.id)));
    expect(support.map((r) => r.Ticket)).toEqual(['A-ONE-0001']);
    const both = table(await download('', await authAs(app, w.supportBoth, 'ALL')));
    expect(both.map((r) => r.Ticket).sort()).toEqual(['A-ONE-0001', 'A-TWO-0001']);
    const scopedAdmin = table(await download('', await authAs(app, w.admin, w.B1.id)));
    expect(scopedAdmin.map((r) => r.Ticket)).toEqual(['B-ONE-0001']);

    expect((await download('', await authAs(app, w.bob, w.A1.id))).status).toBe(403);
    expect((await download('', {})).status).toBe(401);
    expect((await download('', await authAs(app, w.supportBoth))).status).toBe(409); // no project chosen
    // asking for someone else's project through a filter yields nothing, not their data
    expect(
      table(await download(`?projectId=${w.B1.id}`, await authAs(app, w.supportA, w.A1.id))),
    ).toEqual([]);
  });

  it('applies the same filters as the queue, plus a created-date range', async () => {
    const mk = async (over) => {
      const { ticketSeq } = await prisma.project.update({
        where: { id: w.A1.id },
        data: { ticketSeq: { increment: 1 } },
      });
      return prisma.ticket.create({
        data: {
          projectId: w.A1.id,
          createdById: w.bob.id,
          subject: 'Extra',
          description: 'extra ticket text',
          sequence: ticketSeq,
          number: `A-ONE-${String(ticketSeq).padStart(4, '0')}`,
          ...over,
        },
      });
    };
    await mk({
      subject: 'Printer jam',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      assigneeId: w.supportA.id,
      createdAt: new Date('2026-01-10T12:00:00Z'),
    });
    await mk({
      subject: 'Login broken',
      status: 'RESOLVED',
      priority: 'LOW',
      createdAt: new Date('2026-02-20T23:30:00Z'),
    });
    const h = await authAs(app, w.supportA, w.A1.id);
    const subjects = async (q) =>
      table(await download(q, h))
        .map((r) => r.Subject)
        .sort();
    expect(await subjects('?status=IN_PROGRESS')).toEqual(['Printer jam']);
    expect(await subjects('?priority=LOW')).toEqual(['Login broken']);
    expect(await subjects('?assigneeId=me')).toEqual(['Printer jam']);
    expect(await subjects('?q=PRINTER')).toEqual(['Printer jam']);
    expect(await subjects('?from=2026-02-20&to=2026-02-20')).toEqual(['Login broken']); // the whole "to" day is included
    expect(await subjects('?from=2026-01-01&to=2026-01-31')).toEqual(['Printer jam']);
    expect((await download('?status=NOPE', h)).status).toBe(400);
    expect((await download('?from=2026-13-01', h)).status).toBe(400);
  });

  it('never includes internal notes, message text or feedback comments', async () => {
    await prisma.feedback.create({
      data: {
        ticketId: w.tA1.ticket.id,
        createdById: w.bob.id,
        rating: 5,
        comment: 'SECRET feedback',
      },
    });
    const res = await download('', await authAs(app, w.admin, 'ALL'));
    expect(res.body).not.toMatch(/SECRET|public A1 ticket/);
  });

  it('escapes awkward content and defuses formulas', async () => {
    await prisma.ticket.update({
      where: { id: w.tA1.ticket.id },
      data: { subject: '=HYPERLINK("http://evil.example","click")' },
    });
    await prisma.ticket.update({
      where: { id: w.tA2.ticket.id },
      data: { subject: 'Comma, "quote" and\nnewline' },
    });
    await prisma.ticket.update({ where: { id: w.tB1.ticket.id }, data: { subject: '+1+1' } });
    const res = await download('', await authAs(app, w.admin, 'ALL'));
    const rows = table(res);
    const by = (n) => rows.find((r) => r.Ticket === n).Subject;
    expect(by('A-ONE-0001')).toBe('\'=HYPERLINK("http://evil.example","click")');
    expect(by('A-TWO-0001')).toBe('Comma, "quote" and\nnewline');
    expect(by('B-ONE-0001')).toBe("'+1+1");
    expect(rows).toHaveLength(3); // the embedded newline did not create extra rows
  });

  it('refuses oversized exports with a normal JSON error instead of a truncated file', async () => {
    for (let i = 0; i < 7; i += 1) {
      const { ticketSeq } = await prisma.project.update({
        where: { id: w.A1.id },
        data: { ticketSeq: { increment: 1 } },
      });
      await prisma.ticket.create({
        data: {
          projectId: w.A1.id,
          createdById: w.bob.id,
          subject: 'Bulk',
          description: 'bulk ticket text',
          sequence: ticketSeq,
          number: `A-ONE-${String(ticketSeq).padStart(4, '0')}`,
        },
      });
    }
    const h = await authAs(app, w.admin, 'ALL'); // 3 + 7 = 10 tickets, limit is 8 in tests
    const res = await request(app).get('/api/v1/tickets/export.csv').set(h);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('EXPORT_TOO_LARGE');
    expect(res.body.error.message).toMatch(/limit is 8/);
    expect((await download(`?projectId=${w.B1.id}`, h)).status).toBe(200); // narrowed: fine
  });

  it('writes an audit entry for every export', async () => {
    await download('?status=OPEN', await authAs(app, w.supportA, w.A1.id));
    const log = await prisma.auditLog.findFirst({ where: { action: 'tickets.export' } });
    expect(log).toMatchObject({ actorId: w.supportA.id, entity: 'Ticket' });
    expect(log.metadata).toMatchObject({ rows: 1, filters: { status: ['OPEN'] } });
  });
});

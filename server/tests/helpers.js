import request from 'supertest';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';
import { outbox } from '../src/lib/mailer.js';

export const PASSWORD = 'Passw0rd!test';
export { prisma, outbox };

export async function resetDb() {
  const rows =
    await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  outbox.length = 0;
}

// Two organisations, three projects, one of each interesting user, and tenant data in every project.
//   orgA: A1, A2        orgB: B1
//   alice (A1+A2), bob (A1)           carol (B1)
//   supportA (A1), supportBoth (A1+A2), supportB (B1)
export async function makeWorld() {
  const passwordHash = await hashPassword(PASSWORD);
  const orgA = await prisma.organization.create({ data: { name: 'Org A' } });
  const orgB = await prisma.organization.create({ data: { name: 'Org B' } });
  const mkProject = (org, key) =>
    prisma.project.create({ data: { organizationId: org.id, name: key, key } });
  const A1 = await mkProject(orgA, 'A-ONE');
  const A2 = await mkProject(orgA, 'A-TWO');
  const B1 = await mkProject(orgB, 'B-ONE');

  const mkUser = (name, role, org, projects) =>
    prisma.user.create({
      data: {
        name,
        role,
        email: `${name.toLowerCase()}@test.dev`,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        organizationId: org?.id ?? null,
        memberships: { create: projects.map((p) => ({ projectId: p.id })) },
      },
    });
  const admin = await mkUser('admin', 'ADMIN', null, []);
  const supportA = await mkUser('supportA', 'SUPPORT', null, [A1]);
  const supportBoth = await mkUser('supportBoth', 'SUPPORT', null, [A1, A2]);
  const supportB = await mkUser('supportB', 'SUPPORT', null, [B1]);
  const alice = await mkUser('alice', 'CUSTOMER', orgA, [A1, A2]);
  const bob = await mkUser('bob', 'CUSTOMER', orgA, [A1]);
  const carol = await mkUser('carol', 'CUSTOMER', orgB, [B1]);

  // Same numbering the real service uses: per-project counter (kept on Project.ticketSeq).
  const mkTicket = async (project, creator, subject) => {
    const { ticketSeq } = await prisma.project.update({
      where: { id: project.id },
      data: { ticketSeq: { increment: 1 } },
    });
    const seq = ticketSeq;
    const t = await prisma.ticket.create({
      data: {
        projectId: project.id,
        createdById: creator.id,
        subject,
        description: subject,
        sequence: seq,
        number: `${project.key}-${String(seq).padStart(4, '0')}`,
      },
    });
    const pub = await prisma.ticketMessage.create({
      data: { ticketId: t.id, authorId: creator.id, body: `public ${subject}`, type: 'PUBLIC' },
    });
    const note = await prisma.ticketMessage.create({
      data: {
        ticketId: t.id,
        authorId: supportBoth.id,
        body: `SECRET note ${subject}`,
        type: 'INTERNAL_NOTE',
      },
    });
    const mkAtt = (messageId, tag) =>
      prisma.attachment.create({
        data: {
          ticketId: t.id,
          messageId,
          filename: `${tag}.pdf`,
          mimeType: 'application/pdf',
          size: 10,
          storedName: `${t.id}-${tag}`,
        },
      });
    return {
      ticket: t,
      pub,
      note,
      pubAttachment: await mkAtt(pub.id, 'pub'),
      noteAttachment: await mkAtt(note.id, 'note'),
    };
  };
  const tA1 = await mkTicket(A1, bob, 'A1 ticket');
  const tA2 = await mkTicket(A2, alice, 'A2 ticket');
  const tB1 = await mkTicket(B1, carol, 'B1 ticket');

  const mkFaq = (projectId, question, status = 'PUBLISHED') =>
    prisma.faqArticle.create({ data: { projectId, question, answer: 'a', status } });
  const faq = {
    A1: await mkFaq(A1.id, 'A1 faq'),
    A1Draft: await mkFaq(A1.id, 'A1 draft', 'DRAFT'),
    A2: await mkFaq(A2.id, 'A2 faq'),
    B1: await mkFaq(B1.id, 'B1 faq'),
    global: await mkFaq(null, 'global faq'),
  };

  return {
    orgA,
    orgB,
    A1,
    A2,
    B1,
    admin,
    supportA,
    supportBoth,
    supportB,
    alice,
    bob,
    carol,
    tA1,
    tA2,
    tB1,
    faq,
  };
}

export const csrf = { 'X-Requested-With': 'SupportDesk' };

export async function login(app, user, password = PASSWORD) {
  const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password });
  return {
    res,
    token: res.body.accessToken,
    cookie: res.headers['set-cookie']?.[0]?.split(';')[0],
  };
}

// Log in AND pick a project; returns an Authorization header ready for supertest .set().
export async function authAs(app, user, projectId) {
  const { token } = await login(app, user);
  if (!projectId) return { Authorization: `Bearer ${token}` };
  const res = await request(app)
    .post('/api/v1/auth/select-project')
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId });
  return { Authorization: `Bearer ${res.body.accessToken}` };
}

export const tokenFromLastMail = () => {
  const mail = outbox[outbox.length - 1];
  return decodeURIComponent(/token=([^\s]+)/.exec(mail.text)[1]);
};

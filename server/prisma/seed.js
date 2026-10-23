// Dev seed. DESTRUCTIVE: wipes every table first. Refuses to run in production.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

const prisma = new PrismaClient();
const DEV_PASSWORD = 'Passw0rd!dev';

const SLA_HOURS = { URGENT: [1, 4], HIGH: [4, 8], MEDIUM: [8, 24], LOW: [24, 72] };
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000);
const hoursFromNow = (h) => new Date(Date.now() + h * 3600_000);

async function wipe() {
  // Children before parents.
  const models = [
    'notification',
    'auditLog',
    'kbSearchLog',
    'feedback',
    'attachment',
    'ticketEvent',
    'ticketMessage',
    'ticket',
    'cannedReply',
    'slaPolicy',
    'faqArticle',
    'faqCategory',
    'category',
    'invitationProject',
    'invitation',
    'authToken',
    'refreshToken',
    'projectMember',
    'project',
    'user',
    'organization',
    'setting',
  ];
  for (const m of models) await prisma[m].deleteMany();
}

// Same pattern the real ticket service will use: bump the per-project counter with one atomic
// UPDATE inside a transaction. The row lock makes concurrent creators queue up, so no duplicates.
async function createTicket(data) {
  const { projectId, createdById, subject, description, status, priority, categoryId, assigneeId } =
    data;
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.update({
      where: { id: projectId },
      data: { ticketSeq: { increment: 1 } },
      select: { key: true, ticketSeq: true },
    });
    const createdAt = data.createdAt ?? new Date();
    return tx.ticket.create({
      data: {
        projectId,
        createdById,
        subject,
        description,
        status,
        priority,
        categoryId,
        assigneeId,
        sequence: project.ticketSeq,
        number: `${project.key}-${String(project.ticketSeq).padStart(4, '0')}`,
        createdAt,
        firstResponseAt: data.firstResponseAt,
        resolvedAt: data.resolvedAt,
        closedAt: data.closedAt,
        // Same targets the SLA service would use (seeded policy), unless a scenario sets them explicitly.
        firstResponseDueAt:
          data.firstResponseDueAt ??
          new Date(createdAt.getTime() + SLA_HOURS[priority][0] * 3600_000),
        resolutionDueAt:
          data.resolutionDueAt ?? new Date(createdAt.getTime() + SLA_HOURS[priority][1] * 3600_000),
        events: { create: [{ type: 'CREATED', actorId: createdById, toValue: 'OPEN', createdAt }] },
        messages: {
          create: [{ authorId: createdById, body: description, type: 'PUBLIC', createdAt }],
        },
      },
    });
  });
}

async function main() {
  await wipe();
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  // ── Organizations & projects
  const acme = await prisma.organization.create({
    data: { name: 'Acme Corp', domain: 'acme.example' },
  });
  const globex = await prisma.organization.create({
    data: { name: 'Globex Inc', domain: 'globex.example' },
  });

  const acmeWeb = await prisma.project.create({
    data: {
      organizationId: acme.id,
      name: 'Acme Website',
      key: 'ACME-WEB',
      description: 'Public marketing site and customer portal.',
    },
  });
  const acmeApp = await prisma.project.create({
    data: {
      organizationId: acme.id,
      name: 'Acme Mobile App',
      key: 'ACME-APP',
      description: 'iOS and Android app.',
    },
  });
  const globexPortal = await prisma.project.create({
    data: {
      organizationId: globex.id,
      name: 'Globex Partner Portal',
      key: 'GLX-PORTAL',
      description: 'B2B partner ordering portal.',
    },
  });

  // ── Users
  const mk = (name, email, role, extra = {}) =>
    prisma.user.create({
      data: {
        name,
        email,
        role,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        ...extra,
      },
    });

  await mk('Ada Admin', 'admin@supportdesk.dev', 'ADMIN');
  const sam = await mk('Sam Support', 'sam@supportdesk.dev', 'SUPPORT');
  const riley = await mk('Riley Support', 'riley@supportdesk.dev', 'SUPPORT');
  const alice = await mk('Alice Acme', 'alice@acme.example', 'CUSTOMER', {
    organizationId: acme.id,
  });
  const bob = await mk('Bob Acme', 'bob@acme.example', 'CUSTOMER', { organizationId: acme.id });
  const carol = await mk('Carol Globex', 'carol@globex.example', 'CUSTOMER', {
    organizationId: globex.id,
  });
  // Awaiting admin approval: lets you exercise the approval flow in Phase 3.
  await mk('Dave Globex', 'dave@globex.example', 'CUSTOMER', {
    organizationId: globex.id,
    status: 'PENDING',
    emailVerifiedAt: null,
  });

  const members = [
    [sam, acmeWeb],
    [sam, acmeApp], // Sam covers Acme only
    [riley, acmeWeb],
    [riley, globexPortal], // Riley overlaps on ACME-WEB, plus Globex
    [alice, acmeWeb],
    [alice, acmeApp], // Alice belongs to TWO projects (project picker)
    [bob, acmeWeb],
    [carol, globexPortal],
  ];
  await prisma.projectMember.createMany({
    data: members.map(([u, p]) => ({ userId: u.id, projectId: p.id })),
  });

  // ── Categories, SLA
  const [bug, question, feature, billing] = await Promise.all(
    ['Bug', 'Question', 'Feature request', 'Billing'].map((name) =>
      prisma.category.create({ data: { name } }),
    ),
  );
  await prisma.slaPolicy.createMany({
    data: [
      { priority: 'URGENT', firstResponseHours: 1, resolutionHours: 4 },
      { priority: 'HIGH', firstResponseHours: 4, resolutionHours: 8 },
      { priority: 'MEDIUM', firstResponseHours: 8, resolutionHours: 24 },
      { priority: 'LOW', firstResponseHours: 24, resolutionHours: 72 },
    ],
  });
  await prisma.setting.createMany({
    data: [
      { key: 'reopenWindowDays', value: 7 },
      { key: 'autoCloseAfterDays', value: 7 },
      { key: 'feedbackEditWindowHours', value: 24 },
    ],
  });
  await prisma.cannedReply.createMany({
    data: [
      {
        title: 'Thanks for reaching out',
        body: 'Hi, thanks for contacting us. We are looking into this and will update you shortly.',
      },
      {
        title: 'Need more info',
        body: 'Could you share screenshots and the steps to reproduce the problem?',
      },
      {
        title: 'Resolved',
        body: 'We have applied a fix. Please let us know if you still see the issue.',
      },
    ],
  });

  // ── FAQs
  const gettingStarted = await prisma.faqCategory.create({
    data: { projectId: acmeWeb.id, name: 'Getting started', sortOrder: 1 },
  });
  const account = await prisma.faqCategory.create({
    data: { projectId: null, name: 'Account & login', sortOrder: 1 },
  });
  const orders = await prisma.faqCategory.create({
    data: { projectId: globexPortal.id, name: 'Orders', sortOrder: 1 },
  });
  await prisma.faqArticle.createMany({
    data: [
      {
        projectId: null,
        categoryId: account.id,
        status: 'PUBLISHED',
        question: 'How do I reset my password?',
        answer: 'Use **Forgot password** on the login page. The link expires after one hour.',
      },
      {
        projectId: null,
        categoryId: account.id,
        status: 'PUBLISHED',
        question: 'How do I switch between projects?',
        answer: 'Use the project dropdown in the page header.',
      },
      {
        projectId: acmeWeb.id,
        categoryId: gettingStarted.id,
        status: 'PUBLISHED',
        question: 'How do I update my billing address on the Acme site?',
        answer: 'Go to **Settings → Billing** and edit the address.',
        helpfulYes: 12,
        helpfulNo: 2,
      },
      {
        projectId: acmeWeb.id,
        categoryId: gettingStarted.id,
        status: 'PUBLISHED',
        question: 'Why is the website loading slowly?',
        answer: 'Clear your cache and try again. If it persists, raise a ticket.',
      },
      {
        projectId: acmeWeb.id,
        categoryId: gettingStarted.id,
        status: 'DRAFT',
        question: 'How do I export my data?',
        answer: 'Draft - to be written.',
      },
      {
        projectId: acmeApp.id,
        status: 'PUBLISHED',
        question: 'Which iOS versions does the Acme app support?',
        answer: 'iOS 16 and newer.',
      },
      {
        projectId: globexPortal.id,
        categoryId: orders.id,
        status: 'PUBLISHED',
        question: 'How do I place a bulk order?',
        answer: 'Upload a CSV under **Orders → Bulk upload**.',
      },
    ],
  });
  // More realistic KB content so search, categories and the markdown renderer are demoable.
  const billingCat = await prisma.faqCategory.create({
    data: { projectId: acmeWeb.id, name: 'Billing & invoices', sortOrder: 2 },
  });
  const troubleCat = await prisma.faqCategory.create({
    data: { projectId: acmeWeb.id, name: 'Troubleshooting', sortOrder: 3 },
  });
  await prisma.faqArticle.createMany({
    data: [
      {
        projectId: acmeWeb.id,
        categoryId: billingCat.id,
        status: 'PUBLISHED',
        question: 'Where can I download my invoices?',
        answer:
          'Open **Settings → Billing → Invoice history** and click the download icon next to an invoice.\n\nIf the PDF is blank, try another browser and [contact us](mailto:support@example.com) if it persists.',
        helpfulYes: 8,
        helpfulNo: 1,
      },
      {
        projectId: acmeWeb.id,
        categoryId: billingCat.id,
        status: 'PUBLISHED',
        question: 'How do I change my payment method?',
        answer:
          '1. Go to **Settings → Billing**\n2. Choose **Payment method**\n3. Enter the new card and save\n\nThe new card is used from the next billing cycle.',
      },
      {
        projectId: acmeWeb.id,
        categoryId: troubleCat.id,
        status: 'PUBLISHED',
        question: 'The checkout page shows an error',
        answer:
          'Most checkout errors are caused by an expired session. Log out, log in again and retry.\n\n> If you see error 500, raise a ticket with the time it happened.',
      },
      {
        projectId: acmeWeb.id,
        categoryId: troubleCat.id,
        status: 'PUBLISHED',
        question: 'Why can I not upload a profile photo?',
        answer:
          'Photos must be **PNG or JPG** and smaller than 3 MB. Resize the image and try again.',
      },
      {
        projectId: acmeApp.id,
        status: 'PUBLISHED',
        question: 'How do I enable push notifications?',
        answer:
          'Open the app, then **Settings → Notifications**, and switch on *Push*. On Android also check the system notification settings.',
      },
    ],
  });

  // A zero-result search, so the admin "missing articles" report has data in Phase 7.
  await prisma.kbSearchLog.create({
    data: {
      projectId: acmeWeb.id,
      userId: alice.id,
      query: 'invoice pdf download',
      resultCount: 0,
      createdTicketAfter: true,
    },
  });

  // ── Tickets: every status, across projects
  await createTicket({
    projectId: acmeWeb.id,
    createdById: alice.id,
    subject: 'Checkout page returns a 500 error',
    description: 'Since this morning the checkout page fails when I press Pay.',
    status: 'OPEN',
    priority: 'URGENT',
    categoryId: bug.id,
    createdAt: hoursAgo(0.5),
    firstResponseDueAt: hoursFromNow(0.5),
    resolutionDueAt: hoursFromNow(3.5),
  });

  const t2 = await createTicket({
    projectId: acmeWeb.id,
    createdById: bob.id,
    subject: 'Cannot upload profile photo',
    description: 'The upload spinner never finishes for PNG files.',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    categoryId: bug.id,
    assigneeId: sam.id,
    createdAt: hoursAgo(6),
    firstResponseAt: hoursAgo(5),
    firstResponseDueAt: hoursFromNow(2),
    resolutionDueAt: hoursFromNow(18),
  });
  await prisma.ticketMessage.create({
    data: {
      ticketId: t2.id,
      authorId: sam.id,
      body: 'Thanks Bob, reproducing now.',
      type: 'PUBLIC',
      createdAt: hoursAgo(5),
    },
  });
  await prisma.ticketMessage.create({
    data: {
      ticketId: t2.id,
      authorId: sam.id,
      body: 'Looks like the image resizer times out on files > 3 MB. Checking logs.',
      type: 'INTERNAL_NOTE',
      createdAt: hoursAgo(4),
    },
  });
  await prisma.ticketEvent.createMany({
    data: [
      {
        ticketId: t2.id,
        actorId: sam.id,
        type: 'ASSIGNED',
        toValue: 'Sam Support',
        createdAt: hoursAgo(5),
      },
      {
        ticketId: t2.id,
        actorId: sam.id,
        type: 'STATUS_CHANGED',
        fromValue: 'OPEN',
        toValue: 'IN_PROGRESS',
        createdAt: hoursAgo(5),
      },
    ],
  });

  const t3 = await createTicket({
    projectId: acmeApp.id,
    createdById: alice.id,
    subject: 'Push notifications stopped on Android',
    description: 'No push notifications since the last update.',
    status: 'WAITING_ON_CUSTOMER',
    priority: 'HIGH',
    categoryId: bug.id,
    assigneeId: sam.id,
    createdAt: hoursAgo(30),
    firstResponseAt: hoursAgo(29),
    firstResponseDueAt: hoursAgo(26),
    resolutionDueAt: hoursFromNow(10),
  });
  await prisma.ticketMessage.create({
    data: {
      ticketId: t3.id,
      authorId: sam.id,
      body: 'Which Android version and device model are you using?',
      type: 'PUBLIC',
      createdAt: hoursAgo(2),
    },
  });
  await prisma.ticket.update({ where: { id: t3.id }, data: { slaPausedAt: hoursAgo(2) } });
  await prisma.ticketEvent.create({
    data: {
      ticketId: t3.id,
      actorId: sam.id,
      type: 'STATUS_CHANGED',
      fromValue: 'IN_PROGRESS',
      toValue: 'WAITING_ON_CUSTOMER',
      createdAt: hoursAgo(2),
    },
  });

  const t4 = await createTicket({
    projectId: globexPortal.id,
    createdById: carol.id,
    subject: 'Bulk order CSV rejected',
    description: 'Our CSV with 500 rows is rejected with "invalid format".',
    status: 'RESOLVED',
    priority: 'HIGH',
    categoryId: question.id,
    assigneeId: riley.id,
    createdAt: hoursAgo(48),
    firstResponseAt: hoursAgo(46),
    resolvedAt: hoursAgo(20),
  });
  await prisma.ticketMessage.create({
    data: {
      ticketId: t4.id,
      authorId: riley.id,
      body: 'The date column must be ISO formatted (YYYY-MM-DD). Updated template attached to the FAQ.',
      type: 'PUBLIC',
      createdAt: hoursAgo(20),
    },
  });
  await prisma.ticketEvent.create({
    data: {
      ticketId: t4.id,
      actorId: riley.id,
      type: 'STATUS_CHANGED',
      fromValue: 'IN_PROGRESS',
      toValue: 'RESOLVED',
      createdAt: hoursAgo(20),
    },
  });

  const t5 = await createTicket({
    projectId: acmeWeb.id,
    createdById: alice.id,
    subject: 'Invoice PDF is blank',
    description: 'Downloaded invoice PDFs are empty.',
    status: 'CLOSED',
    priority: 'LOW',
    categoryId: billing.id,
    assigneeId: riley.id,
    createdAt: hoursAgo(24 * 12),
    firstResponseAt: hoursAgo(24 * 12 - 3),
    resolvedAt: hoursAgo(24 * 10),
    closedAt: hoursAgo(24 * 3),
  });
  await prisma.feedback.create({
    data: {
      ticketId: t5.id,
      rating: 5,
      comment: 'Quick and helpful, thanks!',
      createdById: alice.id,
    },
  });
  await prisma.ticketEvent.create({
    data: {
      ticketId: t5.id,
      actorId: null,
      type: 'STATUS_CHANGED',
      fromValue: 'RESOLVED',
      toValue: 'CLOSED',
      createdAt: hoursAgo(24 * 3),
    },
  });

  const t6 = await createTicket({
    projectId: acmeWeb.id,
    createdById: bob.id,
    subject: 'Search results page is still slow',
    description: 'You marked this resolved but it is still slow in the evenings.',
    status: 'REOPENED',
    priority: 'MEDIUM',
    categoryId: bug.id,
    assigneeId: sam.id,
    createdAt: hoursAgo(24 * 5),
    firstResponseAt: hoursAgo(24 * 5 - 2),
    // reopened tickets have no resolvedAt (the service clears it on reopen)
  });
  await prisma.ticketEvent.create({
    data: {
      ticketId: t6.id,
      actorId: bob.id,
      type: 'REOPENED',
      fromValue: 'RESOLVED',
      toValue: 'REOPENED',
      createdAt: hoursAgo(10),
    },
  });

  await createTicket({
    projectId: acmeApp.id,
    createdById: alice.id,
    subject: 'Request: dark mode',
    description: 'Would love a dark theme in the app.',
    status: 'OPEN',
    priority: 'LOW',
    categoryId: feature.id,
    createdAt: hoursAgo(72),
  });

  // ── Eight weeks of history so the dashboards have something to show (deterministic, no randomness at run time)
  let rng = 42;
  const rnd = () => (rng = (rng * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const projectsMeta = [
    { project: acmeWeb, customers: [alice, bob], staff: [sam, riley], weight: 5 },
    { project: acmeApp, customers: [alice], staff: [sam], weight: 2 },
    { project: globexPortal, customers: [carol], staff: [riley], weight: 3 },
  ];
  const weighted = projectsMeta.flatMap((m) => Array(m.weight).fill(m));
  const subjects = [
    'Cannot log in',
    'Invoice looks wrong',
    'Page loads slowly',
    'Export fails',
    'Need a new user added',
    'Error 500 on save',
    'How do I change my plan?',
    'Notification emails missing',
    'Search returns nothing',
    'Mobile layout broken',
  ];
  for (let i = 0; i < 45; i += 1) {
    const m = pick(weighted);
    const priority = pick(['LOW', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'URGENT']);
    const ageHours = 24 + rnd() * 24 * 56;
    const createdAt = hoursAgo(ageHours);
    const responseH = 0.2 + rnd() * (priority === 'URGENT' ? 3 : 10);
    const resolutionH = 2 + rnd() * (priority === 'URGENT' ? 12 : 50);
    const pausedH = rnd() < 0.3 ? 1 + rnd() * 8 : 0;
    const agent = pick(m.staff);
    const roll = rnd();
    const done = roll < 0.8 && ageHours > resolutionH + pausedH + 1;
    const status = done
      ? roll < 0.65
        ? 'CLOSED'
        : 'RESOLVED'
      : pick(['IN_PROGRESS', 'OPEN', 'WAITING_ON_CUSTOMER']);
    const resolvedAt = done
      ? new Date(createdAt.getTime() + (resolutionH + pausedH) * 3600_000)
      : undefined;
    const t = await createTicket({
      projectId: m.project.id,
      createdById: pick(m.customers).id,
      subject: `${pick(subjects)} (#${i + 1})`,
      description: 'Seeded historical ticket used to populate the dashboards with realistic data.',
      status,
      priority,
      categoryId: pick([bug, bug, question, feature, billing]).id,
      assigneeId: status === 'OPEN' && rnd() < 0.5 ? undefined : agent.id,
      createdAt,
      firstResponseAt:
        status === 'OPEN' ? undefined : new Date(createdAt.getTime() + responseH * 3600_000),
      resolvedAt,
      closedAt:
        status === 'CLOSED'
          ? new Date(
              resolvedAt.getTime() + 7 * 24 * 3600_000 > Date.now()
                ? Date.now()
                : resolvedAt.getTime() + 7 * 24 * 3600_000,
            )
          : undefined,
    });
    if (pausedH)
      await prisma.ticket.update({
        where: { id: t.id },
        data: { slaPausedSeconds: Math.round(pausedH * 3600) },
      });
    if (status === 'WAITING_ON_CUSTOMER')
      await prisma.ticket.update({
        where: { id: t.id },
        data: { slaPausedAt: hoursAgo(1 + rnd() * 5) },
      });
    if (done) {
      await prisma.ticketEvent.create({
        data: {
          ticketId: t.id,
          actorId: agent.id,
          type: 'STATUS_CHANGED',
          fromValue: 'IN_PROGRESS',
          toValue: 'RESOLVED',
          createdAt: resolvedAt,
        },
      });
      if (rnd() < 0.08)
        await prisma.ticketEvent.create({
          data: {
            ticketId: t.id,
            actorId: t.createdById,
            type: 'REOPENED',
            fromValue: 'RESOLVED',
            toValue: 'REOPENED',
            createdAt: new Date(resolvedAt.getTime() + 3600_000),
          },
        });
      if (rnd() < 0.6) {
        const rating = pick([5, 5, 5, 4, 4, 4, 3, 3, 2, 1]);
        await prisma.feedback.create({
          data: {
            ticketId: t.id,
            rating,
            createdById: t.createdById,
            createdAt: new Date(resolvedAt.getTime() + (1 + rnd() * 20) * 3600_000),
          },
        });
      }
    }
  }

  // A few audit entries (real ones are written by the admin screens as you use them).
  await prisma.auditLog.createMany({
    data: [
      {
        actorId: (await prisma.user.findFirst({ where: { role: 'ADMIN' } })).id,
        action: 'organization.create',
        entity: 'Organization',
        entityId: acme.id,
        metadata: { name: 'Acme Corp' },
        createdAt: hoursAgo(24 * 50),
      },
      {
        actorId: (await prisma.user.findFirst({ where: { role: 'ADMIN' } })).id,
        action: 'project.create',
        entity: 'Project',
        entityId: acmeWeb.id,
        metadata: { key: 'ACME-WEB', organizationId: acme.id },
        createdAt: hoursAgo(24 * 49),
      },
      {
        actorId: (await prisma.user.findFirst({ where: { role: 'ADMIN' } })).id,
        action: 'user.create',
        entity: 'User',
        entityId: sam.id,
        metadata: { email: 'sam@supportdesk.dev', role: 'SUPPORT' },
        createdAt: hoursAgo(24 * 48),
      },
      {
        actorId: (await prisma.user.findFirst({ where: { role: 'ADMIN' } })).id,
        action: 'sla.upsert',
        entity: 'SlaPolicy',
        entityId: null,
        metadata: { priority: 'URGENT', firstResponseHours: 1, resolutionHours: 4 },
        createdAt: hoursAgo(24 * 30),
      },
    ],
  });

  console.log('\nSeed complete. All dev accounts use password:', DEV_PASSWORD);
  console.log('  admin@supportdesk.dev   (ADMIN)');
  console.log('  sam@supportdesk.dev     (SUPPORT: ACME-WEB, ACME-APP)');
  console.log('  riley@supportdesk.dev   (SUPPORT: ACME-WEB, GLX-PORTAL)');
  console.log('  alice@acme.example      (CUSTOMER: ACME-WEB + ACME-APP)');
  console.log('  bob@acme.example        (CUSTOMER: ACME-WEB)');
  console.log('  carol@globex.example    (CUSTOMER: GLX-PORTAL)');
  console.log('  dave@globex.example     (CUSTOMER, PENDING approval)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

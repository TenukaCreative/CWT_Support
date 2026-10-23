import { prisma } from '../lib/prisma.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { escapeLike, paginate } from '../lib/pagination.js';
import { canAccessProject } from '../lib/scope.js';
import { computeDueDates, slaPatchForTransition, slaState } from '../lib/sla.js';
import { STATUS_LABELS, allowedTransitions, assertTransition } from '../lib/ticketStateMachine.js';
import { safeFilename } from '../middleware/upload.js';
import { getSetting } from './settings.service.js';
import { getSlaPolicy } from './sla.service.js';
import { markTicketCreated } from './faq.service.js';
import * as notifications from './notification.service.js';

// `ctx` = { db, scope, user }. `db` is ALWAYS the scoped client (req.db): out-of-scope tickets,
// messages, attachments and events are simply invisible, and customers can never read internal
// notes. Business rules (who may do what, state machine, SLA) live here.
//
// Notifications are sent AFTER the transaction commits and never throw (see notification.service).

const isStaff = (u) => u.role !== 'CUSTOMER';
const DAY = 86_400_000;
const HOUR = 3_600_000;

// What a customer may see in the history (assignment / priority churn is internal housekeeping).
const CUSTOMER_EVENTS = ['CREATED', 'STATUS_CHANGED', 'REOPENED', 'MERGED'];

const include = (staff) => ({
  project: { select: { id: true, key: true, name: true } },
  category: { select: { id: true, name: true } },
  createdBy: {
    select: staff
      ? { id: true, name: true, email: true, organization: { select: { id: true, name: true } } }
      : { id: true, name: true },
  },
  assignee: { select: { id: true, name: true } },
  mergedInto: { select: { id: true, number: true } },
});

const presentFeedback = (f, editHours) =>
  f && {
    rating: f.rating,
    comment: f.comment,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    editableUntil: new Date(f.createdAt.getTime() + editHours * HOUR),
  };

async function present(ticket, { user }, feedback = undefined) {
  const staff = isStaff(user);
  const isCreator = ticket.createdById === user.id;
  let allowed = staff
    ? allowedTransitions(ticket.status, user.role)
    : isCreator
      ? allowedTransitions(ticket.status, 'CUSTOMER')
      : [];

  // Customers can only reopen inside the window; staff can always reopen.
  let reopenUntil = null;
  if (!staff && ticket.status === 'RESOLVED' && ticket.resolvedAt) {
    const days = await getSetting('reopenWindowDays');
    reopenUntil = new Date(ticket.resolvedAt.getTime() + days * DAY);
    if (reopenUntil < new Date()) allowed = allowed.filter((s) => s !== 'REOPENED');
  }

  const out = {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    project: ticket.project,
    category: ticket.category,
    createdBy: ticket.createdBy,
    assignee: ticket.assignee,
    mergedInto: ticket.mergedInto,
    firstResponseAt: ticket.firstResponseAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    allowedStatuses: allowed,
    canReply: ticket.status !== 'CLOSED' && (staff || ticket.status !== 'RESOLVED'),
    canAddNote: staff,
    reopenUntil,
    // SLA is an internal measure: staff only. Customers never see due dates or breach flags.
    ...(staff ? { sla: slaState(ticket) } : {}),
  };

  // Feedback is only loaded on the detail view (`feedback !== undefined`).
  if (feedback !== undefined) {
    const editHours = await getSetting('feedbackEditWindowHours');
    const eligible =
      ['RESOLVED', 'CLOSED'].includes(ticket.status) && ticket.resolvedAt && !ticket.mergedIntoId;
    const editable = !feedback || Date.now() <= feedback.createdAt.getTime() + editHours * HOUR;
    out.feedback = staff || isCreator ? presentFeedback(feedback, editHours) : null;
    out.canRate = !staff && isCreator && Boolean(eligible) && editable;
  }
  return out;
}

async function loadTicket(db, id) {
  const ticket = await db.ticket.findUnique({ where: { id } });
  if (!ticket) throw notFound('Ticket not found');
  return ticket;
}

// A category is usable if it is visible to the caller and global or of the ticket's own project.
async function assertCategory(db, categoryId, projectId) {
  if (!categoryId) return null;
  const cat = await db.category.findUnique({ where: { id: categoryId } });
  if (!cat || (cat.projectId !== null && cat.projectId !== projectId)) {
    throw badRequest('Unknown category', [
      { path: 'categoryId', message: 'Choose a category from the list' },
    ]);
  }
  return cat;
}

const attachmentRows = (files, userId, extra = {}) =>
  files.map((f) => ({
    filename: safeFilename(f.originalname),
    mimeType: f.mimetype,
    size: f.size,
    storedName: f.filename,
    uploadedById: userId,
    ...extra,
  }));

const systemMessage = (tx, ticketId, authorId, body) =>
  tx.ticketMessage.create({ data: { ticketId, authorId, body, type: 'SYSTEM' } });

// ───────────── create ─────────────

export async function createTicket(ctx, data, files = []) {
  const { db, scope, user } = ctx;
  if (user.role !== 'CUSTOMER') throw forbidden('Only customers can raise tickets');
  if (scope.projectIds.length !== 1 || !scope.activeProjectId || scope.activeProjectId === 'ALL') {
    throw new AppError(409, 'PROJECT_REQUIRED', 'Select a project first');
  }
  const projectId = scope.activeProjectId;
  await assertCategory(db, data.categoryId, projectId);

  const createdAt = new Date();
  const due = computeDueDates(createdAt, await getSlaPolicy(projectId, data.priority));

  const ticket = await db.$transaction(async (tx) => {
    // Atomic per-project counter: the UPDATE row-locks the project, so concurrent creators
    // queue up and each gets a unique, gap-free sequence number.
    const p = await tx.project.update({
      where: { id: projectId },
      data: { ticketSeq: { increment: 1 } },
      select: { key: true, ticketSeq: true },
    });
    return tx.ticket.create({
      data: {
        projectId,
        createdById: user.id,
        subject: data.subject,
        description: data.description,
        priority: data.priority,
        categoryId: data.categoryId ?? null,
        sequence: p.ticketSeq,
        number: `${p.key}-${String(p.ticketSeq).padStart(4, '0')}`,
        createdAt,
        ...due,
        // Nested writes are safe here: the ticket is created inside the verified project.
        messages: { create: [{ authorId: user.id, body: data.description, type: 'PUBLIC' }] },
        events: { create: [{ actorId: user.id, type: 'CREATED', toValue: 'OPEN' }] },
        attachments: { create: attachmentRows(files, user.id) },
      },
      include: include(false),
    });
  });

  // FAQ deflection analytics: this search ended in a ticket. Best-effort, never blocks creation.
  if (data.searchLogId) await markTicketCreated(db, user, data.searchLogId).catch(() => {});
  await notifications.onTicketCreated(ticket);
  return present(ticket, ctx);
}

// ───────────── list / detail ─────────────

// Shared by the list endpoint and the CSV export, so both always filter identically.
export function buildTicketWhere(user, query) {
  return {
    ...(query.status ? { status: { in: query.status } } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.assigneeId
      ? {
          assigneeId:
            query.assigneeId === 'unassigned'
              ? null
              : query.assigneeId === 'me'
                ? user.id
                : query.assigneeId,
        }
      : {}),
    ...(query.mine ? { createdById: user.id } : {}),
    ...(query.createdFrom || query.createdTo
      ? {
          createdAt: {
            ...(query.createdFrom ? { gte: query.createdFrom } : {}),
            ...(query.createdTo ? { lt: query.createdTo } : {}),
          },
        }
      : {}),
    ...(query.q
      ? {
          OR: [
            { number: { contains: escapeLike(query.q), mode: 'insensitive' } },
            { subject: { contains: escapeLike(query.q), mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

export async function listTickets(ctx, query) {
  const { db, user } = ctx;
  const page = await paginate(
    db.ticket,
    { where: buildTicketWhere(user, query), query, include: include(isStaff(user)) },
    db,
  );
  const items = await Promise.all(page.items.map((t) => present(t, ctx)));
  return { ...page, items };
}

export async function getTicket(ctx, id) {
  const { db, user } = ctx;
  const staff = isStaff(user);
  const ticket = await db.ticket.findUnique({ where: { id }, include: include(staff) });
  if (!ticket) throw notFound('Ticket not found');

  // Related data is read through its own scoped model: that is what keeps internal notes (and
  // files attached to them) away from customers. Nested includes of these are refused for them.
  const [messages, attachments, events, feedback] = await Promise.all([
    db.ticketMessage.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true, role: true } } },
    }),
    db.attachment.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        messageId: true,
        filename: true,
        mimeType: true,
        size: true,
        createdAt: true,
      },
    }),
    db.ticketEvent.findMany({
      where: { ticketId: id, ...(staff ? {} : { type: { in: CUSTOMER_EVENTS } }) },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { id: true, name: true, role: true } } },
    }),
    db.feedback.findUnique({ where: { ticketId: id } }),
  ]);

  const byMessage = new Map();
  for (const a of attachments)
    byMessage.set(a.messageId, [...(byMessage.get(a.messageId) ?? []), a]);
  const thread = messages.map((m, i) => ({
    ...m,
    // Files attached while creating the ticket belong to the opening message.
    attachments: [...(byMessage.get(m.id) ?? []), ...(i === 0 ? (byMessage.get(null) ?? []) : [])],
  }));

  return { ticket: await present(ticket, ctx, feedback), messages: thread, events };
}

// ───────────── conversation ─────────────

export async function addMessage(ctx, id, { body, type }, files = []) {
  const { db, user } = ctx;
  const staff = isStaff(user);
  const ticket = await loadTicket(db, id);

  if (type === 'INTERNAL_NOTE' && !staff) throw forbidden('Customers cannot add internal notes');
  if (type === 'PUBLIC') {
    if (ticket.status === 'CLOSED')
      throw new AppError(409, 'TICKET_CLOSED', 'This ticket is closed');
    if (!staff && ticket.status === 'RESOLVED')
      throw new AppError(409, 'TICKET_RESOLVED', 'Reopen the ticket to reply');
  }

  // Side effects of a public reply, all through the state machine as the SYSTEM actor:
  //  - customer answers a ticket waiting on them -> IN_PROGRESS (and the SLA clock resumes)
  //  - staff starts working on an OPEN/REOPENED ticket -> IN_PROGRESS
  let nextStatus = null;
  if (type === 'PUBLIC') {
    if (!staff && ticket.status === 'WAITING_ON_CUSTOMER') nextStatus = 'IN_PROGRESS';
    if (staff && (ticket.status === 'OPEN' || ticket.status === 'REOPENED'))
      nextStatus = 'IN_PROGRESS';
    if (nextStatus) assertTransition(ticket.status, nextStatus, 'SYSTEM');
  }

  const now = new Date();
  const message = await db.$transaction(async (tx) => {
    const msg = await tx.ticketMessage.create({
      data: { ticketId: id, authorId: user.id, body, type },
    });
    if (files.length)
      await tx.attachment.createMany({
        data: attachmentRows(files, user.id, { ticketId: id, messageId: msg.id }),
      });

    await tx.ticket.update({
      where: { id },
      data: {
        updatedAt: now,
        ...(nextStatus
          ? { status: nextStatus, ...slaPatchForTransition(ticket, nextStatus, now) }
          : {}),
        // First public answer from staff = first response (SLA metric).
        ...(type === 'PUBLIC' && staff && !ticket.firstResponseAt ? { firstResponseAt: now } : {}),
      },
    });
    if (nextStatus) {
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          type: 'STATUS_CHANGED',
          fromValue: ticket.status,
          toValue: nextStatus,
        },
      });
      await systemMessage(
        tx,
        id,
        user.id,
        `Status changed from ${STATUS_LABELS[ticket.status]} to ${STATUS_LABELS[nextStatus]}`,
      );
    }
    return msg;
  });

  // Public replies notify the other party. Internal notes notify nobody, ever.
  if (type === 'PUBLIC') await notifications.onPublicReply(ticket, user, body);

  const attachments = await db.attachment.findMany({
    where: { messageId: message.id },
    select: {
      id: true,
      messageId: true,
      filename: true,
      mimeType: true,
      size: true,
      createdAt: true,
    },
  });
  return { ...message, author: { id: user.id, name: user.name, role: user.role }, attachments };
}

// ───────────── status / details / assignment ─────────────

export async function changeStatus(ctx, id, { status: to }) {
  const { db, user } = ctx;
  const staff = isStaff(user);
  const ticket = await loadTicket(db, id);

  if (!staff && ticket.createdById !== user.id)
    throw forbidden('Only the person who raised this ticket can change its status');
  assertTransition(ticket.status, to, user.role);

  if (!staff && to === 'REOPENED') {
    const days = await getSetting('reopenWindowDays');
    if (!ticket.resolvedAt || ticket.resolvedAt.getTime() + days * DAY < Date.now()) {
      throw new AppError(
        409,
        'REOPEN_WINDOW_EXPIRED',
        `Tickets can only be reopened within ${days} days of being resolved. Please create a new ticket.`,
      );
    }
  }

  const now = new Date();
  const data = {
    status: to,
    ...(to === 'RESOLVED' ? { resolvedAt: now } : {}),
    ...(to === 'CLOSED' ? { closedAt: now } : {}),
    ...(to === 'REOPENED' ? { resolvedAt: null, closedAt: null } : {}),
    // WAITING_ON_CUSTOMER pauses the SLA clock; leaving it resumes and extends the due dates.
    ...slaPatchForTransition(ticket, to, now),
  };
  const text =
    to === 'REOPENED' && !staff
      ? 'Ticket reopened by the customer'
      : `Status changed from ${STATUS_LABELS[ticket.status]} to ${STATUS_LABELS[to]}`;

  await db.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id }, data });
    await tx.ticketEvent.create({
      data: {
        ticketId: id,
        actorId: user.id,
        type: to === 'REOPENED' ? 'REOPENED' : 'STATUS_CHANGED',
        fromValue: ticket.status,
        toValue: to,
      },
    });
    await systemMessage(tx, id, user.id, text);
  });
  await notifications.onStatusChanged(ticket, user, to);
  return (await getTicket(ctx, id)).ticket;
}

export async function updateDetails(ctx, id, data) {
  const { db, user } = ctx;
  const ticket = await db.ticket.findUnique({
    where: { id },
    include: { category: { select: { name: true } } },
  });
  if (!ticket) throw notFound('Ticket not found');

  const events = [];
  const update = {};
  if (data.priority && data.priority !== ticket.priority) {
    update.priority = data.priority;
    // New priority = new SLA targets, measured from when the ticket was created (+ time already paused).
    Object.assign(
      update,
      computeDueDates(
        ticket.createdAt,
        await getSlaPolicy(ticket.projectId, data.priority),
        ticket.slaPausedSeconds,
      ),
      { slaWarnedAt: null, slaBreachedAt: null },
    );
    events.push({ type: 'PRIORITY_CHANGED', fromValue: ticket.priority, toValue: data.priority });
  }
  if (data.categoryId !== undefined && data.categoryId !== ticket.categoryId) {
    const cat = await assertCategory(db, data.categoryId, ticket.projectId);
    update.categoryId = data.categoryId;
    events.push({
      type: 'CATEGORY_CHANGED',
      fromValue: ticket.category?.name ?? null,
      toValue: cat?.name ?? null,
    });
  }
  if (events.length) {
    await db.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id }, data: update });
      await tx.ticketEvent.createMany({
        data: events.map((e) => ({ ...e, ticketId: id, actorId: user.id })),
      });
    });
  }
  return (await getTicket(ctx, id)).ticket;
}

// Staff (support assigned to the ticket's project, or any admin) can take tickets.
async function assertAssignable(assigneeId, projectId) {
  const u = await prisma.user.findUnique({
    where: { id: assigneeId },
    include: { memberships: { where: { projectId } } },
  });
  const ok =
    u &&
    u.status === 'ACTIVE' &&
    (u.role === 'ADMIN' || (u.role === 'SUPPORT' && u.memberships.length > 0));
  if (!ok)
    throw badRequest('That person cannot be assigned to this ticket', [
      { path: 'assigneeId', message: 'Not assignable' },
    ]);
  return u;
}

export async function assign(ctx, id, { assigneeId }) {
  const { db, user } = ctx;
  const ticket = await db.ticket.findUnique({
    where: { id },
    include: { assignee: { select: { name: true } } },
  });
  if (!ticket) throw notFound('Ticket not found');
  if (ticket.status === 'CLOSED')
    throw new AppError(409, 'TICKET_CLOSED', 'Closed tickets cannot be reassigned');

  const target = assigneeId ? await assertAssignable(assigneeId, ticket.projectId) : null;
  if ((ticket.assigneeId ?? null) !== (assigneeId ?? null)) {
    await db.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id }, data: { assigneeId: assigneeId ?? null } });
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          type: 'ASSIGNED',
          fromValue: ticket.assignee?.name ?? null,
          toValue: target?.name ?? null,
        },
      });
    });
    if (assigneeId) await notifications.onAssigned(ticket, user.id, assigneeId);
  }
  return (await getTicket(ctx, id)).ticket;
}

// All-or-nothing: if any ticket is out of scope (or the assignee does not fit one of the
// projects) nothing changes.
export async function bulkAssign(ctx, { ticketIds, assigneeId }) {
  const { db, user } = ctx;
  const ids = [...new Set(ticketIds)];
  const tickets = await db.ticket.findMany({
    where: { id: { in: ids } },
    include: { assignee: { select: { name: true } } },
  });
  if (tickets.length !== ids.length) throw notFound('Ticket not found');
  if (tickets.some((t) => t.status === 'CLOSED'))
    throw new AppError(409, 'TICKET_CLOSED', 'Closed tickets cannot be reassigned');

  let target = null;
  if (assigneeId) {
    for (const projectId of new Set(tickets.map((t) => t.projectId)))
      target = await assertAssignable(assigneeId, projectId);
  }
  const changing = tickets.filter((t) => (t.assigneeId ?? null) !== (assigneeId ?? null));
  await db.$transaction(async (tx) => {
    for (const t of changing) {
      await tx.ticket.update({ where: { id: t.id }, data: { assigneeId: assigneeId ?? null } });
      await tx.ticketEvent.create({
        data: {
          ticketId: t.id,
          actorId: user.id,
          type: 'ASSIGNED',
          fromValue: t.assignee?.name ?? null,
          toValue: target?.name ?? null,
        },
      });
    }
  });
  await notifications.onBulkAssigned(changing, user.id, assigneeId);
  return { updated: changing.length };
}

export async function mergeTicket(ctx, id, { targetTicketId }) {
  const { db, user } = ctx;
  if (id === targetTicketId) throw badRequest('A ticket cannot be merged into itself');
  const [source, target] = await Promise.all([
    loadTicket(db, id),
    db.ticket.findUnique({ where: { id: targetTicketId } }),
  ]);
  if (!target) throw notFound('Ticket not found');

  if (source.projectId !== target.projectId)
    throw badRequest('Tickets can only be merged within the same project');
  if (source.status === 'CLOSED' || source.mergedIntoId)
    throw new AppError(409, 'INVALID_TRANSITION', 'This ticket is already closed or merged');
  if (target.status === 'CLOSED' || target.mergedIntoId)
    throw new AppError(409, 'INVALID_TRANSITION', 'The target ticket is closed or merged');
  assertTransition(source.status, 'CLOSED', 'SYSTEM');

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id },
      data: {
        mergedIntoId: target.id,
        status: 'CLOSED',
        closedAt: now,
        ...slaPatchForTransition(source, 'CLOSED', now),
      },
    });
    await tx.ticketEvent.create({
      data: {
        ticketId: id,
        actorId: user.id,
        type: 'MERGED',
        fromValue: source.status,
        toValue: target.number,
      },
    });
    await tx.ticketEvent.create({
      data: { ticketId: target.id, actorId: user.id, type: 'MERGED', fromValue: source.number },
    });
    await systemMessage(
      tx,
      id,
      user.id,
      `This ticket was merged into ${target.number}. Please continue the conversation there.`,
    );
    await systemMessage(
      tx,
      target.id,
      user.id,
      `Ticket ${source.number} was merged into this ticket.`,
    );
  });
  await notifications.onMerged(source, target, user);
  return (await getTicket(ctx, id)).ticket;
}

// ───────────── feedback ─────────────

// One rating per ticket, by the person who raised it, once the ticket is resolved. It can be
// edited for a short window (setting), then it is locked.
export async function submitFeedback(ctx, id, { rating, comment }) {
  const { db, user } = ctx;
  const ticket = await loadTicket(db, id);
  if (user.role !== 'CUSTOMER' || ticket.createdById !== user.id)
    throw forbidden('Only the person who raised this ticket can rate it');
  if (
    !['RESOLVED', 'CLOSED'].includes(ticket.status) ||
    !ticket.resolvedAt ||
    ticket.mergedIntoId
  ) {
    throw new AppError(
      409,
      'FEEDBACK_NOT_AVAILABLE',
      'You can rate a ticket once it has been resolved',
    );
  }

  const editHours = await getSetting('feedbackEditWindowHours');
  const existing = await db.feedback.findUnique({ where: { ticketId: id } });
  const cleanComment = comment?.trim() ? comment.trim() : null;
  let row;
  if (existing) {
    if (Date.now() > existing.createdAt.getTime() + editHours * HOUR) {
      throw new AppError(
        409,
        'FEEDBACK_LOCKED',
        `Ratings can only be changed within ${editHours} hours`,
      );
    }
    row = await db.feedback.update({
      where: { ticketId: id },
      data: { rating, comment: cleanComment },
    });
  } else {
    row = await db.feedback.create({
      data: { ticketId: id, rating, comment: cleanComment, createdById: user.id },
    });
  }
  return presentFeedback(row, editHours);
}

// ───────────── helpers for forms ─────────────

export async function listAssignees({ scope }, projectIdParam) {
  const projectId = projectIdParam ?? scope.activeProjectId;
  if (!projectId || projectId === 'ALL') throw badRequest('projectId is required');
  if (!canAccessProject(scope, projectId)) throw notFound('Project not found');
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ role: 'ADMIN' }, { role: 'SUPPORT', memberships: { some: { projectId } } }],
    },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
  return { assignees: users };
}

export const listCategories = async (db) => ({
  categories: await db.category.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, projectId: true },
  }),
});

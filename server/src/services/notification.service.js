import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { sendMail } from '../lib/mailer.js';
import { notFound } from '../lib/errors.js';
import { paginate } from '../lib/pagination.js';

// In-app + email notifications. Design rules:
//  - nobody is notified about their own action
//  - internal notes NEVER notify anyone (there is simply no call for them)
//  - per-user preferences decide email vs in-app independently
//  - delivery problems are logged, never thrown: a failed email must not fail a ticket update
export const DEFAULT_PREFS = {
  emailOnReply: true,
  emailOnStatusChange: true,
  emailOnAssignment: true,
  inApp: true,
};

const ticketLink = (id, query = '') => `${env.CLIENT_URL}/app/tickets/${id}${query}`;
const snippet = (text, n = 300) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

// emailKind: a preference key, or 'always' for transactional mail (confirmations, SLA alerts).
async function notify({
  recipients,
  exclude,
  type,
  ticket,
  title,
  body,
  emailKind,
  linkQuery = '',
}) {
  try {
    const ids = [...new Set(recipients.filter((id) => id && id !== exclude))];
    if (ids.length === 0) return;
    const users = await prisma.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' } });

    const inApp = [];
    for (const u of users) {
      const prefs = { ...DEFAULT_PREFS, ...(u.notificationPrefs ?? {}) };
      if (prefs.inApp) inApp.push({ userId: u.id, type, title, body, ticketId: ticket.id });
      if (emailKind === 'always' || prefs[emailKind]) {
        await sendMail({
          to: u.email,
          subject: `[${ticket.number}] ${title}`,
          text: `Hi ${u.name},\n\n${title}\n\n${body}\n\nOpen the ticket: ${ticketLink(ticket.id, linkQuery)}\n\nYou can change what you are notified about in your profile settings.`,
        });
      }
    }
    if (inApp.length) await prisma.notification.createMany({ data: inApp });
  } catch (err) {
    logger.error({ err, type, ticketId: ticket?.id }, 'Notification failed');
  }
}

export const onTicketCreated = (ticket) =>
  notify({
    recipients: [ticket.createdById],
    type: 'TICKET_CREATED',
    ticket,
    emailKind: 'always',
    title: `We received your ticket ${ticket.number}`,
    body: `"${ticket.subject}"\n\nOur team will get back to you soon. You can follow progress and reply at any time.`,
  });

export const onAssigned = (ticket, actorId, assigneeId) =>
  notify({
    recipients: [assigneeId],
    exclude: actorId,
    type: 'TICKET_ASSIGNED',
    ticket,
    emailKind: 'emailOnAssignment',
    title: `Ticket ${ticket.number} was assigned to you`,
    body: `"${ticket.subject}"`,
  });

// One email (not one per ticket) when many tickets are assigned at once.
export async function onBulkAssigned(tickets, actorId, assigneeId) {
  try {
    if (!assigneeId || assigneeId === actorId || tickets.length === 0) return;
    const u = await prisma.user.findUnique({ where: { id: assigneeId } });
    if (!u || u.status !== 'ACTIVE') return;
    const prefs = { ...DEFAULT_PREFS, ...(u.notificationPrefs ?? {}) };
    if (prefs.inApp) {
      await prisma.notification.createMany({
        data: tickets.map((t) => ({
          userId: u.id,
          type: 'TICKET_ASSIGNED',
          title: `Ticket ${t.number} was assigned to you`,
          body: `"${t.subject}"`,
          ticketId: t.id,
        })),
      });
    }
    if (prefs.emailOnAssignment) {
      const list = tickets
        .slice(0, 20)
        .map((t) => `- ${t.number}: ${t.subject}`)
        .join('\n');
      await sendMail({
        to: u.email,
        subject: `${tickets.length} tickets were assigned to you`,
        text: `Hi ${u.name},\n\n${tickets.length} tickets were assigned to you:\n\n${list}${tickets.length > 20 ? '\n…' : ''}\n\nOpen your queue: ${env.CLIENT_URL}/app/assigned`,
      });
    }
  } catch (err) {
    logger.error({ err }, 'Bulk assignment notification failed');
  }
}

// A public reply goes to the other side of the conversation.
export const onPublicReply = (ticket, actor, body) =>
  notify({
    recipients: actor.role === 'CUSTOMER' ? [ticket.assigneeId] : [ticket.createdById],
    exclude: actor.id,
    type: 'TICKET_REPLY',
    ticket,
    emailKind: 'emailOnReply',
    title: `New reply from ${actor.name} on ${ticket.number}`,
    body: snippet(body),
  });

const STATUS_TEXT = {
  IN_PROGRESS: 'is now in progress',
  WAITING_ON_CUSTOMER: 'is waiting for your reply',
  REOPENED: 'was reopened',
  CLOSED: 'was closed',
};

export function onStatusChanged(ticket, actor, to) {
  const staff = actor.role !== 'CUSTOMER';
  const recipients = staff ? [ticket.createdById] : [ticket.assigneeId];
  if (to === 'RESOLVED') {
    return notify({
      recipients,
      exclude: actor.id,
      type: 'TICKET_RESOLVED',
      ticket,
      emailKind: 'emailOnStatusChange',
      linkQuery: '?rate=1',
      title: `Ticket ${ticket.number} was resolved`,
      body: `"${ticket.subject}" has been marked resolved.\n\nHow did we do? Please rate the support you received. If the problem is not fixed you can reopen the ticket.`,
    });
  }
  return notify({
    recipients,
    exclude: actor.id,
    type: 'TICKET_STATUS_CHANGED',
    ticket,
    emailKind: 'emailOnStatusChange',
    title: `Ticket ${ticket.number} ${STATUS_TEXT[to] ?? `changed to ${to}`}`,
    body: `"${ticket.subject}"`,
  });
}

export const onMerged = (source, target, actor) =>
  notify({
    recipients: [source.createdById],
    exclude: actor.id,
    type: 'TICKET_STATUS_CHANGED',
    ticket: source,
    emailKind: 'emailOnStatusChange',
    title: `Ticket ${source.number} was merged into ${target.number}`,
    body: `"${source.subject}" duplicated an existing ticket, so we combined them. Please continue the conversation on ${target.number}.`,
  });

export const onAutoClosed = (ticket, days) =>
  notify({
    recipients: [ticket.createdById],
    type: 'TICKET_STATUS_CHANGED',
    ticket,
    emailKind: 'emailOnStatusChange',
    title: `Ticket ${ticket.number} was closed`,
    body: `"${ticket.subject}" was closed automatically after ${days} days without a reply.`,
  });

export const onSla = (ticket, recipients, kind, clockName) =>
  notify({
    recipients,
    type: kind === 'BREACHED' ? 'SLA_BREACHED' : 'SLA_WARNING',
    ticket,
    emailKind: 'always',
    title: kind === 'BREACHED' ? `SLA breached: ${ticket.number}` : `SLA at risk: ${ticket.number}`,
    body: `${clockName === 'firstResponse' ? 'First response' : 'Resolution'} target ${kind === 'BREACHED' ? 'has been missed' : 'is almost up'} for "${ticket.subject}".`,
  });

// ───────────── in-app API (always the caller's own notifications; scoped by userId) ─────────────

const withTicket = { ticket: { select: { id: true, number: true, projectId: true } } };

export async function listNotifications(db, query) {
  return paginate(
    db.notification,
    { where: query.unread ? { readAt: null } : {}, query, include: withTicket },
    db,
  );
}

export const unreadCount = async (db) => ({
  unread: await db.notification.count({ where: { readAt: null } }),
});

export async function markRead(db, id) {
  const { count } = await db.notification.updateMany({
    where: { id },
    data: { readAt: new Date() },
  });
  if (count === 0) throw notFound('Notification not found');
}

export const markAllRead = async (db) => ({
  updated: (
    await db.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } })
  ).count,
});

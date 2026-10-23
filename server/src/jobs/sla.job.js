import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { slaState } from '../lib/sla.js';
import { onSla } from '../services/notification.service.js';

// Flags tickets whose SLA clocks are close to / past their target, once per ticket per kind.
// Only tickets whose clock is actually running are looked at: WAITING_ON_CUSTOMER is paused and
// RESOLVED/CLOSED are finished (state machine + lib/sla.js decide the exact state).
//
// "Flag + notify", no auto-reassignment (v1). Idempotent and safe with several instances: the
// flag is claimed with a conditional UPDATE, and only the instance that wins sends notifications.
const RUNNING = ['OPEN', 'IN_PROGRESS', 'REOPENED'];

async function recipientsFor(ticket, kind) {
  const ids = new Set();
  if (ticket.assigneeId) ids.add(ticket.assigneeId);
  // Nobody owns it yet: alert the people who could (project support).
  if (!ticket.assigneeId) {
    const support = await prisma.projectMember.findMany({
      where: { projectId: ticket.projectId, user: { role: 'SUPPORT', status: 'ACTIVE' } },
      select: { userId: true },
    });
    support.forEach((m) => ids.add(m.userId));
  }
  // A breach is an admin concern too.
  if (kind === 'BREACHED') {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    admins.forEach((a) => ids.add(a.id));
  }
  return [...ids];
}

export async function runSlaCheck(now = new Date()) {
  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: RUNNING },
      mergedIntoId: null,
      slaBreachedAt: null, // once breached there is nothing further to flag
      OR: [{ firstResponseDueAt: { not: null } }, { resolutionDueAt: { not: null } }],
    },
  });

  let warned = 0;
  let breached = 0;
  for (const ticket of tickets) {
    const sla = slaState(ticket, now);
    const worst =
      [
        ['firstResponse', sla.firstResponse],
        ['resolution', sla.resolution],
      ].find(([, c]) => c.state === 'BREACHED') ??
      [
        ['firstResponse', sla.firstResponse],
        ['resolution', sla.resolution],
      ].find(([, c]) => c.state === 'WARNING');
    if (!worst) continue;
    const [clockName, c] = worst;

    if (c.state === 'BREACHED') {
      const claimed = await prisma.ticket.updateMany({
        where: { id: ticket.id, slaBreachedAt: null },
        data: { slaBreachedAt: now },
      });
      if (claimed.count !== 1) continue;
      await prisma.ticketEvent.create({
        data: { ticketId: ticket.id, type: 'SLA_BREACHED', toValue: clockName },
      });
      await onSla(ticket, await recipientsFor(ticket, 'BREACHED'), 'BREACHED', clockName);
      breached += 1;
    } else if (!ticket.slaWarnedAt) {
      const claimed = await prisma.ticket.updateMany({
        where: { id: ticket.id, slaWarnedAt: null },
        data: { slaWarnedAt: now },
      });
      if (claimed.count !== 1) continue;
      await prisma.ticketEvent.create({
        data: { ticketId: ticket.id, type: 'SLA_WARNING', toValue: clockName },
      });
      await onSla(ticket, await recipientsFor(ticket, 'WARNING'), 'WARNING', clockName);
      warned += 1;
    }
  }
  if (warned || breached) logger.info({ warned, breached }, 'SLA check flagged tickets');
  return { checked: tickets.length, warned, breached };
}

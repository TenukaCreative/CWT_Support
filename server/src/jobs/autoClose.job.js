import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { assertTransition } from '../lib/ticketStateMachine.js';
import { getSetting } from '../services/settings.service.js';
import { onAutoClosed } from '../services/notification.service.js';

// RESOLVED tickets nobody reopened are closed after `autoCloseAfterDays` (setting, default 7).
// Goes through the state machine as the SYSTEM actor; writes the same event + system message a
// manual close would (no actor, no author).
export async function runAutoClose(now = new Date()) {
  const days = await getSetting('autoCloseAfterDays');
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const candidates = await prisma.ticket.findMany({
    where: { status: 'RESOLVED', mergedIntoId: null, resolvedAt: { lt: cutoff } },
  });

  let closed = 0;
  for (const ticket of candidates) {
    assertTransition(ticket.status, 'CLOSED', 'SYSTEM');
    const done = await prisma.$transaction(async (tx) => {
      // Claim: if a customer reopened it a moment ago (or another instance got here first), skip.
      const claimed = await tx.ticket.updateMany({
        where: { id: ticket.id, status: 'RESOLVED' },
        data: { status: 'CLOSED', closedAt: now },
      });
      if (claimed.count !== 1) return false;
      await tx.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          type: 'STATUS_CHANGED',
          fromValue: 'RESOLVED',
          toValue: 'CLOSED',
        },
      });
      await tx.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          type: 'SYSTEM',
          body: `Automatically closed after ${days} days without a reply`,
        },
      });
      return true;
    });
    if (done) {
      closed += 1;
      await onAutoClosed(ticket, days);
    }
  }
  if (closed) logger.info({ closed }, 'Auto-closed resolved tickets');
  return { closed };
}

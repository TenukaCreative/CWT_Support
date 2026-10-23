import { prisma } from '../lib/prisma.js';
import { escapeLike, paginate } from '../lib/pagination.js';

// Read-only view of the audit trail. There is deliberately no update/delete anywhere.
export async function listAuditLogs(query) {
  const created = {
    ...(query.from ? { gte: query.from } : {}),
    ...(query.to ? { lt: query.to } : {}),
  };
  const where = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.action ? { action: { startsWith: query.action } } : {}), // "user." matches every user.* action
    ...(query.entity ? { entity: query.entity } : {}),
    ...(Object.keys(created).length ? { createdAt: created } : {}),
    ...(query.q
      ? {
          OR: [
            { action: { contains: escapeLike(query.q), mode: 'insensitive' } },
            { entity: { contains: escapeLike(query.q), mode: 'insensitive' } },
            { entityId: query.q },
          ],
        }
      : {}),
  };
  return paginate(prisma.auditLog, {
    where,
    query,
    include: { actor: { select: { id: true, name: true, email: true, role: true } } },
  });
}

// Options for the filter dropdowns.
export async function auditFilters() {
  const [actions, entities, actors] = await Promise.all([
    prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    }),
    prisma.auditLog.findMany({
      distinct: ['entity'],
      select: { entity: true },
      orderBy: { entity: 'asc' },
    }),
    prisma.user.findMany({
      where: { auditLogs: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return { actions: actions.map((a) => a.action), entities: entities.map((e) => e.entity), actors };
}

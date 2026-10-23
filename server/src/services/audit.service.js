import { prisma } from '../lib/prisma.js';

// Append-only record of admin/security-relevant actions. Accepts an optional transaction client.
export const audit = (actorId, action, entity, entityId, metadata, db = prisma) =>
  db.auditLog.create({ data: { actorId, action, entity, entityId, metadata } });

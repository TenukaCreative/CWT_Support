import { prisma } from '../lib/prisma.js';
import { DEFAULT_SLA } from '../lib/sla.js';

// A project override beats the global policy, which beats the built-in defaults.
export async function getSlaPolicy(projectId, priority) {
  const rows = await prisma.slaPolicy.findMany({
    where: { priority, OR: [{ projectId }, { projectId: null }] },
  });
  return (
    rows.find((r) => r.projectId === projectId) ??
    rows.find((r) => r.projectId === null) ??
    DEFAULT_SLA[priority]
  );
}

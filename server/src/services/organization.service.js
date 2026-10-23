import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import { paginate, searchWhere } from '../lib/pagination.js';
import { audit } from './audit.service.js';

const withCounts = { _count: { select: { projects: true, users: true } } };

export function listOrganizations(query) {
  const where = {
    ...searchWhere(query.q, ['name', 'domain']),
    ...(query.status ? { status: query.status } : {}),
  };
  return paginate(prisma.organization, { where, query, include: withCounts });
}

export async function getOrganization(id) {
  const org = await prisma.organization.findUnique({ where: { id }, include: withCounts });
  if (!org) throw notFound('Organization not found');
  return org;
}

export async function createOrganization(actor, data) {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data });
    await audit(actor.id, 'organization.create', 'Organization', org.id, data, tx);
    return org;
  });
}

export async function updateOrganization(actor, id, data) {
  const existing = await getOrganization(id);
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({ where: { id }, data });
    // An archived client keeps its history but must not keep working projects.
    let archivedProjects = 0;
    if (data.status === 'ARCHIVED' && existing.status === 'ACTIVE') {
      ({ count: archivedProjects } = await tx.project.updateMany({
        where: { organizationId: id, status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      }));
    }
    await audit(
      actor.id,
      'organization.update',
      'Organization',
      id,
      { changes: data, archivedProjects },
      tx,
    );
    return org;
  });
}

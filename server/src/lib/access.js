import { prisma } from './prisma.js';

const projectSelect = {
  id: true,
  name: true,
  key: true,
  description: true,
  organization: { select: { id: true, name: true } },
};

// Projects the user may select. Customers: member projects of their OWN organisation (the org
// check is defence in depth on top of membership). Support: assigned projects. Admin: all.
export async function getAccessibleProjects(user) {
  const where = { status: 'ACTIVE' };
  if (user.role !== 'ADMIN') where.members = { some: { userId: user.id } };
  if (user.role === 'CUSTOMER') where.organizationId = user.organizationId ?? '__none__';
  return prisma.project.findMany({ where, select: projectSelect, orderBy: { name: 'asc' } });
}

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  organizationId: u.organizationId,
  organization: u.organization ? { id: u.organization.id, name: u.organization.name } : null,
  notificationPrefs: u.notificationPrefs ?? null,
});

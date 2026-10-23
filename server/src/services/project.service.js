import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { paginate, searchWhere } from '../lib/pagination.js';
import { audit } from './audit.service.js';

const listInclude = {
  organization: { select: { id: true, name: true } },
  _count: { select: { members: true, tickets: true } },
};

export function listProjects(query) {
  const where = {
    ...searchWhere(query.q, ['name', 'key']),
    ...(query.status ? { status: query.status } : {}),
    ...(query.organizationId ? { organizationId: query.organizationId } : {}),
  };
  return paginate(prisma.project, { where, query, include: listInclude });
}

export async function getProject(id) {
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, name: true, status: true } },
      members: {
        include: {
          user: { select: { id: true, name: true, email: true, role: true, status: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!project) throw notFound('Project not found');
  const { members, ...rest } = project;
  return { ...rest, members: members.map((m) => ({ ...m.user, addedAt: m.createdAt })) };
}

export async function createProject(actor, data) {
  const org = await prisma.organization.findUnique({ where: { id: data.organizationId } });
  if (!org || org.status !== 'ACTIVE')
    throw badRequest('Organization not found or archived', [
      { path: 'organizationId', message: 'Choose an active organization' },
    ]);
  if (await prisma.project.findUnique({ where: { key: data.key } })) {
    throw conflict('This project key is already in use', [
      { path: 'key', message: 'Already in use' },
    ]);
  }
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({ data });
    await audit(
      actor.id,
      'project.create',
      'Project',
      project.id,
      { key: data.key, organizationId: data.organizationId },
      tx,
    );
    return project;
  });
}

export async function updateProject(actor, id, data) {
  const existing = await getProject(id);
  if (data.status === 'ACTIVE' && existing.organization.status !== 'ACTIVE') {
    throw conflict('Reactivate the organization first');
  }
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.update({ where: { id }, data });
    await audit(actor.id, 'project.update', 'Project', id, { changes: data }, tx);
    return project;
  });
}

// ───────────── membership ─────────────
// Rules, enforced for BOTH directions (add from a project / set from a user):
//  - only SUPPORT and CUSTOMER users have memberships (admins implicitly see everything)
//  - a CUSTOMER may only join projects of their own organization
// This is the data the scoping layer trusts, so it is validated on write.
export function assertCanJoin(user, project) {
  if (user.role === 'ADMIN') throw badRequest('Admins already have access to every project');
  if (user.role === 'CUSTOMER' && user.organizationId !== project.organizationId) {
    throw badRequest(`${user.name} belongs to a different organization than this project`);
  }
}

export async function addMembers(actor, projectId, userIds) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound('Project not found');
  if (project.status !== 'ACTIVE') throw conflict('Project is archived');

  const ids = [...new Set(userIds)];
  const users = await prisma.user.findMany({ where: { id: { in: ids } } });
  if (users.length !== ids.length) throw badRequest('One or more users do not exist');
  users.forEach((u) => assertCanJoin(u, project));

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.createMany({
      data: ids.map((userId) => ({ userId, projectId })),
      skipDuplicates: true,
    });
    await audit(actor.id, 'project.members.add', 'Project', projectId, { userIds: ids }, tx);
  });
  return getProject(projectId);
}

export async function removeMember(actor, projectId, userId) {
  const { count } = await prisma.projectMember.deleteMany({ where: { projectId, userId } });
  if (count === 0) throw notFound('Membership not found');
  await audit(actor.id, 'project.members.remove', 'Project', projectId, { userId });
}

// Replace a user's project set (user-side editing).
export async function setUserProjects(actor, userId, projectIds) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { memberships: true },
  });
  if (!user) throw notFound('User not found');

  const wanted = [...new Set(projectIds)];
  const projects = await prisma.project.findMany({ where: { id: { in: wanted } } });
  if (projects.length !== wanted.length) throw badRequest('One or more projects do not exist');

  const current = new Set(user.memberships.map((m) => m.projectId));
  const toAdd = projects.filter((p) => !current.has(p.id));
  for (const p of toAdd) {
    assertCanJoin(user, p);
    if (p.status !== 'ACTIVE') throw conflict(`${p.key} is archived`);
  }

  const toRemove = [...current].filter((id) => !wanted.includes(id));
  await prisma.$transaction(async (tx) => {
    await tx.projectMember.deleteMany({ where: { userId, projectId: { in: toRemove } } });
    await tx.projectMember.createMany({
      data: toAdd.map((p) => ({ userId, projectId: p.id })),
      skipDuplicates: true,
    });
    await audit(
      actor.id,
      'user.projects.set',
      'User',
      userId,
      { added: toAdd.map((p) => p.id), removed: toRemove },
      tx,
    );
  });
}

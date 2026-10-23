import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { paginate, searchWhere } from '../lib/pagination.js';
import { audit } from './audit.service.js';
import { createAuthToken } from './auth.service.js';
import { assertCanJoin } from './project.service.js';
import { sendAccountCreatedEmail, sendApprovalEmail, sendRejectionEmail } from './email.service.js';

const include = {
  organization: { select: { id: true, name: true } },
  memberships: { include: { project: { select: { id: true, key: true, name: true } } } },
};

// Never expose passwordHash / lockout internals to the admin UI.
const view = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  organization: u.organization,
  emailVerifiedAt: u.emailVerifiedAt,
  lastLoginAt: u.lastLoginAt,
  lockedUntil: u.lockedUntil,
  createdAt: u.createdAt,
  projects: u.memberships.map((m) => m.project),
});

const load = async (id, db = prisma) => {
  const user = await db.user.findUnique({ where: { id }, include });
  if (!user) throw notFound('User not found');
  return user;
};

const revokeSessions = (userId, db = prisma) =>
  db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

// The system must always have someone who can administer it.
async function assertNotLastAdmin(user) {
  if (user.role !== 'ADMIN' || user.status !== 'ACTIVE') return;
  const others = await prisma.user.count({
    where: { role: 'ADMIN', status: 'ACTIVE', id: { not: user.id } },
  });
  if (others === 0) throw conflict('This is the last active administrator');
}

export async function listUsers(query) {
  const where = {
    ...searchWhere(query.q, ['name', 'email']),
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    ...(query.projectId ? { memberships: { some: { projectId: query.projectId } } } : {}),
  };
  const page = await paginate(prisma.user, { where, query, include });
  return { ...page, items: page.items.map(view) };
}

export async function getUser(id) {
  return view(await load(id));
}

async function validatedOrg(organizationId) {
  const org =
    organizationId && (await prisma.organization.findUnique({ where: { id: organizationId } }));
  if (!org || org.status !== 'ACTIVE') {
    throw badRequest('Organization not found or archived', [
      { path: 'organizationId', message: 'Choose an active organization' },
    ]);
  }
  return org;
}

// Admin-created accounts have no password the admin knows: the user sets their own through an
// emailed single-use link (same mechanism as password reset, longer lifetime).
export async function createUser(actor, { name, email, role, organizationId, projectIds }) {
  if (await prisma.user.findUnique({ where: { email } }))
    throw conflict('A user with this email already exists', [
      { path: 'email', message: 'Already registered' },
    ]);
  const orgId = role === 'CUSTOMER' ? (await validatedOrg(organizationId)).id : null;

  const wanted = [...new Set(projectIds)];
  const projects = await prisma.project.findMany({
    where: { id: { in: wanted }, status: 'ACTIVE' },
  });
  if (projects.length !== wanted.length) throw badRequest('One or more projects are invalid');
  const candidate = { name, role, organizationId: orgId };
  projects.forEach((p) => assertCanJoin(candidate, p));

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name,
        email,
        role,
        organizationId: orgId,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        passwordHash: await hashPassword(crypto.randomBytes(32).toString('hex')),
        memberships: { create: projects.map((p) => ({ projectId: p.id })) },
      },
    });
    await audit(
      actor.id,
      'user.create',
      'User',
      created.id,
      { email, role, organizationId: orgId, projectIds: wanted },
      tx,
    );
    return created;
  });
  await sendAccountCreatedEmail(
    user,
    await createAuthToken(user.id, 'PASSWORD_RESET', 72 * 3600_000),
  );
  return getUser(user.id);
}

export async function updateUser(actor, id, data) {
  const user = await load(id);
  const roleChanged = data.role !== undefined && data.role !== user.role;
  if (roleChanged && id === actor.id) throw conflict('You cannot change your own role');
  if (roleChanged && user.role === 'ADMIN') await assertNotLastAdmin(user);

  const newRole = data.role ?? user.role;
  let newOrgId = user.organizationId;
  if (newRole === 'CUSTOMER') {
    newOrgId = data.organizationId !== undefined ? data.organizationId : user.organizationId;
    await validatedOrg(newOrgId);
  } else {
    newOrgId = null; // staff are not tied to a client organization
  }
  const orgChanged = newOrgId !== user.organizationId;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        role: newRole,
        organizationId: newOrgId,
        ...(roleChanged || orgChanged ? { lastProjectId: null } : {}),
      },
    });
    if (roleChanged || orgChanged) {
      // Old memberships were granted under the old role/organization and are no longer valid.
      await tx.projectMember.deleteMany({ where: { userId: id } });
      await revokeSessions(id, tx); // force re-login so the new role is obvious to the user
    }
    await audit(
      actor.id,
      'user.update',
      'User',
      id,
      { changes: data, membershipsCleared: roleChanged || orgChanged },
      tx,
    );
  });
  return getUser(id);
}

export async function deactivateUser(actor, id) {
  const user = await load(id);
  if (id === actor.id) throw conflict('You cannot deactivate your own account');
  if (user.status === 'DEACTIVATED') return view(user);
  await assertNotLastAdmin(user);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status: 'DEACTIVATED' } });
    await revokeSessions(id, tx);
    await audit(actor.id, 'user.deactivate', 'User', id, { previousStatus: user.status }, tx);
  });
  return getUser(id);
}

export async function reactivateUser(actor, id) {
  const user = await load(id);
  if (user.status !== 'DEACTIVATED') throw conflict('User is not deactivated');
  // A rejected/never-approved registration must go through approval, not a back door.
  if (!user.emailVerifiedAt) throw conflict('This user never verified their email');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null },
    });
    await audit(actor.id, 'user.reactivate', 'User', id, null, tx);
  });
  return getUser(id);
}

export async function unlockUser(actor, id) {
  await load(id);
  await prisma.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null } });
  await audit(actor.id, 'user.unlock', 'User', id, null);
  return getUser(id);
}

// ───────────── registration approval ─────────────

async function loadPending(id) {
  const user = await load(id);
  if (user.status !== 'PENDING' || user.role !== 'CUSTOMER')
    throw conflict('This registration is not awaiting approval');
  return user;
}

export async function approveUser(actor, id, projectIds) {
  const user = await loadPending(id);
  if (!user.emailVerifiedAt)
    throw conflict('The user has not verified their email yet', [
      { path: 'email', message: 'Unverified' },
    ]);

  const wanted = [...new Set(projectIds)];
  const projects = await prisma.project.findMany({
    where: { id: { in: wanted }, status: 'ACTIVE' },
  });
  if (projects.length !== wanted.length) throw badRequest('One or more projects are invalid');
  projects.forEach((p) => assertCanJoin(user, p));

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status: 'ACTIVE' } });
    await tx.projectMember.createMany({
      data: projects.map((p) => ({ userId: id, projectId: p.id })),
      skipDuplicates: true,
    });
    await audit(actor.id, 'user.approve', 'User', id, { projectIds: wanted }, tx);
  });
  await sendApprovalEmail(user);
  return getUser(id);
}

// Rejected registrations are kept (DEACTIVATED) rather than deleted: the audit trail stays intact
// and the same email cannot silently re-register.
export async function rejectUser(actor, id, reason) {
  const user = await loadPending(id);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status: 'DEACTIVATED' } });
    await audit(actor.id, 'user.reject', 'User', id, { reason: reason ?? null }, tx);
  });
  await sendRejectionEmail(user, reason);
  return getUser(id);
}

import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { paginate, searchWhere } from '../lib/pagination.js';
import { hashPassword } from '../lib/password.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { audit } from './audit.service.js';
import { sendInvitationEmail } from './email.service.js';

const INVITE_TTL_MS = 7 * 24 * 3600_000;

export async function createInvitation(actor, { email, role, organizationId, projectIds }) {
  if (await prisma.user.findUnique({ where: { email } }))
    throw conflict('A user with this email already exists');

  // Customers: org required and every project must belong to it. Staff: no org.
  const orgId = role === 'CUSTOMER' ? organizationId : null;
  if (orgId && !(await prisma.organization.findFirst({ where: { id: orgId, status: 'ACTIVE' } }))) {
    throw badRequest('Unknown organisation');
  }
  const projects = await prisma.project.findMany({
    where: {
      id: { in: projectIds },
      status: 'ACTIVE',
      ...(orgId ? { organizationId: orgId } : {}),
    },
    select: { id: true },
  });
  if (projects.length !== new Set(projectIds).size) {
    throw badRequest('One or more projects are invalid for this invitation');
  }

  const raw = generateToken();
  const invitation = await prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.create({
      data: {
        email,
        role,
        organizationId: orgId,
        invitedById: actor.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        projects: { create: projects.map((p) => ({ projectId: p.id })) },
      },
    });
    await audit(
      actor.id,
      'invitation.create',
      'Invitation',
      inv.id,
      { email, role, organizationId: orgId, projectIds },
      tx,
    );
    return inv;
  });

  await sendInvitationEmail({ email, inviterName: actor.name, token: raw });
  return { id: invitation.id, email, role, expiresAt: invitation.expiresAt };
}

async function findOpenInvitation(raw) {
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: {
      organization: { select: { name: true } },
      projects: { include: { project: { select: { name: true, key: true } } } },
    },
  });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date())
    throw badRequest('This invitation is invalid or has expired');
  return inv;
}

export async function previewInvitation(raw) {
  const inv = await findOpenInvitation(raw);
  return {
    email: inv.email,
    role: inv.role,
    organization: inv.organization?.name ?? null,
    projects: inv.projects.map((p) => p.project),
  };
}

// Invited users are trusted: the invite proves the email, so the account is ACTIVE and verified.
export async function acceptInvitation({ token, name, password }) {
  const inv = await findOpenInvitation(token);
  if (await prisma.user.findUnique({ where: { email: inv.email } }))
    throw conflict('An account with this email already exists');
  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw badRequest('This invitation is invalid or has expired');
    const user = await tx.user.create({
      data: {
        name,
        email: inv.email,
        passwordHash,
        role: inv.role,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        organizationId: inv.organizationId,
      },
    });
    await tx.projectMember.createMany({
      data: inv.projects.map((p) => ({ userId: user.id, projectId: p.projectId })),
    });
  });
}

// ───────────── admin management of invitations ─────────────
const invitationView = (i) => ({
  id: i.id,
  email: i.email,
  role: i.role,
  expiresAt: i.expiresAt,
  createdAt: i.createdAt,
  organization: i.organization,
  invitedBy: i.invitedBy,
  projects: i.projects.map((p) => p.project),
});

export async function listInvitations(query) {
  const where = {
    acceptedAt: null,
    expiresAt: { gt: new Date() },
    ...searchWhere(query.q, ['email']),
  };
  const page = await paginate(prisma.invitation, {
    where,
    query,
    include: {
      organization: { select: { id: true, name: true } },
      invitedBy: { select: { id: true, name: true } },
      projects: { include: { project: { select: { id: true, key: true, name: true } } } },
    },
  });
  return { ...page, items: page.items.map(invitationView) };
}

export async function revokeInvitation(actor, id) {
  const { count } = await prisma.invitation.deleteMany({ where: { id, acceptedAt: null } });
  if (count === 0) throw notFound('Invitation not found');
  await audit(actor.id, 'invitation.revoke', 'Invitation', id, null);
}

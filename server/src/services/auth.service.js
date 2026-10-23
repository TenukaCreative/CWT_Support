import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { AppError, badRequest, notFound, unauthorized } from '../lib/errors.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../lib/password.js';
import { generateToken, hashToken, signAccessToken } from '../lib/tokens.js';
import { ALL_PROJECTS } from '../lib/scope.js';
import { getAccessibleProjects, publicUser } from '../lib/access.js';
import { sendPasswordResetEmail, sendVerificationEmail } from './email.service.js';

const HOUR = 3600_000;
const MAX_FAILED_LOGINS = 5;
const invalidCredentials = () => unauthorized('Invalid email or password');

// ───────────── tokens & sessions ─────────────

export async function createAuthToken(userId, type, ttlMs) {
  const raw = generateToken();
  await prisma.authToken.create({
    data: { userId, type, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return raw;
}

// Single-use: the conditional UPDATE is the atomic "claim", so two concurrent requests with the
// same token cannot both succeed.
async function consumeAuthToken(raw, type) {
  const record = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date()) {
    throw badRequest('This link is invalid or has expired');
  }
  const claimed = await prisma.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) throw badRequest('This link is invalid or has expired');
  return record;
}

async function createRefreshToken(userId, familyId = crypto.randomUUID()) {
  const raw = generateToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * HOUR),
    },
  });
  return raw;
}

// Which project should a fresh session start in?
//  - one option and nothing to choose -> auto-select
//  - several -> null, the client shows the picker (lastProjectId is only a hint)
function defaultActiveProject(user, projects) {
  if (user.role === 'ADMIN') return projects.length === 0 ? ALL_PROJECTS : null;
  return projects.length === 1 ? projects[0].id : null;
}

// A remembered project is only honoured if the user can still access it.
function validRememberedProject(user, projects) {
  const id = user.lastProjectId;
  if (!id) return null;
  if (id === ALL_PROJECTS) return user.role !== 'CUSTOMER' ? id : null;
  return projects.some((p) => p.id === id) ? id : null;
}

async function sessionPayload(user, activeProjectId, projects) {
  return {
    accessToken: signAccessToken({ userId: user.id, activeProjectId }),
    user: publicUser(user),
    projects,
    activeProjectId,
    lastProjectId: validRememberedProject(user, projects),
    needsProjectSelection: activeProjectId === null && projects.length > 0,
  };
}

const loadUser = (where) => prisma.user.findUnique({ where, include: { organization: true } });

// ───────────── registration & verification ─────────────

export async function listOrganizations() {
  return prisma.organization.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export async function register({ name, email, password, organizationId }) {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, status: 'ACTIVE' },
  });
  if (!org)
    throw badRequest('Unknown organisation', [
      { path: 'organizationId', message: 'Unknown organisation' },
    ]);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Same response as success so registration cannot be used to discover which emails exist.
    logger.info({ userId: existing.id }, 'Registration attempted for an existing email');
    return;
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role: 'CUSTOMER',
      status: 'PENDING',
      organizationId,
    },
  });
  await sendVerificationEmail(
    user,
    await createAuthToken(user.id, 'EMAIL_VERIFICATION', 24 * HOUR),
  );
}

export async function resendVerification(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.emailVerifiedAt && user.status === 'PENDING') {
    await sendVerificationEmail(
      user,
      await createAuthToken(user.id, 'EMAIL_VERIFICATION', 24 * HOUR),
    );
  }
}

// After the email is proven, decide whether the account can go live immediately:
//   1. an open invitation for this email (admin pre-approved them), or
//   2. domain auto-join (feature flag, off by default),
// otherwise it stays PENDING until an admin approves it (Phase 3).
export async function verifyEmail(rawToken) {
  const { userId } = await consumeAuthToken(rawToken, 'EMAIL_VERIFICATION');

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });
    await tx.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    });
    if (user.status !== 'PENDING') return { status: user.status };

    const invitation = await tx.invitation.findFirst({
      where: {
        email: user.email,
        role: 'CUSTOMER',
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { projects: true },
    });
    if (invitation) {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE', organizationId: invitation.organizationId },
      });
      await tx.projectMember.createMany({
        data: invitation.projects.map((p) => ({ userId, projectId: p.projectId })),
        skipDuplicates: true,
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      return { status: 'ACTIVE' };
    }

    const domain = user.email.split('@')[1];
    if (env.FEATURE_DOMAIN_AUTOJOIN && user.organization?.domain === domain) {
      const projects = await tx.project.findMany({
        where: { organizationId: user.organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      await tx.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
      await tx.projectMember.createMany({
        data: projects.map((p) => ({ userId, projectId: p.id })),
        skipDuplicates: true,
      });
      return { status: 'ACTIVE' };
    }
    return { status: 'PENDING' };
  });
}

// ───────────── login / refresh / logout ─────────────

export async function login({ email, password }) {
  const user = await loadUser({ email });

  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    throw invalidCredentials();
  }

  // Checked BEFORE comparing the password so a locked account cannot be probed further.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLoginCount + 1;
    const data = { failedLoginCount: failed };
    if (failed >= MAX_FAILED_LOGINS) {
      // Exponential backoff: 1, 2, 4 ... capped at 60 minutes.
      const minutes = Math.min(2 ** (failed - MAX_FAILED_LOGINS), 60);
      data.lockedUntil = new Date(Date.now() + minutes * 60_000);
      logger.warn({ userId: user.id, failed, minutes }, 'Account temporarily locked');
    }
    await prisma.user.update({ where: { id: user.id }, data });
    throw invalidCredentials();
  }

  // Credentials are right, so it is now safe to say why the account cannot be used yet.
  if (user.status === 'PENDING') {
    throw user.emailVerifiedAt
      ? new AppError(
          403,
          'ACCOUNT_PENDING_APPROVAL',
          'Your account is waiting for approval by an administrator',
        )
      : new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address first');
  }
  if (user.status === 'DEACTIVATED') {
    throw new AppError(403, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const projects = await getAccessibleProjects(user);
  const activeProjectId = defaultActiveProject(user, projects);
  if (activeProjectId)
    await prisma.user.update({ where: { id: user.id }, data: { lastProjectId: activeProjectId } });

  return {
    ...(await sessionPayload(user, activeProjectId, projects)),
    refreshToken: await createRefreshToken(user.id),
  };
}

// Rotation: every refresh token is single-use. Presenting one that was ALREADY rotated means it
// was copied (or the client is broken), so the whole family is revoked and the user must log in again.
export async function refresh(rawToken) {
  if (!rawToken) throw unauthorized();
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!record) throw unauthorized();

  if (record.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn(
      { userId: record.userId, familyId: record.familyId },
      'Refresh token reuse detected; family revoked',
    );
    throw unauthorized();
  }
  if (record.expiresAt < new Date()) throw unauthorized();

  const claimed = await prisma.refreshToken.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count !== 1) throw unauthorized(); // lost a race with another request

  const user = await loadUser({ id: record.userId });
  if (!user || user.status !== 'ACTIVE') throw unauthorized();

  const projects = await getAccessibleProjects(user);
  const activeProjectId =
    validRememberedProject(user, projects) ?? defaultActiveProject(user, projects);

  return {
    ...(await sessionPayload(user, activeProjectId, projects)),
    refreshToken: await createRefreshToken(user.id, record.familyId),
  };
}

export async function logout(rawToken) {
  if (!rawToken) return;
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (record) {
    await prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

// ───────────── project selection ─────────────

export async function getSession(user, scope) {
  const projects = await getAccessibleProjects(user);
  return {
    user: publicUser(user),
    projects,
    activeProjectId: scope.activeProjectId,
    lastProjectId: validRememberedProject(user, projects),
    needsProjectSelection: !scope.activeProjectId && projects.length > 0,
  };
}

// Re-issues the access token for another project after verifying membership against the database
// (the client's claim is never trusted).
export async function selectProject(user, projectId) {
  const projects = await getAccessibleProjects(user);
  const allowed =
    projectId === ALL_PROJECTS
      ? user.role === 'ADMIN' || (user.role === 'SUPPORT' && projects.length > 0)
      : projects.some((p) => p.id === projectId);
  if (!allowed) throw notFound('Project not found');

  await prisma.user.update({ where: { id: user.id }, data: { lastProjectId: projectId } });
  return {
    accessToken: signAccessToken({ userId: user.id, activeProjectId: projectId }),
    activeProjectId: projectId,
    projects,
  };
}

// ───────────── password reset ─────────────

export async function forgotPassword(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.status !== 'DEACTIVATED') {
    await sendPasswordResetEmail(user, await createAuthToken(user.id, 'PASSWORD_RESET', HOUR));
  }
}

export async function resetPassword({ token, password }) {
  const { userId } = await consumeAuthToken(token, 'PASSWORD_RESET');
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null },
    }),
    // A reset means the old credentials may be compromised: kill every session and other reset links.
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.authToken.updateMany({
      where: { userId, type: 'PASSWORD_RESET', usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);
}

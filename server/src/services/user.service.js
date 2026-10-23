import { prisma } from '../lib/prisma.js';
import { badRequest } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { hashToken } from '../lib/tokens.js';
import { publicUser } from '../lib/access.js';

export async function updateProfile(userId, data) {
  const user = await prisma.user.update({
    where: { id: userId },
    data,
    include: { organization: { select: { id: true, name: true } } },
  });
  return publicUser(user);
}

export async function changePassword(user, { currentPassword, newPassword }, currentRefreshToken) {
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw badRequest('Current password is incorrect', [
      { path: 'currentPassword', message: 'Incorrect password' },
    ]);
  }
  // Keep this browser's session, sign out every other device.
  const current = currentRefreshToken
    ? await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(currentRefreshToken) } })
    : null;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    }),
    prisma.refreshToken.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
        ...(current ? { familyId: { not: current.familyId } } : {}),
      },
      data: { revokedAt: new Date() },
    }),
  ]);
}

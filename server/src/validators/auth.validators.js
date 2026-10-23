import { z } from 'zod';

export const email = z.string().trim().toLowerCase().email().max(254);

// bcrypt only uses the first 72 bytes, so cap there rather than silently truncating.
export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a digit')
  // bcrypt hashes only the first 72 BYTES; multi-byte characters would otherwise be silently truncated.
  .refine(
    (v) => Buffer.byteLength(v, 'utf8') <= 72,
    'Password is too long (72 bytes maximum; accented characters and emoji use more than one)',
  );

const token = z.string().min(20).max(200);
const name = z.string().trim().min(1).max(100);

export const registerBody = z.object({
  name,
  email,
  password,
  organizationId: z.string().min(1).max(64),
});
export const loginBody = z.object({ email, password: z.string().min(1).max(200) });
export const tokenBody = z.object({ token });
export const emailBody = z.object({ email });
export const resetPasswordBody = z.object({ token, password });
export const acceptInviteBody = z.object({ token, name, password });
export const tokenParams = z.object({ token });
export const selectProjectBody = z.object({ projectId: z.string().min(1).max(64) });

export const inviteBody = z
  .object({
    email,
    role: z.enum(['ADMIN', 'SUPPORT', 'CUSTOMER']),
    organizationId: z.string().min(1).optional(),
    projectIds: z.array(z.string().min(1)).max(50).default([]),
  })
  .refine((v) => v.role !== 'CUSTOMER' || v.organizationId, {
    message: 'organizationId is required for customers',
    path: ['organizationId'],
  });

export const notificationPrefs = z
  .object({
    emailOnReply: z.boolean(),
    emailOnStatusChange: z.boolean(),
    emailOnAssignment: z.boolean(),
    inApp: z.boolean(),
  })
  .strict();

export const updateProfileBody = z
  .object({ name: name.optional(), notificationPrefs: notificationPrefs.optional() })
  .strict();

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

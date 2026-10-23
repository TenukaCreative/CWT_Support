import { z } from 'zod';
import { pageQuery, searchTerm } from '../lib/pagination.js';
import { email } from './auth.validators.js';
import { dateOnly } from '../lib/reportRange.js';

const id = z.string().min(1).max(64);
const name = z.string().trim().min(1).max(100);
const emptyToNull = (v) => (v === '' ? null : v);

export const idParams = z.object({ id });
export const memberParams = z.object({ id, userId: id });

// ── organizations
const domain = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
      'Enter a valid domain, e.g. acme.com',
    )
    .nullable(),
);
const entityStatus = z.enum(['ACTIVE', 'ARCHIVED']);

export const orgListQuery = pageQuery(['name', 'createdAt']).extend({
  q: searchTerm,
  status: entityStatus.optional(),
});
export const orgCreateBody = z.object({ name, domain: domain.optional() }).strict();
export const orgUpdateBody = z
  .object({ name: name.optional(), domain: domain.optional(), status: entityStatus.optional() })
  .strict();

// ── projects
// Keys prefix ticket numbers (ACME-WEB-0042), so they are strict and immutable after creation.
const projectKey = z
  .string()
  .trim()
  .toUpperCase()
  .min(2)
  .max(20)
  .regex(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/, 'Use letters, digits and single hyphens, e.g. ACME-WEB');
const description = z.preprocess(emptyToNull, z.string().trim().max(1000).nullable());

export const projectListQuery = pageQuery(['name', 'key', 'createdAt']).extend({
  q: searchTerm,
  status: entityStatus.optional(),
  organizationId: id.optional(),
});
export const projectCreateBody = z
  .object({ organizationId: id, name, key: projectKey, description: description.optional() })
  .strict();
export const projectUpdateBody = z
  .object({
    name: name.optional(),
    description: description.optional(),
    status: entityStatus.optional(),
  })
  .strict();
export const addMembersBody = z.object({ userIds: z.array(id).min(1).max(100) }).strict();
export const setUserProjectsBody = z.object({ projectIds: z.array(id).max(200) }).strict();

// ── users
const role = z.enum(['ADMIN', 'SUPPORT', 'CUSTOMER']);
const userStatus = z.enum(['PENDING', 'ACTIVE', 'DEACTIVATED']);

export const userListQuery = pageQuery(['name', 'email', 'createdAt', 'lastLoginAt']).extend({
  q: searchTerm,
  role: role.optional(),
  status: userStatus.optional(),
  organizationId: id.optional(),
  projectId: id.optional(),
});
export const userCreateBody = z
  .object({
    name,
    email,
    role,
    organizationId: id.optional(),
    projectIds: z.array(id).max(200).default([]),
  })
  .strict()
  .refine((v) => v.role !== 'CUSTOMER' || v.organizationId, {
    message: 'organizationId is required for customers',
    path: ['organizationId'],
  });
export const userUpdateBody = z
  .object({
    name: name.optional(),
    role: role.optional(),
    organizationId: id.nullable().optional(),
  })
  .strict();
export const approveBody = z.object({ projectIds: z.array(id).max(200).default([]) }).strict();
export const rejectBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export const invitationListQuery = pageQuery(['email', 'createdAt', 'expiresAt']).extend({
  q: searchTerm,
});

// ── categories & SLA
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const catName = z.string().trim().min(1).max(100);
export const categoryCreateBody = z
  .object({ projectId: id.nullable().optional(), name: catName })
  .strict();
export const categoryUpdateBody = z
  .object({ name: catName.optional(), isActive: z.boolean().optional() })
  .strict();
export const slaBody = z
  .object({
    projectId: id.nullable().optional(),
    priority,
    firstResponseHours: z.number().int().min(1).max(2000),
    resolutionHours: z.number().int().min(1).max(5000),
  })
  .strict();

// ── audit log
export const auditListQuery = pageQuery(['createdAt', 'action'], 'createdAt', 'desc')
  .extend({
    actorId: id.optional(),
    action: z.string().trim().max(100).optional(),
    entity: z.string().trim().max(100).optional(),
    q: searchTerm,
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  })
  .transform(({ from, to, ...rest }) => ({
    ...rest,
    from: from ? new Date(`${from}T00:00:00Z`) : undefined,
    to: to ? new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000) : undefined,
  }));

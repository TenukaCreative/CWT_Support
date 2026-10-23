import { z } from 'zod';
import { pageQuery, searchTerm } from '../lib/pagination.js';
import { STATUSES } from '../lib/ticketStateMachine.js';
import { dateOnly } from '../lib/reportRange.js';

const id = z.string().min(1).max(64);
const status = z.enum(STATUSES);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
// Multipart forms send empty strings for untouched optional fields.
const optionalId = z.preprocess((v) => (v === '' ? undefined : v), id.optional());
const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

export const idParams = z.object({ id });
export const attachmentParams = z.object({ id, attachmentId: id });

const statusList = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(status).min(1).max(6));

export const listQuery = pageQuery(
  ['createdAt', 'updatedAt', 'priority', 'status', 'number'],
  'updatedAt',
  'desc',
).extend({
  q: searchTerm,
  status: statusList.optional(),
  priority: priority.optional(),
  categoryId: id.optional(),
  assigneeId: id.optional(), // a user id, "me" or "unassigned"
  projectId: id.optional(),
  mine: flag, // tickets I raised
});

// Customers may pick LOW..HIGH; URGENT is for staff to set after triage.
export const createBody = z.object({
  subject: z.string().trim().min(5, 'Subject must be at least 5 characters').max(200),
  description: z
    .string()
    .trim()
    .min(10, 'Please describe the problem in at least 10 characters')
    .max(10000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  categoryId: optionalId,
  searchLogId: optionalId,
});

export const messageBody = z.object({
  body: z.string().trim().min(1, 'Write a message').max(10000),
  type: z.enum(['PUBLIC', 'INTERNAL_NOTE']).default('PUBLIC'),
});

export const statusBody = z.object({ status }).strict();
export const updateBody = z
  .object({ priority: priority.optional(), categoryId: id.nullable().optional() })
  .strict();
export const assignBody = z.object({ assigneeId: id.nullable() }).strict();
export const bulkAssignBody = z
  .object({ ticketIds: z.array(id).min(1).max(100), assigneeId: id.nullable() })
  .strict();
export const feedbackBody = z
  .object({
    rating: z.number().int().min(1, 'Choose 1 to 5 stars').max(5, 'Choose 1 to 5 stars'),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();
export const mergeBody = z.object({ targetTicketId: id }).strict();
export const assigneesQuery = z.object({ projectId: id.optional() });
export const categoriesQuery = z.object({}).passthrough();

export const cannedBody = z
  .object({
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(5000),
    scope: z.enum(['GLOBAL', 'PROJECT', 'PERSONAL']),
    projectId: id.nullable().optional(),
  })
  .strict();
export const cannedUpdateBody = z
  .object({
    title: z.string().trim().min(1).max(100).optional(),
    body: z.string().trim().min(1).max(5000).optional(),
  })
  .strict();

// CSV export: the same filters as the list, no paging, plus an inclusive created-date range.
export const exportQuery = z
  .object({
    q: searchTerm,
    status: statusList.optional(),
    priority: priority.optional(),
    categoryId: id.optional(),
    assigneeId: id.optional(),
    projectId: id.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  })
  .transform(({ from, to, ...rest }) => ({
    ...rest,
    createdFrom: from ? new Date(`${from}T00:00:00Z`) : undefined,
    createdTo: to ? new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000) : undefined, // end of the "to" day
  }));

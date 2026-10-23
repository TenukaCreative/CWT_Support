import { z } from 'zod';
import { pageQuery, searchTerm } from '../lib/pagination.js';

const id = z.string().min(1).max(64);
const status = z.enum(['DRAFT', 'PUBLISHED']);
const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const idParams = z.object({ id });
export const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export const suggestQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(10).default(5),
  log: flag,
});
export const listQuery = pageQuery(
  ['sortOrder', 'question', 'helpfulYes', 'updatedAt', 'createdAt'],
  'sortOrder',
  'asc',
).extend({
  q: searchTerm,
  status: status.optional(),
  categoryId: id.optional(), // a category id, or "none" for uncategorised
  projectId: id.optional(), // a project id, or "global"
});
export const voteBody = z.object({ helpful: z.boolean() }).strict();
export const clickBody = z.object({ articleId: id }).strict();
export const previewBody = z.object({ answer: z.string().max(20000) }).strict();

const question = z.string().trim().min(5, 'Write the question in at least 5 characters').max(300);
const answer = z.string().trim().min(1, 'The answer cannot be empty').max(20000);
const sortOrder = z.coerce.number().int().min(0).max(10000);

export const articleCreateBody = z
  .object({
    projectId: id.nullable(), // null = global (admin only)
    categoryId: id.nullable().optional(),
    question,
    answer,
    status: status.default('DRAFT'),
    sortOrder: sortOrder.default(0),
  })
  .strict();
export const articleUpdateBody = z
  .object({
    categoryId: id.nullable().optional(),
    question: question.optional(),
    answer: answer.optional(),
    status: status.optional(),
    sortOrder: sortOrder.optional(),
  })
  .strict();

const name = z.string().trim().min(1).max(100);
export const categoryCreateBody = z
  .object({ projectId: id.nullable(), name, sortOrder: sortOrder.default(0) })
  .strict();
export const categoryUpdateBody = z
  .object({ name: name.optional(), sortOrder: sortOrder.optional() })
  .strict();

export const insightsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  projectId: id.optional(),
});

export const settingsBody = z
  .object({
    faqRequireApproval: z.boolean().optional(),
    reopenWindowDays: z.number().int().min(1).max(90).optional(),
    autoCloseAfterDays: z.number().int().min(1).max(90).optional(),
    feedbackEditWindowHours: z.number().int().min(1).max(168).optional(),
  })
  .strict();

import { z } from 'zod';
import { prisma } from './prisma.js';

// Shared list-endpoint contract: ?page=1&limit=20&sort=createdAt&dir=desc
// `sortable` is a whitelist, so clients can never order by (or probe) arbitrary columns.
export const pageQuery = (sortable, defaultSort = 'createdAt', defaultDir = 'desc') =>
  z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(sortable).default(defaultSort),
    dir: z.enum(['asc', 'desc']).default(defaultDir),
  });

export const searchTerm = z.string().trim().max(100).optional();

// `db` lets tenant lists run through the scoped client (req.db); admin lists use the base client.
export async function paginate(delegate, { where, query, include, select }, db = prisma) {
  const { page, limit, sort, dir } = query;
  const [items, total] = await db.$transaction([
    delegate.findMany({
      where,
      ...(include ? { include } : {}),
      ...(select ? { select } : {}),
      // id as tie-breaker keeps pages stable when many rows share the sort value.
      orderBy: [{ [sort]: dir }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    delegate.count({ where }),
  ]);
  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

// LIKE treats % and _ as wildcards and backslash as the escape character. User text must match
// literally ("100%" is not "100 followed by anything"), so escape all three.
export const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// Case-insensitive "contains" over several columns, or no filter when q is empty.
export const searchWhere = (q, fields) =>
  q ? { OR: fields.map((f) => ({ [f]: { contains: escapeLike(q), mode: 'insensitive' } })) } : {};

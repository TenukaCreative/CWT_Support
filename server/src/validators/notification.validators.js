import { z } from 'zod';
import { pageQuery } from '../lib/pagination.js';

export const listQuery = pageQuery(['createdAt'], 'createdAt', 'desc').extend({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export const idParams = z.object({ id: z.string().min(1).max(64) });

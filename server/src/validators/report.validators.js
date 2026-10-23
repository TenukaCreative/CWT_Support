import { z } from 'zod';
import { dateOnly } from '../lib/reportRange.js';

// from/to are inclusive UTC days (YYYY-MM-DD); range limits are enforced in resolveRange().
export const rangeQuery = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  projectId: z.string().min(1).max(64).optional(),
});

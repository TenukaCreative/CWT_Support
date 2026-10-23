import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireProject, requireRole } from '../middleware/auth.js';
import * as c from '../controllers/report.controller.js';
import { rangeQuery } from '../validators/report.validators.js';

// Dashboards need a project scope (an admin picks "All projects" or one project) and every
// query is restricted to it (lib/scopeSql.js). Company-wide views are admin-only; /me is each
// staff member's own numbers.
const router = Router();
router.use(authenticate, requireProject);
const query = validate({ query: rangeQuery });

router.get('/overview', requireRole('ADMIN'), query, h(c.overview));
router.get('/csat', requireRole('ADMIN'), query, h(c.csat));
router.get('/deflection', requireRole('ADMIN'), query, h(c.deflection));
router.get('/me', requireRole('SUPPORT', 'ADMIN'), query, h(c.me));

export default router;

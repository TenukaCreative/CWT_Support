import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as c from '../controllers/invitation.controller.js';
import * as v from '../validators/auth.validators.js';

const router = Router();
router.post('/', authenticate, requireRole('ADMIN'), validate({ body: v.inviteBody }), h(c.create));
export default router;

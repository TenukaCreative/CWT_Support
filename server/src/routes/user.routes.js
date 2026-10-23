import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import * as c from '../controllers/user.controller.js';
import * as v from '../validators/auth.validators.js';

const router = Router();
router.use(authenticate);

router.patch('/me', validate({ body: v.updateProfileBody }), h(c.updateMe));
router.post(
  '/me/password',
  authLimiter,
  validate({ body: v.changePasswordBody }),
  h(c.changePassword),
);

export default router;

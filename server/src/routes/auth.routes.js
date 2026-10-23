import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, csrfGuard } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import * as c from '../controllers/auth.controller.js';
import * as v from '../validators/auth.validators.js';

const router = Router();

router.get('/organizations', authLimiter, h(c.listOrganizations));
router.post('/register', authLimiter, validate({ body: v.registerBody }), h(c.register));
router.post('/verify-email', authLimiter, validate({ body: v.tokenBody }), h(c.verifyEmail));
router.post(
  '/resend-verification',
  authLimiter,
  validate({ body: v.emailBody }),
  h(c.resendVerification),
);
router.post('/login', authLimiter, validate({ body: v.loginBody }), h(c.login));
router.post('/forgot-password', authLimiter, validate({ body: v.emailBody }), h(c.forgotPassword));
router.post(
  '/reset-password',
  authLimiter,
  validate({ body: v.resetPasswordBody }),
  h(c.resetPassword),
);
router.get(
  '/invitations/:token',
  authLimiter,
  validate({ params: v.tokenParams }),
  h(c.previewInvitation),
);
router.post(
  '/accept-invite',
  authLimiter,
  validate({ body: v.acceptInviteBody }),
  h(c.acceptInvitation),
);

// Cookie-based: CSRF-guarded.
router.post('/refresh', csrfGuard, h(c.refresh));
router.post('/logout', csrfGuard, h(c.logout));

// Bearer-based.
router.get('/me', authenticate, h(c.me));
router.post(
  '/select-project',
  authenticate,
  validate({ body: v.selectProjectBody }),
  h(c.selectProject),
);

export default router;

import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import * as n from '../services/notification.service.js';
import * as v from '../validators/notification.validators.js';

// Per-user data: no project needed. req.db restricts every query to the caller's own rows.
const router = Router();
router.use(authenticate);

router.get(
  '/',
  validate({ query: v.listQuery }),
  h(async (req, res) => res.json(await n.listNotifications(req.db, req.query))),
);
router.get(
  '/unread-count',
  h(async (req, res) => res.json(await n.unreadCount(req.db))),
);
router.post(
  '/read-all',
  h(async (req, res) => res.json(await n.markAllRead(req.db))),
);
router.post(
  '/:id/read',
  validate({ params: v.idParams }),
  h(async (req, res) => {
    await n.markRead(req.db, req.params.id);
    res.status(204).end();
  }),
);

export default router;

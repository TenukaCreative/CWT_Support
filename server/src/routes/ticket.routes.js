import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireProject, requireRole } from '../middleware/auth.js';
import { uploadFiles } from '../middleware/upload.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import * as c from '../controllers/ticket.controller.js';
import * as v from '../validators/ticket.validators.js';

// Everything here is scoped (req.db) and needs a selected project. Customers see tickets of
// their active project; staff see tickets of the projects in their scope.
//
// Guards are per-route (not router.use): this router is mounted at '/', and unknown URLs must
// still fall through to a clean 404 instead of a 401.
const router = Router();
const guard = [authenticate, requireProject];
const staff = [...guard, requireRole('SUPPORT', 'ADMIN')];
const customer = [...guard, requireRole('CUSTOMER')];
const idParams = validate({ params: v.idParams });

router.get('/categories', guard, h(c.categories));

// canned replies (staff only)
router.get('/canned-replies', staff, h(c.listCanned));
router.post('/canned-replies', staff, validate({ body: v.cannedBody }), h(c.createCanned));
router.patch(
  '/canned-replies/:id',
  staff,
  validate({ params: v.idParams, body: v.cannedUpdateBody }),
  h(c.updateCanned),
);
router.delete('/canned-replies/:id', staff, idParams, h(c.deleteCanned));

// attachments: metadata + authenticated, scoped download
router.get('/attachments/:id', guard, idParams, h(c.attachment));
router.get('/attachments/:id/download', guard, idParams, h(c.downloadAttachment));

// tickets (fixed paths before :id)
router.get('/tickets', guard, validate({ query: v.listQuery }), h(c.list));
router.post(
  '/tickets',
  customer,
  writeLimiter,
  uploadFiles,
  validate({ body: v.createBody }),
  h(c.create),
);
router.get('/tickets/export.csv', staff, validate({ query: v.exportQuery }), h(c.exportCsv));
router.get('/tickets/assignees', staff, validate({ query: v.assigneesQuery }), h(c.assignees));
router.post('/tickets/bulk-assign', staff, validate({ body: v.bulkAssignBody }), h(c.bulkAssign));
router.get('/tickets/:id', guard, idParams, h(c.get));
router.patch(
  '/tickets/:id',
  staff,
  validate({ params: v.idParams, body: v.updateBody }),
  h(c.update),
);
router.post(
  '/tickets/:id/messages',
  guard,
  writeLimiter,
  uploadFiles,
  validate({ params: v.idParams, body: v.messageBody }),
  h(c.addMessage),
);
router.post(
  '/tickets/:id/status',
  guard,
  validate({ params: v.idParams, body: v.statusBody }),
  h(c.changeStatus),
);
router.post(
  '/tickets/:id/assign',
  staff,
  validate({ params: v.idParams, body: v.assignBody }),
  h(c.assign),
);
router.post(
  '/tickets/:id/feedback',
  customer,
  validate({ params: v.idParams, body: v.feedbackBody }),
  h(c.feedback),
);
router.post(
  '/tickets/:id/merge',
  staff,
  validate({ params: v.idParams, body: v.mergeBody }),
  h(c.merge),
);

export default router;

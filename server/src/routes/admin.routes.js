import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as c from '../controllers/admin.controller.js';
import * as v from '../validators/admin.validators.js';
import { inviteBody } from '../validators/auth.validators.js';
import * as faqc from '../controllers/faq.controller.js';
import { settingsBody } from '../validators/faq.validators.js';
import { create as createInvitation } from '../controllers/invitation.controller.js';

// Everything under /admin is ADMIN-only. These resources (organizations, projects, users,
// invitations) are administrative, not tenant data, so they use the base Prisma client; the
// requireRole gate is what protects them.
const router = Router();
router.use(authenticate, requireRole('ADMIN'));

const id = validate({ params: v.idParams });

router.get('/organizations', validate({ query: v.orgListQuery }), h(c.listOrgs));
router.post('/organizations', validate({ body: v.orgCreateBody }), h(c.createOrg));
router.get('/organizations/:id', id, h(c.getOrg));
router.patch(
  '/organizations/:id',
  validate({ params: v.idParams, body: v.orgUpdateBody }),
  h(c.updateOrg),
);

router.get('/projects', validate({ query: v.projectListQuery }), h(c.listProjects));
router.post('/projects', validate({ body: v.projectCreateBody }), h(c.createProject));
router.get('/projects/:id', id, h(c.getProject));
router.patch(
  '/projects/:id',
  validate({ params: v.idParams, body: v.projectUpdateBody }),
  h(c.updateProject),
);
router.post(
  '/projects/:id/members',
  validate({ params: v.idParams, body: v.addMembersBody }),
  h(c.addMembers),
);
router.delete(
  '/projects/:id/members/:userId',
  validate({ params: v.memberParams }),
  h(c.removeMember),
);

router.get('/users', validate({ query: v.userListQuery }), h(c.listUsers));
router.post('/users', validate({ body: v.userCreateBody }), h(c.createUser));
router.get('/users/:id', id, h(c.getUser));
router.patch(
  '/users/:id',
  validate({ params: v.idParams, body: v.userUpdateBody }),
  h(c.updateUser),
);
router.put(
  '/users/:id/projects',
  validate({ params: v.idParams, body: v.setUserProjectsBody }),
  h(c.setUserProjects),
);
router.post('/users/:id/deactivate', id, h(c.deactivateUser));
router.post('/users/:id/reactivate', id, h(c.reactivateUser));
router.post('/users/:id/unlock', id, h(c.unlockUser));
router.post(
  '/users/:id/approve',
  validate({ params: v.idParams, body: v.approveBody }),
  h(c.approveUser),
);
router.post(
  '/users/:id/reject',
  validate({ params: v.idParams, body: v.rejectBody }),
  h(c.rejectUser),
);

router.get('/audit-logs', validate({ query: v.auditListQuery }), h(c.listAudit));
router.get('/audit-logs/filters', h(c.auditFilters));

router.get('/categories', h(c.listCategories));
router.post('/categories', validate({ body: v.categoryCreateBody }), h(c.createCategory));
router.patch(
  '/categories/:id',
  validate({ params: v.idParams, body: v.categoryUpdateBody }),
  h(c.updateCategory),
);
router.get('/sla-policies', h(c.listSla));
router.put('/sla-policies', validate({ body: v.slaBody }), h(c.upsertSla));
router.delete('/sla-policies/:id', id, h(c.deleteSla));

router.get('/settings', h(faqc.getSettings));
router.patch('/settings', validate({ body: settingsBody }), h(faqc.updateSettings));

router.get('/invitations', validate({ query: v.invitationListQuery }), h(c.listInvitations));
router.post('/invitations', validate({ body: inviteBody }), h(createInvitation));
router.delete('/invitations/:id', id, h(c.revokeInvitation));

export default router;

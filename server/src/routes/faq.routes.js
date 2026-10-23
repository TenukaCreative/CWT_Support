import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireProject, requireRole } from '../middleware/auth.js';
import * as c from '../controllers/faq.controller.js';
import * as v from '../validators/faq.validators.js';

// Every route is scoped (req.db) and needs a selected project. Customers get published content
// of their project + global; staff get drafts too, within their projects.
const router = Router();
router.use(authenticate, requireProject);

const staff = requireRole('SUPPORT', 'ADMIN');
const params = validate({ params: v.idParams });

// reading & search
router.get('/categories', h(c.categories));
router.get('/articles', validate({ query: v.listQuery }), h(c.articles));
router.get('/articles/:id', params, h(c.article));
router.get('/search', validate({ query: v.searchQuery }), h(c.search));
router.get('/suggest', validate({ query: v.suggestQuery }), h(c.suggest));
router.post(
  '/search-logs/:id/click',
  validate({ params: v.idParams, body: v.clickBody }),
  h(c.click),
);
router.post(
  '/articles/:id/vote',
  requireRole('CUSTOMER'),
  validate({ params: v.idParams, body: v.voteBody }),
  h(c.vote),
);

// staff management
router.get('/manage/config', staff, h(c.config));
router.post('/manage/preview', staff, validate({ body: v.previewBody }), h(c.preview));
router.get('/manage/search-insights', staff, validate({ query: v.insightsQuery }), h(c.insights));
router.post('/manage/articles', staff, validate({ body: v.articleCreateBody }), h(c.createArticle));
router.patch(
  '/manage/articles/:id',
  staff,
  validate({ params: v.idParams, body: v.articleUpdateBody }),
  h(c.updateArticle),
);
router.delete('/manage/articles/:id', staff, params, h(c.deleteArticle));
router.post(
  '/manage/categories',
  staff,
  validate({ body: v.categoryCreateBody }),
  h(c.createCategory),
);
router.patch(
  '/manage/categories/:id',
  staff,
  validate({ params: v.idParams, body: v.categoryUpdateBody }),
  h(c.updateCategory),
);
router.delete('/manage/categories/:id', staff, params, h(c.deleteCategory));

export default router;

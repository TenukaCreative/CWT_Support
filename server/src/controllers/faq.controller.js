import * as faq from '../services/faq.service.js';
import * as manage from '../services/faqManage.service.js';
import * as settings from '../services/settings.service.js';
import { audit } from '../services/audit.service.js';

const ctx = (req) => ({ scope: req.auth.scope, user: req.auth.user });

// reading
export const categories = async (req, res) => res.json(await faq.listCategories(req.db));
export const articles = async (req, res) => res.json(await faq.listArticles(req.db, req.query));
export const article = async (req, res) =>
  res.json({ article: await faq.getArticle(req.db, req.auth.user, req.params.id) });
export const search = async (req, res) =>
  res.json(await faq.searchArticles(req.db, ctx(req), { ...req.query, mode: 'all', log: true }));
export const suggest = async (req, res) =>
  res.json(await faq.searchArticles(req.db, ctx(req), { ...req.query, mode: 'any' }));
export const click = async (req, res) => {
  await faq.recordClick(req.db, req.auth.user, req.params.id, req.body.articleId);
  res.status(204).end();
};
export const vote = async (req, res) =>
  res.json(await faq.vote(req.db, req.auth.user, req.params.id, req.body.helpful));

// management
export const config = async (_req, res) => res.json(await manage.manageConfig());
export const preview = (req, res) => res.json(manage.previewMarkdown(req.body.answer));
export const createArticle = async (req, res) =>
  res.status(201).json({ article: await manage.createArticle(req.db, ctx(req), req.body) });
export const updateArticle = async (req, res) =>
  res.json({ article: await manage.updateArticle(req.db, ctx(req), req.params.id, req.body) });
export const deleteArticle = async (req, res) => {
  await manage.deleteArticle(req.db, ctx(req), req.params.id);
  res.status(204).end();
};
export const createCategory = async (req, res) =>
  res.status(201).json({ category: await manage.createCategory(req.db, ctx(req), req.body) });
export const updateCategory = async (req, res) =>
  res.json({ category: await manage.updateCategory(req.db, ctx(req), req.params.id, req.body) });
export const deleteCategory = async (req, res) => {
  await manage.deleteCategory(req.db, ctx(req), req.params.id);
  res.status(204).end();
};
export const insights = async (req, res) =>
  res.json(await manage.searchInsights(req.db, req.query));

// admin settings
export const getSettings = async (_req, res) =>
  res.json({ settings: await settings.getAllSettings() });
export const updateSettings = async (req, res) => {
  for (const [key, value] of Object.entries(req.body)) await settings.setSetting(key, value);
  await audit(req.auth.user.id, 'settings.update', 'Setting', null, req.body);
  res.json({ settings: await settings.getAllSettings() });
};

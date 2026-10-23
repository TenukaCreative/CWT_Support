import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { renderMarkdown } from '../lib/markdown.js';
import { audit } from './audit.service.js';
import { getSetting } from './settings.service.js';
import { detail } from './faq.service.js';

// Staff content management. `db` is the scoped client: staff can only touch content of projects
// in their scope; global (projectId = null) content is admin-only and needs "All projects".

const withCategory = { category: { select: { id: true, name: true } } };

function assertCanWriteProject(scope, actor, projectId) {
  if (projectId !== null) return; // project scope is enforced by the scoped client itself
  if (actor.role !== 'ADMIN') throw forbidden('Only administrators can manage global content');
  if (scope.projectIds !== null)
    throw forbidden('Switch to "All projects" to manage global content');
}

// A category is usable if it is global, or belongs to the same project as the article.
async function assertCategoryFits(db, categoryId, projectId) {
  if (!categoryId) return;
  const cat = await db.faqCategory.findUnique({ where: { id: categoryId } });
  if (!cat)
    throw badRequest('Category not found', [{ path: 'categoryId', message: 'Unknown category' }]);
  if (cat.projectId !== null && cat.projectId !== projectId) {
    throw badRequest('That category belongs to a different project', [
      { path: 'categoryId', message: 'Wrong project' },
    ]);
  }
}

// Optional publish-approval flow (admin setting): support may draft, only admins publish.
async function assertMayPublish(actor, wantsPublished, wasPublished) {
  if (!wantsPublished || wasPublished || actor.role === 'ADMIN') return;
  if (await getSetting('faqRequireApproval'))
    throw forbidden('Publishing requires administrator approval. Save as a draft instead.');
}

export const manageConfig = async () => ({
  requireApproval: await getSetting('faqRequireApproval'),
});

export const previewMarkdown = (answer) => ({ answerHtml: renderMarkdown(answer) });

// ───────────── articles ─────────────

export async function createArticle(db, { scope, user }, data) {
  assertCanWriteProject(scope, user, data.projectId);
  await assertCategoryFits(db, data.categoryId ?? null, data.projectId);
  await assertMayPublish(user, data.status === 'PUBLISHED', false);

  const article = await db.faqArticle.create({
    data: {
      projectId: data.projectId,
      categoryId: data.categoryId ?? null,
      question: data.question,
      answer: data.answer,
      status: data.status,
      sortOrder: data.sortOrder,
    },
    include: withCategory,
  });
  await audit(user.id, 'faq.article.create', 'FaqArticle', article.id, {
    projectId: data.projectId,
    status: data.status,
  });
  return detail(article);
}

export async function updateArticle(db, { user }, id, data) {
  const existing = await db.faqArticle.findUnique({ where: { id } });
  if (!existing) throw notFound('Article not found');
  if (data.categoryId !== undefined)
    await assertCategoryFits(db, data.categoryId, existing.projectId);
  if (data.status)
    await assertMayPublish(user, data.status === 'PUBLISHED', existing.status === 'PUBLISHED');

  const article = await db.faqArticle.update({ where: { id }, data, include: withCategory });
  await audit(user.id, 'faq.article.update', 'FaqArticle', id, {
    fields: Object.keys(data),
    status: article.status,
  });
  return detail(article);
}

export async function deleteArticle(db, { user }, id) {
  const existing = await db.faqArticle.findUnique({ where: { id } });
  if (!existing) throw notFound('Article not found');
  await db.faqArticle.delete({ where: { id } });
  await audit(user.id, 'faq.article.delete', 'FaqArticle', id, {
    question: existing.question,
    projectId: existing.projectId,
  });
}

// ───────────── categories ─────────────

export async function createCategory(db, { scope, user }, data) {
  assertCanWriteProject(scope, user, data.projectId);
  const cat = await db.faqCategory.create({ data });
  await audit(user.id, 'faq.category.create', 'FaqCategory', cat.id, {
    name: data.name,
    projectId: data.projectId,
  });
  return cat;
}

export async function updateCategory(db, { user }, id, data) {
  if (!(await db.faqCategory.findUnique({ where: { id } }))) throw notFound('Category not found');
  const cat = await db.faqCategory.update({ where: { id }, data });
  await audit(user.id, 'faq.category.update', 'FaqCategory', id, { fields: Object.keys(data) });
  return cat;
}

// Articles in a deleted category become uncategorised (FK is ON DELETE SET NULL).
export async function deleteCategory(db, { user }, id) {
  const cat = await db.faqCategory.findUnique({ where: { id } });
  if (!cat) throw notFound('Category not found');
  await db.faqCategory.delete({ where: { id } });
  await audit(user.id, 'faq.category.delete', 'FaqCategory', id, { name: cat.name });
}

// ───────────── "what are customers failing to find?" ─────────────

// Either a rolling `days` window or an explicit [from, to) range (used by the dashboards).
export async function searchInsights(db, { days = 30, from, to, projectId }) {
  const window =
    from && to ? { gte: from, lt: to } : { gte: new Date(Date.now() - days * 86_400_000) };
  const base = { createdAt: window, ...(projectId ? { projectId } : {}) };

  const [zero, top, searches, zeroResults, clicked, ticketsAfter, deflected] = await Promise.all([
    db.kbSearchLog.groupBy({
      by: ['query'],
      where: { ...base, resultCount: 0 },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _count: { query: 'desc' } },
      take: 25,
    }),
    db.kbSearchLog.groupBy({
      by: ['query'],
      where: base,
      _count: { _all: true },
      _avg: { resultCount: true },
      orderBy: { _count: { query: 'desc' } },
      take: 25,
    }),
    db.kbSearchLog.count({ where: base }),
    db.kbSearchLog.count({ where: { ...base, resultCount: 0 } }),
    db.kbSearchLog.count({ where: { ...base, clickedArticleId: { not: null } } }),
    db.kbSearchLog.count({ where: { ...base, createdTicketAfter: true } }),
    // Deflected = the customer read an article and did NOT go on to raise a ticket.
    db.kbSearchLog.count({
      where: { ...base, clickedArticleId: { not: null }, createdTicketAfter: false },
    }),
  ]);

  return {
    days,
    totals: {
      searches,
      zeroResults,
      clicked,
      ticketsAfter,
      deflected,
      deflectionRate: searches > 0 ? Math.round((deflected / searches) * 1000) / 10 : null,
    },
    zeroResults: zero.map((r) => ({
      query: r.query,
      count: r._count._all,
      lastSearchedAt: r._max.createdAt,
    })),
    topQueries: top.map((r) => ({
      query: r.query,
      count: r._count._all,
      avgResults: Math.round((r._avg.resultCount ?? 0) * 10) / 10,
    })),
  };
}

import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import { escapeLike, paginate } from '../lib/pagination.js';
import { plainSnippet, renderMarkdown } from '../lib/markdown.js';

// `db` is ALWAYS the scoped client (req.db): customers only ever get published articles of their
// project plus published global ones; staff get drafts within their projects. Nothing here
// re-implements those rules, which is the point.

const withCategory = { category: { select: { id: true, name: true } } };

const summary = (a) => ({
  id: a.id,
  projectId: a.projectId,
  categoryId: a.categoryId,
  category: a.category ?? null,
  question: a.question,
  snippet: plainSnippet(a.answer),
  status: a.status,
  sortOrder: a.sortOrder,
  helpfulYes: a.helpfulYes,
  helpfulNo: a.helpfulNo,
  updatedAt: a.updatedAt,
});

export const detail = (a, myVote = null) => ({
  ...summary(a),
  answer: a.answer, // raw markdown, for the staff editor
  answerHtml: renderMarkdown(a.answer),
  createdAt: a.createdAt,
  myVote,
});

// ───────────── browse ─────────────

export async function listCategories(db) {
  const [categories, counts] = await Promise.all([
    db.faqCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    db.faqArticle.groupBy({ by: ['categoryId'], _count: { _all: true } }),
  ]);
  const byId = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  return {
    categories: categories.map((c) => ({ ...c, articleCount: byId.get(c.id) ?? 0 })),
    uncategorizedCount: byId.get(null) ?? 0,
  };
}

export function listArticles(db, query) {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.categoryId
      ? { categoryId: query.categoryId === 'none' ? null : query.categoryId }
      : {}),
    ...(query.projectId
      ? { projectId: query.projectId === 'global' ? null : query.projectId }
      : {}),
    ...(query.q
      ? {
          OR: [
            { question: { contains: escapeLike(query.q), mode: 'insensitive' } },
            { answer: { contains: escapeLike(query.q), mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  return paginate(db.faqArticle, { where, query, include: withCategory }, db).then((p) => ({
    ...p,
    items: p.items.map(summary),
  }));
}

export async function getArticle(db, user, id) {
  const article = await db.faqArticle.findUnique({ where: { id }, include: withCategory });
  if (!article) throw notFound('Article not found');
  // The vote row is the caller's own data; the article lookup above already proved scope.
  const vote =
    user.role === 'CUSTOMER'
      ? await prisma.faqVote.findUnique({
          where: { articleId_userId: { articleId: id, userId: user.id } },
        })
      : null;
  return detail(article, vote ? vote.helpful : null);
}

// ───────────── search ─────────────

const tokens = (q) =>
  (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 2).slice(0, 8);

// Builds a to_tsquery string from user text. Only letters/digits survive tokenising, so no
// operator (& | ! ( ) :) can be injected. The LAST word becomes a prefix match so results
// appear while the user is still typing. mode "all" = every word must match; "any" = looser.
export function buildTsQuery(q, mode = 'all') {
  const t = tokens(q);
  if (t.length === 0) return null;
  return t.map((w, i) => (i === t.length - 1 ? `${w}:*` : w)).join(mode === 'any' ? ' | ' : ' & ');
}

// Raw SQL ranks and narrows to ids ONLY. The actual rows are then read through the scoped
// client, so even a mistake in this SQL cannot expose anything outside the caller's scope.
async function rankedIds(scope, tsq, limit) {
  const projectCond =
    scope.projectIds === null
      ? Prisma.empty
      : scope.projectIds.length > 0
        ? Prisma.sql`AND ("FaqArticle"."projectId" IS NULL OR "FaqArticle"."projectId" IN (${Prisma.join(scope.projectIds)}))`
        : Prisma.sql`AND "FaqArticle"."projectId" IS NULL`;
  const statusCond =
    scope.role === 'CUSTOMER' ? Prisma.sql`AND "FaqArticle"."status" = 'PUBLISHED'` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT "FaqArticle"."id" FROM "FaqArticle", to_tsquery('english', ${tsq}) AS query
    WHERE "FaqArticle"."searchVector" @@ query ${projectCond} ${statusCond}
    ORDER BY ts_rank_cd("FaqArticle"."searchVector", query) DESC, "FaqArticle"."helpfulYes" DESC, "FaqArticle"."id"
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

export async function searchArticles(db, { scope, user }, { q, limit, mode = 'all', log = true }) {
  const tsq = buildTsQuery(q, mode);
  let items = [];
  if (tsq) {
    const ids = await rankedIds(scope, tsq, limit);
    const rows = await db.faqArticle.findMany({
      where: { id: { in: ids } },
      include: withCategory,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    items = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map(summary);
  }
  const searchLogId = log ? await logSearch(db, { scope, user }, q, items.length) : null;
  return { items, total: items.length, searchLogId };
}

// ───────────── search analytics ─────────────

// Only customers' searches are analytics (what clients can't find). Logging is skipped for
// staff and when no single project is selected (no project to attribute the search to).
async function logSearch(db, { scope, user }, query, resultCount) {
  if (
    scope.role !== 'CUSTOMER' ||
    !scope.activeProjectId ||
    scope.activeProjectId === 'ALL' ||
    scope.projectIds.length === 0
  )
    return null;
  const normalized = query.trim().toLowerCase().slice(0, 200);

  // The same person repeating a search within a minute (typing, retrying) is one search.
  const recent = await db.kbSearchLog.findFirst({
    where: {
      userId: user.id,
      query: normalized,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) {
    if (recent.resultCount !== resultCount)
      await db.kbSearchLog.update({ where: { id: recent.id }, data: { resultCount } });
    return recent.id;
  }
  const row = await db.kbSearchLog.create({
    data: { projectId: scope.activeProjectId, userId: user.id, query: normalized, resultCount },
  });
  return row.id;
}

export async function recordClick(db, user, logId, articleId) {
  if (!(await db.faqArticle.findUnique({ where: { id: articleId }, select: { id: true } })))
    throw notFound('Article not found');
  const { count } = await db.kbSearchLog.updateMany({
    where: { id: logId, userId: user.id },
    data: { clickedArticleId: articleId },
  });
  if (count === 0) throw notFound('Search not found');
}

// Called by the ticket service (Phase 5) when a ticket is created after a search.
export async function markTicketCreated(db, user, logId) {
  await db.kbSearchLog.updateMany({
    where: { id: logId, userId: user.id },
    data: { createdTicketAfter: true },
  });
}

// ───────────── helpfulness votes ─────────────

export async function vote(db, user, articleId, helpful) {
  const article = await db.faqArticle.findUnique({
    where: { id: articleId },
    select: { id: true },
  });
  if (!article) throw notFound('Article not found');

  return prisma.$transaction(async (tx) => {
    const key = { articleId_userId: { articleId, userId: user.id } };
    const existing = await tx.faqVote.findUnique({ where: key });
    if (!existing || existing.helpful !== helpful) {
      await tx.faqVote.upsert({
        where: key,
        create: { articleId, userId: user.id, helpful },
        update: { helpful },
      });
      // First vote adds to one counter; changing a vote moves one unit from the old counter to the new.
      const yes = (helpful ? 1 : 0) - (existing?.helpful === true ? 1 : 0);
      const no = (!helpful ? 1 : 0) - (existing && existing.helpful === false ? 1 : 0);
      await tx.faqArticle.update({
        where: { id: articleId },
        data: { helpfulYes: { increment: yes }, helpfulNo: { increment: no } },
      });
    }
    const a = await tx.faqArticle.findUnique({
      where: { id: articleId },
      select: { helpfulYes: true, helpfulNo: true },
    });
    return { ...a, myVote: helpful };
  });
}

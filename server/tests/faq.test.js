import request from 'supertest';
import { createApp } from '../src/app.js';
import { renderMarkdown, plainSnippet } from '../src/lib/markdown.js';
import { buildTsQuery } from '../src/services/faq.service.js';
import { prisma, resetDb, makeWorld, authAs } from './helpers.js';

const app = createApp();
let w;

const mk = (projectId, question, answer = 'Some answer text', status = 'PUBLISHED', extra = {}) =>
  prisma.faqArticle.create({ data: { projectId, question, answer, status, ...extra } });
const faq = (method, path, headers) => request(app)[method](`/api/v1/faq${path}`).set(headers);
const questions = (res) => res.body.items.map((i) => i.question);

beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  await prisma.faqArticle.deleteMany(); // start each test from an empty KB (world FAQs not needed here)
});
afterAll(() => prisma.$disconnect());

describe('markdown rendering', () => {
  it('renders markdown and strips scripts, handlers, images and dangerous links', () => {
    const html = renderMarkdown(
      [
        '# Title',
        '**bold** and _em_',
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '![pic](http://evil.example/p.png)',
        '[bad](javascript:alert(1))',
        '[good](https://example.com)',
        '<a href="https://x.test" onclick="steal()">x</a>',
        '<iframe src="https://evil.example"></iframe>',
      ].join('\n\n'),
    );
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<h2>Title</h2>'); // h1 demoted
    expect(html).not.toMatch(/<script|onerror|onclick|<img|<iframe|javascript:/i);
    expect(html).toMatch(
      /<a href="https:\/\/example.com" rel="noopener noreferrer nofollow" target="_blank">good<\/a>/,
    );
  });

  it('builds readable plain-text snippets', () => {
    expect(plainSnippet('**Hello** [world](https://x.test) & <b>more</b>')).toBe(
      'Hello world & more',
    );
    expect(plainSnippet('a'.repeat(300), 50)).toHaveLength(50);
  });
});

describe('tsquery builder', () => {
  it('only keeps words, so operators cannot be injected', () => {
    expect(buildTsQuery("reset & password | !(x) ' ; DROP", 'all')).toBe(
      'reset & password & drop:*',
    );
    expect(buildTsQuery('how reset pass', 'any')).toBe('how | reset | pass:*');
    expect(buildTsQuery('!!! &&', 'all')).toBeNull();
  });
});

describe('search', () => {
  it('finds by stemmed words and ranks title matches above body matches', async () => {
    const body = await mk(
      w.A1.id,
      'Billing questions',
      'You can also reset your password from billing.',
    );
    const title = await mk(w.A1.id, 'How do I reset my password?', 'Use the forgot password link.');
    await mk(w.A1.id, 'Unrelated article', 'Nothing about it');
    const h = await authAs(app, w.bob, w.A1.id);

    const res = await faq('get', '/search?q=resetting passwords', h);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.id)).toEqual([title.id, body.id]);
    expect(res.body.items[0].snippet).toContain('forgot password');
    expect(res.body.items[0].answerHtml).toBeUndefined(); // lists carry snippets, not full bodies
  });

  it('matches while typing (prefix on the last word)', async () => {
    await mk(w.A1.id, 'How do I reset my password?');
    const h = await authAs(app, w.bob, w.A1.id);
    expect(questions(await faq('get', '/search?q=passw', h))).toHaveLength(1);
    expect(questions(await faq('get', '/search?q=reset%20pass', h))).toHaveLength(1);
  });

  it('suggest uses looser any-word matching; search requires all words', async () => {
    await mk(w.A1.id, 'Update billing address', 'Open settings.');
    const h = await authAs(app, w.bob, w.A1.id);
    expect(questions(await faq('get', '/search?q=billing%20invoice', h))).toHaveLength(0);
    expect(questions(await faq('get', '/suggest?q=billing%20invoice', h))).toHaveLength(1);
  });

  it('survives hostile and degenerate input', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    for (const q of [
      "' OR 1=1 --",
      '& | ! ( ) :*',
      'the',
      '"; DROP TABLE "FaqArticle"; --',
      '😀😀',
    ]) {
      const res = await faq('get', `/search?q=${encodeURIComponent(q)}`, h);
      expect(res.status).toBe(200);
    }
    expect(await prisma.faqArticle.count()).toBe(0); // table still exists
    expect((await faq('get', '/search?q=', h)).status).toBe(400);
    expect((await faq('get', '/search', h)).status).toBe(400);
  });

  it('never returns another project, another org, or drafts to customers', async () => {
    await mk(w.A1.id, 'Shared keyword mine');
    await mk(w.A2.id, 'Shared keyword sibling project');
    await mk(w.B1.id, 'Shared keyword other org');
    await mk(w.A1.id, 'Shared keyword draft', 'x', 'DRAFT');
    await mk(null, 'Shared keyword global');
    await mk(null, 'Shared keyword global draft', 'x', 'DRAFT');
    const h = await authAs(app, w.bob, w.A1.id);
    expect(questions(await faq('get', '/search?q=shared keyword', h)).sort()).toEqual([
      'Shared keyword global',
      'Shared keyword mine',
    ]);
  });

  it('staff see drafts in their projects only; admin ALL sees everything', async () => {
    await mk(w.A1.id, 'Zebra mine draft', 'x', 'DRAFT');
    await mk(w.A2.id, 'Zebra sibling');
    await mk(w.B1.id, 'Zebra other org');
    const support = await authAs(app, w.supportA, w.A1.id);
    expect(questions(await faq('get', '/search?q=zebra', support))).toEqual(['Zebra mine draft']);
    const both = await authAs(app, w.supportBoth, 'ALL');
    expect(questions(await faq('get', '/search?q=zebra', both)).sort()).toEqual([
      'Zebra mine draft',
      'Zebra sibling',
    ]);
    const admin = await authAs(app, w.admin, 'ALL');
    expect(await faq('get', '/search?q=zebra', admin).then((r) => r.body.total)).toBe(3);
  });

  it('requires a selected project', async () => {
    const h = await authAs(app, w.alice); // multi-project, none picked
    expect((await faq('get', '/search?q=anything', h)).status).toBe(409);
  });
});

describe('search logging', () => {
  it('logs customer searches including zero-result ones, and dedupes repeats', async () => {
    await mk(w.A1.id, 'Reset password');
    const h = await authAs(app, w.bob, w.A1.id);
    const hit = await faq('get', '/search?q=Reset Password', h);
    const miss = await faq('get', '/search?q=invoice pdf', h);
    await faq('get', '/search?q=invoice pdf', h);
    expect(hit.body.searchLogId).toBeTruthy();

    const logs = await prisma.kbSearchLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(logs.map((l) => [l.query, l.resultCount, l.projectId, l.userId])).toEqual([
      ['reset password', 1, w.A1.id, w.bob.id],
      ['invoice pdf', 0, w.A1.id, w.bob.id],
    ]);
    expect(miss.body.searchLogId).toBe(logs[1].id);
  });

  it('suggestions only log when asked; staff searches are never logged', async () => {
    const h = await authAs(app, w.bob, w.A1.id);
    await faq('get', '/suggest?q=printer broken', h);
    expect(await prisma.kbSearchLog.count()).toBe(0);
    const res = await faq('get', '/suggest?q=printer broken&log=true', h);
    expect(res.body.searchLogId).toBeTruthy();
    expect(await prisma.kbSearchLog.count()).toBe(1);

    const staff = await authAs(app, w.supportA, w.A1.id);
    await faq('get', '/search?q=something else', staff);
    expect(await prisma.kbSearchLog.count()).toBe(1);
  });

  it('records which article was opened from a search, only for visible articles', async () => {
    const a = await mk(w.A1.id, 'Reset password');
    const hidden = await mk(w.B1.id, 'Reset password elsewhere');
    const h = await authAs(app, w.bob, w.A1.id);
    const { body } = await faq('get', '/search?q=reset', h);
    expect(
      (await faq('post', `/search-logs/${body.searchLogId}/click`, h).send({ articleId: a.id }))
        .status,
    ).toBe(204);
    expect(
      (await prisma.kbSearchLog.findUnique({ where: { id: body.searchLogId } })).clickedArticleId,
    ).toBe(a.id);
    expect(
      (
        await faq('post', `/search-logs/${body.searchLogId}/click`, h).send({
          articleId: hidden.id,
        })
      ).status,
    ).toBe(404);

    const other = await authAs(app, w.alice, w.A1.id); // someone else's log id
    expect(
      (await faq('post', `/search-logs/${body.searchLogId}/click`, other).send({ articleId: a.id }))
        .status,
    ).toBe(404);
  });
});

describe('browse', () => {
  it('lists categories with counts of VISIBLE articles only', async () => {
    const c = await prisma.faqCategory.create({
      data: { projectId: w.A1.id, name: 'Billing', sortOrder: 1 },
    });
    await prisma.faqCategory.create({ data: { projectId: w.A2.id, name: 'Sibling' } });
    await mk(w.A1.id, 'Published one', 'x', 'PUBLISHED', { categoryId: c.id });
    await mk(w.A1.id, 'Draft one', 'x', 'DRAFT', { categoryId: c.id });
    await mk(w.A1.id, 'No category');

    const cust = await faq('get', '/categories', await authAs(app, w.bob, w.A1.id));
    expect(cust.body.categories.map((x) => [x.name, x.articleCount])).toEqual([['Billing', 1]]);
    expect(cust.body.uncategorizedCount).toBe(1);

    const staff = await faq('get', '/categories', await authAs(app, w.supportA, w.A1.id));
    expect(staff.body.categories[0].articleCount).toBe(2);
  });

  it('paginates and filters articles; customers cannot request drafts', async () => {
    for (let i = 1; i <= 5; i++)
      await mk(w.A1.id, `Article number ${i}`, 'x', 'PUBLISHED', { sortOrder: i });
    await mk(w.A1.id, 'Hidden draft article', 'x', 'DRAFT');
    const h = await authAs(app, w.bob, w.A1.id);
    const p1 = await faq('get', '/articles?limit=2&page=1', h);
    expect(questions(p1)).toEqual(['Article number 1', 'Article number 2']);
    expect(p1.body).toMatchObject({ total: 5, totalPages: 3 });
    expect((await faq('get', '/articles?status=DRAFT', h)).body.total).toBe(0);
    expect((await faq('get', '/articles?q=NUMBER 3', h)).body.total).toBe(1);
    expect((await faq('get', '/articles?sort=answer', h)).status).toBe(400);
  });

  it("article detail returns sanitised HTML and the caller's own vote", async () => {
    const a = await mk(w.A1.id, 'Safe article', 'Hello <script>alert(1)</script> **world**');
    const h = await authAs(app, w.bob, w.A1.id);
    const res = await faq('get', `/articles/${a.id}`, h);
    expect(res.body.article.answerHtml).toContain('<strong>world</strong>');
    expect(res.body.article.answerHtml).not.toContain('script');
    expect(res.body.article.myVote).toBeNull();
    await faq('post', `/articles/${a.id}/vote`, h).send({ helpful: false });
    expect((await faq('get', `/articles/${a.id}`, h)).body.article.myVote).toBe(false);
  });
});

describe('helpfulness votes', () => {
  it('counts one vote per user and moves counters when the vote changes', async () => {
    const a = await mk(w.A1.id, 'Votable');
    const bob = await authAs(app, w.bob, w.A1.id);
    const alice = await authAs(app, w.alice, w.A1.id);
    const vote = (h, helpful) => faq('post', `/articles/${a.id}/vote`, h).send({ helpful });

    expect((await vote(bob, true)).body).toMatchObject({
      helpfulYes: 1,
      helpfulNo: 0,
      myVote: true,
    });
    expect((await vote(bob, true)).body).toMatchObject({ helpfulYes: 1, helpfulNo: 0 }); // idempotent
    expect((await vote(alice, true)).body).toMatchObject({ helpfulYes: 2, helpfulNo: 0 });
    expect((await vote(bob, false)).body).toMatchObject({
      helpfulYes: 1,
      helpfulNo: 1,
      myVote: false,
    });
    expect(await prisma.faqVote.count()).toBe(2);
  });

  it('is customers only, and only for articles they can see', async () => {
    const mine = await mk(w.A1.id, 'Mine');
    const other = await mk(w.B1.id, 'Other org');
    const draft = await mk(w.A1.id, 'Draft', 'x', 'DRAFT');
    const bob = await authAs(app, w.bob, w.A1.id);
    expect(
      (await faq('post', `/articles/${other.id}/vote`, bob).send({ helpful: true })).status,
    ).toBe(404);
    expect(
      (await faq('post', `/articles/${draft.id}/vote`, bob).send({ helpful: true })).status,
    ).toBe(404);
    expect(
      (await faq('post', `/articles/${mine.id}/vote`, bob).send({ helpful: 'yes' })).status,
    ).toBe(400);
    const staff = await authAs(app, w.supportA, w.A1.id);
    expect(
      (await faq('post', `/articles/${mine.id}/vote`, staff).send({ helpful: true })).status,
    ).toBe(403);
  });
});

describe('staff management', () => {
  const body = (over = {}) => ({
    projectId: w.A1.id,
    question: 'How do I export data?',
    answer: 'Use **Export**.',
    status: 'DRAFT',
    ...over,
  });

  it('is forbidden to customers and unauthenticated users', async () => {
    const bob = await authAs(app, w.bob, w.A1.id);
    expect((await faq('post', '/manage/articles', bob).send(body())).status).toBe(403);
    expect((await faq('get', '/manage/search-insights', bob)).status).toBe(403);
    expect((await faq('post', '/manage/preview', bob).send({ answer: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/v1/faq/manage/articles').send(body())).status).toBe(401);
  });

  it('support creates, edits and deletes articles in their own project, with audit entries', async () => {
    const h = await authAs(app, w.supportA, w.A1.id);
    const created = await faq('post', '/manage/articles', h).send(
      body({ status: 'PUBLISHED', sortOrder: 3 }),
    );
    expect(created.status).toBe(201);
    const id = created.body.article.id;
    expect(created.body.article).toMatchObject({ status: 'PUBLISHED', sortOrder: 3 });
    expect(created.body.article.answerHtml).toContain('<strong>Export</strong>');

    // Search picks it up immediately (generated tsvector)
    const bob = await authAs(app, w.bob, w.A1.id);
    expect(questions(await faq('get', '/search?q=export', bob))).toEqual(['How do I export data?']);

    const upd = await faq('patch', `/manage/articles/${id}`, h).send({
      answer: 'Now: **Download**',
      status: 'DRAFT',
    });
    expect(upd.body.article).toMatchObject({ status: 'DRAFT' });
    expect(questions(await faq('get', '/search?q=export', bob))).toHaveLength(0); // unpublished, hidden at once

    expect((await faq('delete', `/manage/articles/${id}`, h)).status).toBe(204);
    expect((await faq('get', `/articles/${id}`, h)).status).toBe(404);
    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(['faq.article.create', 'faq.article.update', 'faq.article.delete']);
  });

  it('keeps support inside their projects and away from global content', async () => {
    const h = await authAs(app, w.supportA, w.A1.id);
    expect(
      (await faq('post', '/manage/articles', h).send(body({ projectId: w.A2.id }))).status,
    ).toBe(404);
    expect(
      (await faq('post', '/manage/articles', h).send(body({ projectId: w.B1.id }))).status,
    ).toBe(404);
    expect((await faq('post', '/manage/articles', h).send(body({ projectId: null }))).status).toBe(
      403,
    );

    const foreign = await mk(w.B1.id, 'Foreign article');
    expect(
      (
        await faq('patch', `/manage/articles/${foreign.id}`, h).send({
          question: 'Hijacked question',
        })
      ).status,
    ).toBe(404);
    expect((await faq('delete', `/manage/articles/${foreign.id}`, h)).status).toBe(404);
    expect((await prisma.faqArticle.findUnique({ where: { id: foreign.id } })).question).toBe(
      'Foreign article',
    );
  });

  it('admin manages global content only in "All projects" mode', async () => {
    const all = await authAs(app, w.admin, 'ALL');
    expect(
      (
        await faq('post', '/manage/articles', all).send(
          body({ projectId: null, status: 'PUBLISHED' }),
        )
      ).status,
    ).toBe(201);
    const one = await authAs(app, w.admin, w.A1.id);
    expect(
      (await faq('post', '/manage/articles', one).send(body({ projectId: null }))).status,
    ).toBe(403);
    const bob = await authAs(app, w.bob, w.A1.id);
    expect(questions(await faq('get', '/search?q=export', bob))).toHaveLength(1); // global is visible to customers
  });

  it('validates input', async () => {
    const h = await authAs(app, w.supportA, w.A1.id);
    expect((await faq('post', '/manage/articles', h).send(body({ question: 'hi' }))).status).toBe(
      400,
    );
    expect((await faq('post', '/manage/articles', h).send(body({ answer: '' }))).status).toBe(400);
    expect(
      (await faq('post', '/manage/articles', h).send({ ...body(), helpfulYes: 99 })).status,
    ).toBe(400);
  });

  it("checks that the category fits the article's project", async () => {
    const mine = await prisma.faqCategory.create({ data: { projectId: w.A1.id, name: 'Mine' } });
    const global = await prisma.faqCategory.create({ data: { projectId: null, name: 'Global' } });
    const sibling = await prisma.faqCategory.create({
      data: { projectId: w.A2.id, name: 'Sibling' },
    });
    const h = await authAs(app, w.supportBoth, 'ALL');
    expect(
      (await faq('post', '/manage/articles', h).send(body({ categoryId: mine.id }))).status,
    ).toBe(201);
    expect(
      (await faq('post', '/manage/articles', h).send(body({ categoryId: global.id }))).status,
    ).toBe(201);
    expect(
      (await faq('post', '/manage/articles', h).send(body({ categoryId: sibling.id }))).status,
    ).toBe(400);
  });

  it('optional approval flow: support can draft but not publish; admin can', async () => {
    const admin = await authAs(app, w.admin, 'ALL');
    expect(
      (
        await request(app)
          .patch('/api/v1/admin/settings')
          .set(admin)
          .send({ faqRequireApproval: true })
      ).body.settings.faqRequireApproval,
    ).toBe(true);

    const h = await authAs(app, w.supportA, w.A1.id);
    expect((await faq('get', '/manage/config', h)).body).toEqual({ requireApproval: true });
    expect(
      (await faq('post', '/manage/articles', h).send(body({ status: 'PUBLISHED' }))).status,
    ).toBe(403);
    const draft = await faq('post', '/manage/articles', h).send(body());
    expect(draft.status).toBe(201);
    const id = draft.body.article.id;
    expect(
      (await faq('patch', `/manage/articles/${id}`, h).send({ status: 'PUBLISHED' })).status,
    ).toBe(403);
    expect(
      (
        await faq('patch', `/manage/articles/${id}`, h).send({
          answer: 'Edited while still a draft',
        })
      ).status,
    ).toBe(200);

    expect(
      (await faq('patch', `/manage/articles/${id}`, admin).send({ status: 'PUBLISHED' })).status,
    ).toBe(200);
    // already published: support may still edit text (no new publish transition)
    expect(
      (await faq('patch', `/manage/articles/${id}`, h).send({ answer: 'Typo fix' })).status,
    ).toBe(200);
  });

  it('settings endpoint is admin-only and strict', async () => {
    const support = await authAs(app, w.supportA, w.A1.id);
    expect((await request(app).get('/api/v1/admin/settings').set(support)).status).toBe(403);
    const admin = await authAs(app, w.admin, 'ALL');
    expect(
      (await request(app).patch('/api/v1/admin/settings').set(admin).send({ nope: true })).status,
    ).toBe(400);
    expect(
      (await request(app).get('/api/v1/admin/settings').set(admin)).body.settings
        .faqRequireApproval,
    ).toBe(false);
  });

  it('category CRUD with scope rules; deleting a category keeps its articles', async () => {
    const h = await authAs(app, w.supportA, w.A1.id);
    const cat = await faq('post', '/manage/categories', h).send({
      projectId: w.A1.id,
      name: 'Billing',
      sortOrder: 2,
    });
    expect(cat.status).toBe(201);
    expect(
      (await faq('post', '/manage/categories', h).send({ projectId: w.B1.id, name: 'Nope' }))
        .status,
    ).toBe(404);
    expect(
      (await faq('post', '/manage/categories', h).send({ projectId: null, name: 'Global' })).status,
    ).toBe(403);
    expect(
      (
        await faq('patch', `/manage/categories/${cat.body.category.id}`, h).send({
          name: 'Payments',
        })
      ).body.category.name,
    ).toBe('Payments');

    const art = await mk(w.A1.id, 'Categorised article', 'x', 'PUBLISHED', {
      categoryId: cat.body.category.id,
    });
    expect((await faq('delete', `/manage/categories/${cat.body.category.id}`, h)).status).toBe(204);
    expect((await prisma.faqArticle.findUnique({ where: { id: art.id } })).categoryId).toBeNull();

    const foreign = await prisma.faqCategory.create({
      data: { projectId: w.B1.id, name: 'Foreign' },
    });
    expect((await faq('delete', `/manage/categories/${foreign.id}`, h)).status).toBe(404);
  });

  it('previews markdown safely', async () => {
    const h = await authAs(app, w.supportA, w.A1.id);
    const res = await faq('post', '/manage/preview', h).send({
      answer: '**hi** <script>x</script>',
    });
    expect(res.body.answerHtml).toBe('<p><strong>hi</strong> </p>\n');
  });
});

describe('search insights', () => {
  it('summarises zero-result queries, scoped to what the staff member may see', async () => {
    const log = (projectId, userId, query, resultCount, extra = {}) =>
      prisma.kbSearchLog.create({ data: { projectId, userId, query, resultCount, ...extra } });
    await log(w.A1.id, w.bob.id, 'invoice pdf', 0);
    await log(w.A1.id, w.alice.id, 'invoice pdf', 0, { createdTicketAfter: true });
    await log(w.A1.id, w.bob.id, 'reset password', 3, {
      clickedArticleId: (await mk(w.A1.id, 'Reset password')).id,
    });
    await log(w.B1.id, w.carol.id, 'secret org b query', 0);
    await log(w.A1.id, w.bob.id, 'ancient query', 0, {
      createdAt: new Date(Date.now() - 90 * 86_400_000),
    });

    const support = await authAs(app, w.supportA, w.A1.id);
    const res = await faq('get', '/manage/search-insights?days=30', support);
    expect(res.body.zeroResults).toEqual([
      { query: 'invoice pdf', count: 2, lastSearchedAt: expect.any(String) },
    ]);
    expect(res.body.totals).toEqual({
      searches: 3,
      zeroResults: 2,
      clicked: 1,
      ticketsAfter: 1,
      deflected: 1,
      deflectionRate: 33.3,
    });
    expect(res.body.topQueries[0]).toMatchObject({ query: 'invoice pdf', count: 2, avgResults: 0 });
    expect(JSON.stringify(res.body)).not.toContain('secret org b');

    const admin = await authAs(app, w.admin, 'ALL');
    expect(
      (await faq('get', '/manage/search-insights?days=30', admin)).body.zeroResults.map(
        (z) => z.query,
      ),
    ).toContain('secret org b query');
    expect((await faq('get', '/manage/search-insights?days=0', admin)).status).toBe(400);
  });
});

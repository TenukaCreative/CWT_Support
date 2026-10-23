import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import { err, mockApi, renderApp, sessionFor, project } from './utils.jsx';

expect.extend(matchers);

// Automated accessibility scan (axe-core, WCAG 2.x A/AA rules) over every main screen, in the
// states a person actually sees. jsdom cannot compute colours, so the contrast rule is off here;
// contrast was checked by hand against the Tailwind palette (see docs/ACCESSIBILITY.md).
const AXE = { rules: { 'color-contrast': { enabled: false } } };
const check = async (container) => expect(await axe(container, AXE)).toHaveNoViolations();

const proj = project('p1', 'Acme Website', 'ACME-WEB');
const proj2 = project('p2', 'Acme Mobile App', 'ACME-APP');
const session = (role, over = {}) => ({
  'POST /auth/refresh': [
    200,
    sessionFor(role, {
      projects: [proj],
      activeProjectId: 'p1',
      user: { ...sessionFor(role).user, organization: { id: 'o1', name: 'Acme Corp' } },
      ...over,
    }),
  ],
});
const page = (items, extra = {}) => [
  200,
  { items, page: 1, limit: 15, total: items.length, totalPages: 1, ...extra },
];

const ticketRow = (id = 't1', over = {}) => ({
  id,
  number: `ACME-WEB-000${id.slice(1)}`,
  subject: 'Printer is on fire',
  status: 'OPEN',
  priority: 'HIGH',
  assignee: { id: 's1', name: 'Sam' },
  mergedInto: null,
  createdBy: {
    id: 'u1',
    name: 'Test User',
    email: 't@x.co',
    organization: { id: 'o1', name: 'Acme Corp' },
  },
  project: { id: 'p1', key: 'ACME-WEB', name: 'Acme Website' },
  updatedAt: '2026-01-02T10:00:00Z',
  sla: {
    overall: 'WARNING',
    paused: false,
    firstResponse: { state: 'MET', dueAt: '2026-01-02T12:00:00Z' },
    resolution: { state: 'WARNING', dueAt: new Date(Date.now() + 3600_000).toISOString() },
  },
  ...over,
});
const ticketDetail = (staff) => [
  200,
  {
    ticket: {
      ...ticketRow(),
      description: 'It smokes.',
      category: { id: 'c1', name: 'Bug' },
      firstResponseAt: '2026-01-01T11:00:00Z',
      resolvedAt: null,
      closedAt: null,
      createdAt: '2026-01-01T10:00:00Z',
      allowedStatuses: staff ? ['IN_PROGRESS', 'RESOLVED'] : ['CLOSED'],
      canReply: true,
      canAddNote: staff,
      reopenUntil: null,
      feedback: null,
      canRate: false,
    },
    messages: [
      {
        id: 'm1',
        type: 'PUBLIC',
        body: 'It smokes.',
        createdAt: '2026-01-01T10:00:00Z',
        author: { id: 'u1', name: 'Test User', role: 'CUSTOMER' },
        attachments: [{ id: 'a1', filename: 'photo.png', mimeType: 'image/png', size: 2048 }],
      },
      ...(staff
        ? [
            {
              id: 'm2',
              type: 'INTERNAL_NOTE',
              body: 'Check the fuse.',
              createdAt: '2026-01-01T11:00:00Z',
              author: { id: 's1', name: 'Sam', role: 'SUPPORT' },
              attachments: [],
            },
          ]
        : []),
      {
        id: 'm3',
        type: 'SYSTEM',
        body: 'Status changed from Open to In progress',
        createdAt: '2026-01-01T12:00:00Z',
        author: { id: 's1', name: 'Sam', role: 'SUPPORT' },
        attachments: [],
      },
    ],
    events: [
      {
        id: 'e1',
        type: 'CREATED',
        toValue: 'OPEN',
        createdAt: '2026-01-01T10:00:00Z',
        actor: { id: 'u1', name: 'Test User' },
      },
    ],
  },
];
const article = {
  id: 'a1',
  projectId: 'p1',
  categoryId: null,
  category: { id: 'c1', name: 'Billing' },
  question: 'How do I pay?',
  snippet: 'Use the Billing page.',
  status: 'PUBLISHED',
  sortOrder: 0,
  helpfulYes: 1,
  helpfulNo: 0,
  updatedAt: '2026-01-01T00:00:00Z',
};
const user = (over) => ({
  id: 'u7',
  name: 'Dave',
  email: 'dave@x.co',
  role: 'CUSTOMER',
  status: 'ACTIVE',
  organization: { id: 'o1', name: 'Acme Corp' },
  projects: [{ id: 'p1', key: 'ACME-WEB', name: 'Acme Website' }],
  emailVerifiedAt: '2026-01-01T00:00:00Z',
  lastLoginAt: null,
  lockedUntil: null,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});
const sla = {
  overall: 'OK',
  paused: false,
  firstResponse: { state: 'OK', dueAt: null },
  resolution: { state: 'OK', dueAt: null },
};
void sla;

const overview = [
  200,
  {
    range: { from: '2026-03-01', to: '2026-03-03', days: 3, granularity: 'day' },
    totals: {
      created: 7,
      resolved: 4,
      openNow: 5,
      reopens: 1,
      resolutionEvents: 4,
      reopenRate: 25,
    },
    responseTimes: {
      firstResponse: { avgHours: 2.1, medianHours: 1, count: 5 },
      resolution: { avgHours: 12.7, medianHours: 9, count: 4 },
    },
    sla: {
      firstResponse: { met: 4, total: 6, rate: 66.7 },
      resolution: { met: 3, total: 5, rate: 60 },
    },
    series: [
      { date: '2026-03-01', created: 2, resolved: 0 },
      { date: '2026-03-02', created: 4, resolved: 1 },
      { date: '2026-03-03', created: 1, resolved: 3 },
    ],
    statuses: [
      { status: 'OPEN', count: 2 },
      { status: 'IN_PROGRESS', count: 0 },
      { status: 'WAITING_ON_CUSTOMER', count: 1 },
      { status: 'RESOLVED', count: 3 },
      { status: 'CLOSED', count: 1 },
      { status: 'REOPENED', count: 0 },
    ],
    categories: [{ name: 'Bug', count: 3 }],
  },
];
const csat = [
  200,
  {
    range: {},
    summary: {
      count: 4,
      average: 3.5,
      distribution: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: 1 })),
    },
    byAgent: [{ id: 'a', name: 'Sam', count: 2, average: 3.5 }],
    byProject: [],
    byCategory: [],
    byMonth: [{ id: '2026-03', name: '2026-03', count: 4, average: 3.5 }],
  },
];
const deflection = [
  200,
  {
    totals: {
      searches: 20,
      zeroResults: 4,
      clicked: 10,
      ticketsAfter: 3,
      deflected: 7,
      deflectionRate: 35,
    },
    zeroResults: [{ query: 'invoice pdf', count: 3, lastSearchedAt: '2026-03-02T00:00:00Z' }],
    topQueries: [],
  },
];

describe('public screens', () => {
  const anon = { 'POST /auth/refresh': err(401, 'UNAUTHORIZED', 'no') };

  it.each([
    ['login', '/login', 'Log in'],
    ['forgot password', '/forgot-password', 'Forgot password'],
    [
      'reset password',
      '/reset-password?token=tok_abcdefghijklmnopqrstuvwxyz',
      'Choose a new password',
    ],
    ['not found', '/no/such/page', 'Page not found'],
  ])('%s', async (_n, path, heading) => {
    mockApi(anon);
    const { container } = renderApp(path);
    await screen.findByRole('heading', { name: heading });
    await check(container);
  });

  it('register (with organisations loaded and with validation errors showing)', async () => {
    mockApi({
      ...anon,
      'GET /auth/organizations': [200, { organizations: [{ id: 'o1', name: 'Acme' }] }],
    });
    const { container } = renderApp('/register');
    await screen.findByRole('option', { name: 'Acme' });
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText('Name is required');
    await check(container);
  });

  it('login with an error message', async () => {
    mockApi({ ...anon, 'POST /auth/login': err(401, 'UNAUTHORIZED', 'Invalid email or password') });
    const { container } = renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByRole('alert');
    await check(container);
  });

  it('accept invite and verify email', async () => {
    mockApi({
      ...anon,
      'GET /auth/invitations/inv_abcdefghijklmnopqrstuvwxyz': [
        200,
        {
          email: 'i@x.co',
          role: 'CUSTOMER',
          organization: 'Acme',
          projects: [{ key: 'ACME-WEB', name: 'Web' }],
        },
      ],
      'POST /auth/verify-email': [200, { status: 'PENDING' }],
    });
    const invite = renderApp('/accept-invite?token=inv_abcdefghijklmnopqrstuvwxyz');
    await screen.findByLabelText('Full name');
    await check(invite.container);
    invite.unmount();
    const verify = renderApp('/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    await screen.findByText(/administrator still needs to approve/);
    await check(verify.container);
  });

  it('project picker', async () => {
    mockApi({
      'POST /auth/refresh': [
        200,
        sessionFor('CUSTOMER', { projects: [proj, proj2], needsProjectSelection: true }),
      ],
    });
    const { container } = renderApp('/select-project');
    await screen.findByRole('heading', { name: 'Choose a project' });
    await check(container);
  });
});

describe('customer screens', () => {
  const base = (extra = {}) => ({
    ...session('CUSTOMER'),
    'GET /tickets': page([ticketRow('t1', { sla: undefined })]),
    'GET /faq/categories': [
      200,
      {
        categories: [{ id: 'c1', name: 'Billing', projectId: 'p1', sortOrder: 0, articleCount: 1 }],
        uncategorizedCount: 0,
      },
    ],
    'GET /faq/articles': page([article]),
    'GET /categories': [200, { categories: [{ id: 'c1', name: 'Bug', projectId: null }] }],
    'GET /faq/suggest': [200, { items: [article], total: 1, searchLogId: null }],
    ...extra,
  });

  it.each([
    ['dashboard', '/app', /Welcome to Acme Website/],
    ['help center', '/app/faq', 'Help Center'],
    ['ticket list', '/app/tickets', 'Tickets'],
    ['new ticket', '/app/tickets/new', 'New ticket'],
    ['profile', '/app/profile', 'Profile'],
  ])('%s', async (_n, path, heading) => {
    mockApi(base());
    const { container } = renderApp(path);
    await screen.findByRole('heading', { name: heading });
    await screen.findByRole('navigation', { name: 'Main' });
    await check(container);
  });

  it('help center search results and an article page', async () => {
    mockApi(
      base({
        'GET /faq/search': [200, { items: [article], total: 1, searchLogId: 'l1' }],
        'GET /faq/articles/a1': [
          200,
          {
            article: {
              ...article,
              answer: 'x',
              answerHtml: '<p>Pay on the <strong>Billing</strong> page.</p><ul><li>one</li></ul>',
              createdAt: '2026-01-01T00:00:00Z',
              myVote: null,
            },
          },
        ],
      }),
    );
    const search = renderApp('/app/faq?q=pay');
    await screen.findByRole('link', { name: 'How do I pay?' });
    await check(search.container);
    search.unmount();
    const art = renderApp('/app/faq/a1');
    await screen.findByRole('heading', { name: 'How do I pay?' });
    await check(art.container);
  });

  it('new ticket with FAQ suggestions showing', async () => {
    mockApi(base());
    const { container } = renderApp('/app/tickets/new');
    await userEvent.type(await screen.findByLabelText('Subject'), 'how do I pay');
    await screen.findByRole('region', { name: 'Suggested articles' }, { timeout: 2000 });
    await check(container);
  });

  it('ticket detail: open ticket, resolved ticket with rating form', async () => {
    mockApi(base({ 'GET /tickets/t1': ticketDetail(false) }));
    const open = renderApp('/app/tickets/t1');
    await screen.findByRole('heading', { name: /Printer is on fire/ });
    await check(open.container);
    open.unmount();

    const resolved = ticketDetail(false);
    Object.assign(resolved[1].ticket, {
      status: 'RESOLVED',
      canReply: false,
      allowedStatuses: ['REOPENED', 'CLOSED'],
      reopenUntil: '2099-01-01T00:00:00Z',
      canRate: true,
      resolvedAt: '2026-01-02T00:00:00Z',
    });
    mockApi(base({ 'GET /tickets/t1': resolved }));
    const rate = renderApp('/app/tickets/t1');
    await screen.findByRole('form', { name: 'Rate the support you received' });
    await check(rate.container);
  });

  it('notifications page and the bell dropdown', async () => {
    const n = {
      id: 'n1',
      type: 'TICKET_REPLY',
      title: 'New reply',
      body: 'Hello',
      readAt: null,
      createdAt: new Date().toISOString(),
      ticket: { id: 't1', number: 'ACME-WEB-0001', projectId: 'p1' },
    };
    mockApi(
      base({
        'GET /notifications/unread-count': [200, { unread: 1 }],
        'GET /notifications': page([n]),
      }),
    );
    const { container } = renderApp('/app/notifications');
    await screen.findByText('New reply');
    await userEvent.click(await screen.findByRole('button', { name: /Notifications, 1 unread/ }));
    await screen.findByRole('region', { name: 'Recent notifications' });
    await check(container);
  });
});

describe('staff screens', () => {
  const base = (role = 'SUPPORT', extra = {}) => ({
    ...session(role, { activeProjectId: 'ALL', projects: [proj, proj2] }),
    'GET /tickets': page([
      ticketRow('t1'),
      ticketRow('t2', { status: 'WAITING_ON_CUSTOMER', priority: 'URGENT', assignee: null }),
    ]),
    'GET /categories': [200, { categories: [{ id: 'c1', name: 'Bug', projectId: null }] }],
    'GET /tickets/assignees': [200, { assignees: [{ id: 's1', name: 'Sam', role: 'SUPPORT' }] }],
    'GET /canned-replies': [
      200,
      {
        replies: [
          {
            id: 'r1',
            title: 'Greeting',
            body: 'Hello',
            scope: 'GLOBAL',
            ownerId: null,
            project: null,
          },
          {
            id: 'r2',
            title: 'Mine',
            body: 'Mine',
            scope: 'PERSONAL',
            ownerId: 'u1',
            project: null,
          },
        ],
      },
    ],
    'GET /faq/articles': page([article]),
    'GET /faq/categories': [
      200,
      {
        categories: [{ id: 'c1', name: 'Billing', projectId: 'p1', sortOrder: 0, articleCount: 1 }],
        uncategorizedCount: 0,
      },
    ],
    'GET /faq/manage/config': [200, { requireApproval: false }],
    'GET /reports/me': [
      200,
      {
        ...overview[1],
        csat: {
          count: 2,
          average: 4,
          distribution: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: 1 })),
        },
      },
    ],
    ...extra,
  });

  it.each([
    ['queue', '/app/queue', 'Ticket queue'],
    ['my assigned tickets', '/app/assigned', 'My assigned tickets'],
    ['canned replies', '/app/canned-replies', 'Canned replies'],
    ['faq manager', '/app/faq-manager', 'FAQ manager'],
    ['my stats', '/app/stats', 'My stats'],
  ])('%s', async (_n, path, heading) => {
    mockApi(base());
    const { container } = renderApp(path);
    await screen.findByRole('heading', { name: heading });
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    await check(container);
  });

  it('queue with rows selected (bulk bar showing)', async () => {
    mockApi(base());
    const { container } = renderApp('/app/queue');
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Select all tickets on this page' }),
    );
    await screen.findByRole('region', { name: 'Bulk actions' });
    await check(container);
  });

  it('staff ticket detail (internal note, SLA panel, controls) and the merge dialog', async () => {
    mockApi(base('SUPPORT', { 'GET /tickets/t1': ticketDetail(true) }));
    const { container } = renderApp('/app/tickets/t1');
    await screen.findByRole('region', { name: 'Staff controls' });
    await check(container);
    await userEvent.click(screen.getByRole('button', { name: /Merge into another ticket/ }));
    await screen.findByRole('dialog', { hidden: true });
    await check(container);
  });

  it('FAQ manager: categories tab and the article editor dialog', async () => {
    mockApi(base());
    const { container } = renderApp('/app/faq-manager');
    await userEvent.click(await screen.findByRole('tab', { name: 'Categories' }));
    await screen.findByText('Billing');
    await check(container);
    await userEvent.click(screen.getByRole('tab', { name: 'Articles' }));
    await userEvent.click(await screen.findByRole('button', { name: 'New article' }));
    await screen.findByRole('dialog', { hidden: true });
    await check(container);
  });
});

describe('admin screens', () => {
  const base = (extra = {}) => ({
    ...session('ADMIN', { activeProjectId: 'ALL', projects: [proj, proj2] }),
    'GET /reports/overview': overview,
    'GET /reports/csat': csat,
    'GET /reports/deflection': deflection,
    'GET /admin/users': page([
      user(),
      user({ id: 'u9', name: 'Locked', email: 'l@x.co', lockedUntil: '2099-01-01T00:00:00Z' }),
    ]),
    'GET /admin/organizations': page([
      {
        id: 'o1',
        name: 'Acme Corp',
        domain: 'acme.com',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00Z',
        _count: { projects: 2, users: 5 },
      },
    ]),
    'GET /admin/projects': page([
      {
        id: 'p1',
        key: 'ACME-WEB',
        name: 'Acme Website',
        status: 'ACTIVE',
        organization: { id: 'o1', name: 'Acme Corp' },
        _count: { members: 3, tickets: 7 },
      },
    ]),
    'GET /admin/projects/p1': [
      200,
      {
        project: {
          id: 'p1',
          key: 'ACME-WEB',
          name: 'Acme Website',
          description: 'Site',
          status: 'ACTIVE',
          organization: { id: 'o1', name: 'Acme Corp', status: 'ACTIVE' },
          members: [{ id: 'u3', name: 'Sam', email: 's@x.co', role: 'SUPPORT', status: 'ACTIVE' }],
        },
      },
    ],
    'GET /admin/invitations': page([
      {
        id: 'i1',
        email: 'n@x.co',
        role: 'CUSTOMER',
        organization: null,
        projects: [],
        invitedBy: { id: 'a', name: 'Ada' },
        expiresAt: '2099-01-01T00:00:00Z',
      },
    ]),
    'GET /admin/audit-logs/filters': [
      200,
      { actions: ['user.create'], entities: ['User'], actors: [{ id: 'a1', name: 'Ada' }] },
    ],
    'GET /admin/audit-logs': page([
      {
        id: 'l1',
        createdAt: '2026-03-02T10:00:00Z',
        action: 'user.create',
        entity: 'User',
        entityId: 'u-2',
        metadata: { a: 1 },
        actor: { id: 'a1', name: 'Ada', email: 'a@x.co', role: 'ADMIN' },
      },
    ]),
    'GET /admin/categories': [
      200,
      {
        categories: [
          {
            id: 'c1',
            name: 'Bug',
            projectId: null,
            project: null,
            isActive: true,
            _count: { tickets: 3 },
          },
        ],
      },
    ],
    'GET /admin/sla-policies': [
      200,
      {
        policies: [],
        defaults: {
          URGENT: { firstResponseHours: 1, resolutionHours: 4 },
          HIGH: { firstResponseHours: 4, resolutionHours: 8 },
          MEDIUM: { firstResponseHours: 8, resolutionHours: 24 },
          LOW: { firstResponseHours: 24, resolutionHours: 72 },
        },
      },
    ],
    'GET /admin/settings': [
      200,
      {
        settings: {
          reopenWindowDays: 7,
          autoCloseAfterDays: 7,
          feedbackEditWindowHours: 24,
          faqRequireApproval: false,
        },
      },
    ],
    ...extra,
  });

  it('dashboard with charts, tables and the table view opened', async () => {
    mockApi(base());
    const { container } = renderApp('/app/admin');
    await screen.findByText('Tickets created');
    await screen.findByText('invoice pdf');
    await userEvent.click(screen.getAllByText('View data as a table')[0]);
    await check(container);
  });

  it.each([
    ['users', '/app/admin/users', 'Users'],
    ['pending approvals', '/app/admin/pending', 'Pending registrations'],
    ['organizations', '/app/admin/organizations', 'Organizations'],
    ['projects', '/app/admin/projects', 'Projects'],
    ['audit log', '/app/admin/audit', 'Audit log'],
  ])('%s', async (_n, path, heading) => {
    mockApi(base());
    const { container } = renderApp(path);
    await screen.findByRole('heading', { name: heading });
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    await check(container);
  });

  it('project detail, user dialog, and every settings tab', async () => {
    mockApi(base());
    const detail = renderApp('/app/admin/projects/p1');
    await screen.findByRole('heading', { name: /ACME-WEB/ });
    await check(detail.container);
    detail.unmount();

    const users = renderApp('/app/admin/users');
    await userEvent.click(await screen.findByRole('button', { name: 'Create user' }));
    await screen.findByRole('dialog', { hidden: true });
    await check(users.container);
    users.unmount();

    const settings = renderApp('/app/admin/settings');
    await screen.findByText('Bug');
    await check(settings.container);
    await userEvent.click(screen.getByRole('tab', { name: 'SLA targets' }));
    await screen.findByLabelText('High first response hours');
    await check(settings.container);
    await userEvent.click(screen.getByRole('tab', { name: 'General' }));
    await screen.findByRole('button', { name: 'Save settings' });
    await check(settings.container);
    void within;
  });
});

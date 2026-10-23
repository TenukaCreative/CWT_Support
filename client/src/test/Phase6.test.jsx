import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SlaBadge, { describeClock, mostUrgentClock } from '../components/SlaBadge.jsx';
import { fmtDuration } from '../lib/time.js';
import { mockApi, renderApp, sessionFor, project } from './utils.jsx';

const proj = project('p1', 'Acme Website', 'ACME-WEB');
const proj2 = project('p2', 'Acme Mobile App', 'ACME-APP');
const as = (role, over) => ({
  'POST /auth/refresh': [
    200,
    sessionFor(role, { projects: [proj], activeProjectId: 'p1', ...over }),
  ],
});
const page = (items, extra = {}) => [
  200,
  { items, page: 1, limit: 20, total: items.length, totalPages: 1, ...extra },
];
const minutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

describe('time and SLA helpers', () => {
  it('formats durations compactly', () => {
    expect(fmtDuration(30_000)).toBe('<1m');
    expect(fmtDuration(45 * 60_000)).toBe('45m');
    expect(fmtDuration(200 * 60_000)).toBe('3h 20m');
    expect(fmtDuration(-(26 * 60 + 5) * 60_000)).toBe('1d 2h'); // sign ignored
  });

  it('tips into overdue on the client the moment time runs out, even if the server said OK', () => {
    const now = Date.now();
    const c = describeClock(
      'resolution',
      { state: 'OK', dueAt: new Date(now - 90 * 60_000).toISOString() },
      now,
    );
    expect(c.state).toBe('BREACHED');
    expect(c.short).toBe('Overdue 1h 30m');
  });

  it('picks the most urgent clock and ignores finished ones', () => {
    const sla = {
      firstResponse: { state: 'MET', dueAt: minutes(-60) },
      resolution: { state: 'WARNING', dueAt: minutes(30) },
    };
    expect(mostUrgentClock(sla, Date.now()).state).toBe('WARNING');
  });

  it('badge renders warnings, breaches and paused states; nothing for finished work', () => {
    const show = (sla) => render(<SlaBadge sla={sla} />);
    const { unmount } = show({
      firstResponse: { state: 'NONE' },
      resolution: { state: 'BREACHED', dueAt: minutes(-120) },
    });
    expect(screen.getByText(/Overdue 2h/)).toBeInTheDocument();
    expect(screen.getByText(/SLA breached/)).toBeInTheDocument(); // announced to screen readers
    unmount();
    const w2 = show({
      firstResponse: { state: 'NONE' },
      resolution: { state: 'PAUSED', dueAt: minutes(60) },
    });
    expect(screen.getByText('Paused')).toBeInTheDocument();
    w2.unmount();
    show({
      firstResponse: { state: 'MET', dueAt: minutes(-5) },
      resolution: { state: 'MET', dueAt: minutes(-5) },
    });
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('SLA in the staff UI', () => {
  const row = (id, sla) => ({
    id,
    number: `ACME-WEB-000${id}`,
    subject: `Ticket ${id}`,
    status: 'OPEN',
    priority: 'HIGH',
    assignee: null,
    mergedInto: null,
    createdBy: { id: 'c', name: 'Bob' },
    updatedAt: '2026-01-02T10:00:00Z',
    sla,
  });
  const clock = (state, dueAt) => ({ state, dueAt, remainingMs: null });

  it('the queue shows an SLA column with countdowns and breaches', async () => {
    mockApi({
      ...as('SUPPORT'),
      'GET /tickets': page([
        row(1, {
          overall: 'BREACHED',
          firstResponse: clock('NONE', null),
          resolution: clock('BREACHED', minutes(-95)),
          paused: false,
        }),
        row(2, {
          overall: 'WARNING',
          firstResponse: clock('NONE', null),
          resolution: clock('WARNING', minutes(40)),
          paused: false,
        }),
      ]),
      'GET /categories': [200, { categories: [] }],
      'GET /tickets/assignees': [200, { assignees: [] }],
    });
    renderApp('/app/queue');
    expect(await screen.findByRole('columnheader', { name: 'SLA' })).toBeInTheDocument();
    expect(screen.getByText('Overdue 1h 35m')).toBeInTheDocument();
    expect(screen.getByText(/^Due 4\dm$|^Due 39m$/)).toBeInTheDocument();
  });

  it('the staff ticket page has an SLA panel and customer feedback; customers get neither', async () => {
    const detail = (extra, userExtra = {}) => [
      200,
      {
        ticket: {
          id: 't1',
          number: 'ACME-WEB-0001',
          subject: 'S',
          description: 'd',
          status: 'RESOLVED',
          priority: 'MEDIUM',
          project: { id: 'p1', key: 'ACME-WEB', name: 'Acme Website' },
          category: null,
          createdBy: { id: 'c1', name: 'Bob', email: 'bob@x.co' },
          assignee: null,
          mergedInto: null,
          createdAt: '2026-01-01T10:00:00Z',
          resolvedAt: '2026-01-01T12:00:00Z',
          allowedStatuses: ['REOPENED', 'CLOSED'],
          canReply: true,
          canAddNote: true,
          ...extra,
        },
        messages: [],
        events: [],
        ...userExtra,
      },
    ];
    mockApi({
      ...as('SUPPORT'),
      'GET /tickets/t1': detail({
        sla: {
          overall: 'MET',
          firstResponse: clock('MET_LATE', minutes(-300)),
          resolution: clock('MET', minutes(-100)),
          paused: false,
        },
        feedback: { rating: 4, comment: 'Quick fix, thanks', editableUntil: minutes(60) },
        canRate: false,
      }),
      'GET /canned-replies': [200, { replies: [] }],
      'GET /tickets/assignees': [200, { assignees: [] }],
      'GET /categories': [200, { categories: [] }],
    });
    const { unmount } = renderApp('/app/tickets/t1');
    const sla = await screen.findByRole('region', { name: 'SLA' });
    expect(within(sla).getByText('First response met late')).toBeInTheDocument();
    const fb = screen.getByRole('region', { name: 'Customer feedback' });
    expect(within(fb).getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument();
    expect(within(fb).getByText('Quick fix, thanks')).toBeInTheDocument();
    unmount();

    mockApi({
      ...as('CUSTOMER'),
      'GET /tickets/t1': detail({
        createdBy: { id: 'u1', name: 'Test User' },
        canAddNote: false,
        allowedStatuses: ['CLOSED'],
        canReply: false,
        canRate: false,
        feedback: null,
      }),
    });
    renderApp('/app/tickets/t1');
    await screen.findByRole('heading', { name: /ACME-WEB-0001/ });
    expect(screen.queryByRole('region', { name: 'SLA' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Customer feedback' })).not.toBeInTheDocument();
  });
});

describe('feedback', () => {
  const resolved = (extra = {}) => [
    200,
    {
      ticket: {
        id: 't1',
        number: 'ACME-WEB-0001',
        subject: 'Printer',
        description: 'd',
        status: 'RESOLVED',
        priority: 'MEDIUM',
        project: { id: 'p1', key: 'ACME-WEB', name: 'Acme Website' },
        category: null,
        createdBy: { id: 'u1', name: 'Test User' },
        assignee: null,
        mergedInto: null,
        createdAt: '2026-01-01T10:00:00Z',
        resolvedAt: '2026-01-02T10:00:00Z',
        allowedStatuses: ['REOPENED', 'CLOSED'],
        canReply: false,
        canAddNote: false,
        reopenUntil: '2099-01-01T00:00:00Z',
        canRate: true,
        feedback: null,
        ...extra,
      },
      messages: [],
      events: [],
    },
  ];

  it('asks for a rating, requires stars, and submits rating plus comment', async () => {
    const calls = mockApi({
      ...as('CUSTOMER'),
      'GET /tickets/t1': resolved(),
      'POST /tickets/t1/feedback': [201, { feedback: { rating: 5 } }],
    });
    renderApp('/app/tickets/t1');
    const form = await screen.findByRole('form', { name: 'Rate the support you received' });
    await userEvent.click(within(form).getByRole('button', { name: 'Submit rating' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Choose a rating');
    expect(calls.some((c) => c.key.endsWith('/feedback'))).toBe(false);

    await userEvent.click(within(form).getByRole('radio', { name: '5 stars' }));
    await userEvent.type(within(form).getByLabelText(/Comment/), 'Great help');
    await userEvent.click(within(form).getByRole('button', { name: 'Submit rating' }));
    await screen.findByText('Thanks for your feedback!');
    expect(calls.find((c) => c.key === 'POST /tickets/t1/feedback').body).toEqual({
      rating: 5,
      comment: 'Great help',
    });
  });

  it('the email link (?rate=1) puts focus on the first star', async () => {
    mockApi({ ...as('CUSTOMER'), 'GET /tickets/t1': resolved() });
    renderApp('/app/tickets/t1?rate=1');
    await screen.findByRole('form', { name: 'Rate the support you received' });
    await waitFor(() => expect(screen.getByRole('radio', { name: '1 star' })).toHaveFocus());
  });

  it('an existing rating can be updated inside the window and shows when it locks', async () => {
    mockApi({
      ...as('CUSTOMER'),
      'GET /tickets/t1': resolved({
        feedback: { rating: 3, comment: 'ok', editableUntil: '2099-01-01T00:00:00Z' },
      }),
    });
    renderApp('/app/tickets/t1');
    const form = await screen.findByRole('form', { name: 'Rate the support you received' });
    expect(within(form).getByRole('radio', { name: '3 stars' })).toBeChecked();
    expect(within(form).getByRole('button', { name: 'Update rating' })).toBeInTheDocument();
    expect(within(form).getByText(/You can change this until/)).toBeInTheDocument();
  });

  it('after the window the rating is read-only', async () => {
    mockApi({
      ...as('CUSTOMER'),
      'GET /tickets/t1': resolved({
        canRate: false,
        feedback: { rating: 2, comment: 'slow', editableUntil: '2020-01-01T00:00:00Z' },
      }),
    });
    renderApp('/app/tickets/t1');
    const panel = await screen.findByRole('region', { name: 'Your feedback' });
    expect(within(panel).getByRole('img', { name: '2 out of 5 stars' })).toBeInTheDocument();
    expect(within(panel).getByText(/can no longer be changed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rating/i })).not.toBeInTheDocument();
  });
});

describe('notification bell', () => {
  const notif = (over) => ({
    id: 'n1',
    type: 'TICKET_REPLY',
    title: 'New reply on ACME-WEB-0001',
    body: 'We fixed it',
    readAt: null,
    createdAt: new Date().toISOString(),
    ticket: { id: 't1', number: 'ACME-WEB-0001', projectId: 'p1' },
    ...over,
  });
  const base = (extra = {}) => ({
    ...as('CUSTOMER', { projects: [proj, proj2] }),
    'GET /notifications/unread-count': [200, { unread: 3 }],
    'GET /notifications': page([
      notif(),
      notif({ id: 'n2', title: 'Old one', readAt: '2026-01-01T00:00:00Z' }),
    ]),
    'GET /tickets/t1': [404, { error: { code: 'NOT_FOUND', message: 'x' } }],
    ...extra,
  });

  it('shows the unread count and lists recent notifications', async () => {
    mockApi(base());
    renderApp('/app');
    const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' });
    await userEvent.click(bell);
    const panel = await screen.findByRole('region', { name: 'Recent notifications' });
    expect(await within(panel).findByText('New reply on ACME-WEB-0001')).toBeInTheDocument();
    expect(within(panel).getByText('Old one')).toBeInTheDocument();
    expect(within(panel).getAllByLabelText('Unread')).toHaveLength(1);
  });

  it('opening one marks it read and goes to the ticket', async () => {
    const calls = mockApi(base({ 'POST /notifications/n1/read': [204, null] }));
    renderApp('/app');
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await userEvent.click(await screen.findByText('New reply on ACME-WEB-0001'));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'POST /notifications/n1/read')).toBe(true),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /does not exist or is not available/,
    ); // landed on the ticket page
  });

  it('switches project first when the ticket belongs to another one', async () => {
    const calls = mockApi(
      base({
        'GET /notifications': page([
          notif({ ticket: { id: 't1', number: 'ACME-APP-0001', projectId: 'p2' } }),
        ]),
        'POST /notifications/n1/read': [204, null],
        'POST /auth/select-project': [
          200,
          { accessToken: 't2', activeProjectId: 'p2', projects: [proj, proj2] },
        ],
      }),
    );
    renderApp('/app');
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await userEvent.click(await screen.findByText('New reply on ACME-WEB-0001'));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /auth/select-project')?.body).toEqual({
        projectId: 'p2',
      }),
    );
  });

  it('marks everything read, and shows an empty state', async () => {
    const calls = mockApi(base({ 'POST /notifications/read-all': [200, { updated: 3 }] }));
    renderApp('/app');
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'POST /notifications/read-all')).toBe(true),
    );
  });

  it('shows "all caught up" when there is nothing', async () => {
    mockApi(
      base({
        'GET /notifications/unread-count': [200, { unread: 0 }],
        'GET /notifications': page([]),
      }),
    );
    renderApp('/app');
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('You are all caught up.')).toBeInTheDocument();
  });

  it('the full page filters to unread', async () => {
    const calls = mockApi(base());
    renderApp('/app/notifications');
    await screen.findByText('Old one');
    await userEvent.click(screen.getByLabelText('Unread only'));
    await waitFor(() => expect(calls.some((c) => c.key.includes('unread=true'))).toBe(true));
  });
});

describe('admin settings', () => {
  const cat = (over) => ({
    id: 'c1',
    name: 'Billing',
    projectId: null,
    project: null,
    isActive: true,
    _count: { tickets: 4 },
    ...over,
  });
  const defaults = {
    URGENT: { firstResponseHours: 1, resolutionHours: 4 },
    HIGH: { firstResponseHours: 4, resolutionHours: 8 },
    MEDIUM: { firstResponseHours: 8, resolutionHours: 24 },
    LOW: { firstResponseHours: 24, resolutionHours: 72 },
  };
  const base = (extra = {}) => ({
    ...as('ADMIN'),
    'GET /admin/categories': [
      200,
      { categories: [cat(), cat({ id: 'c2', name: 'Retired', isActive: false })] },
    ],
    'GET /admin/projects': page([
      {
        id: 'p1',
        key: 'ACME-WEB',
        name: 'Acme Website',
        organization: { name: 'Acme' },
        _count: {},
      },
    ]),
    'GET /admin/sla-policies': [
      200,
      {
        policies: [
          {
            id: 's1',
            projectId: null,
            priority: 'HIGH',
            firstResponseHours: 2,
            resolutionHours: 6,
            project: null,
          },
        ],
        defaults,
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

  it('lists categories, creates one, and toggles active', async () => {
    const calls = mockApi(
      base({
        'POST /admin/categories': [201, { category: {} }],
        'PATCH /admin/categories/c1': [200, { category: {} }],
      }),
    );
    renderApp('/app/admin/settings');
    expect(await screen.findByText('Retired')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate Billing' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /admin/categories/c1')?.body).toEqual({
        isActive: false,
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'New category' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Hardware');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Category created');
    expect(calls.find((c) => c.key === 'POST /admin/categories').body).toEqual({
      name: 'Hardware',
      projectId: null,
    });
  });

  it('edits a global SLA target; blocks resolution < first response', async () => {
    const calls = mockApi(base({ 'PUT /admin/sla-policies': [200, { policy: {} }] }));
    renderApp('/app/admin/settings');
    await userEvent.click(await screen.findByRole('tab', { name: 'SLA targets' }));
    const first = await screen.findByLabelText('High first response hours');
    expect(first).toHaveValue(2); // from the global row
    expect(screen.getByLabelText('Urgent first response hours')).toHaveAttribute(
      'placeholder',
      '1',
    ); // built-in default

    await userEvent.clear(screen.getByLabelText('High resolution hours'));
    await userEvent.type(screen.getByLabelText('High resolution hours'), '1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least the first-response/);
    expect(screen.getByRole('button', { name: 'Save High' })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('High resolution hours'));
    await userEvent.type(screen.getByLabelText('High resolution hours'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Save High' }));
    await screen.findByText('High target saved');
    expect(calls.find((c) => c.key === 'PUT /admin/sla-policies').body).toEqual({
      projectId: null,
      priority: 'HIGH',
      firstResponseHours: 2,
      resolutionHours: 12,
    });
  });

  it('sets a project override', async () => {
    const calls = mockApi(base({ 'PUT /admin/sla-policies': [200, { policy: {} }] }));
    renderApp('/app/admin/settings');
    await userEvent.click(await screen.findByRole('tab', { name: 'SLA targets' }));
    const section = await screen.findByRole('region', { name: 'Project overrides' });
    await userEvent.selectOptions(within(section).getByLabelText('Project'), 'p1');
    const table = screen.getByRole('table', { name: 'Project SLA overrides' });
    await userEvent.type(within(table).getByLabelText('Urgent first response hours'), '1');
    await userEvent.type(within(table).getByLabelText('Urgent resolution hours'), '2');
    await userEvent.click(within(table).getByRole('button', { name: 'Save Urgent' }));
    await screen.findByText('Urgent target saved');
    expect(calls.find((c) => c.key === 'PUT /admin/sla-policies').body).toEqual({
      projectId: 'p1',
      priority: 'URGENT',
      firstResponseHours: 1,
      resolutionHours: 2,
    });
  });

  it('saves the general settings and validates ranges', async () => {
    const calls = mockApi(base({ 'PATCH /admin/settings': [200, { settings: {} }] }));
    renderApp('/app/admin/settings');
    await userEvent.click(await screen.findByRole('tab', { name: 'General' }));
    const reopen = await screen.findByLabelText(/reopen a resolved ticket/);
    await userEvent.clear(reopen);
    await userEvent.type(reopen, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('At least 1')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'PATCH /admin/settings')).toBe(false);

    await userEvent.clear(reopen);
    await userEvent.type(reopen, '14');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await screen.findByText('Settings saved');
    expect(calls.find((c) => c.key === 'PATCH /admin/settings').body).toEqual({
      reopenWindowDays: 14,
      autoCloseAfterDays: 7,
      feedbackEditWindowHours: 24,
      faqRequireApproval: false,
    });
  });

  it('is admin only', async () => {
    mockApi(as('SUPPORT'));
    renderApp('/app/admin/settings');
    expect(await screen.findByRole('heading', { name: /don.t have access/i })).toBeInTheDocument();
  });
});

// keep MemoryRouter import used by helper render above
void MemoryRouter;

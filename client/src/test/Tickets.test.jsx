import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, sessionFor, project } from './utils.jsx';

const proj = project('p1', 'Acme Website', 'ACME-WEB');
const as = (role, over) => ({
  'POST /auth/refresh': [
    200,
    sessionFor(role, { projects: [proj], activeProjectId: 'p1', ...over }),
  ],
});
const page = (items) => [200, { items, page: 1, limit: 15, total: items.length, totalPages: 1 }];

const row = (over) => ({
  id: 't1',
  number: 'ACME-WEB-0001',
  subject: 'Printer is on fire',
  status: 'OPEN',
  priority: 'MEDIUM',
  assignee: null,
  mergedInto: null,
  createdBy: { id: 'u1', name: 'Test User' },
  project: { id: 'p1', key: 'ACME-WEB', name: 'Acme Website' },
  updatedAt: '2026-01-02T10:00:00Z',
  ...over,
});
const detail = (ticketOver = {}, extra = {}) => [
  200,
  {
    ticket: {
      ...row(),
      description: 'It smokes.',
      category: null,
      firstResponseAt: null,
      resolvedAt: null,
      closedAt: null,
      createdAt: '2026-01-01T10:00:00Z',
      allowedStatuses: ['CLOSED'],
      canReply: true,
      canAddNote: false,
      reopenUntil: null,
      ...ticketOver,
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
      {
        id: 'm2',
        type: 'SYSTEM',
        body: 'Status changed from Open to In progress',
        createdAt: '2026-01-01T11:00:00Z',
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
    ...extra,
  },
];

describe('new ticket', () => {
  const base = {
    ...as('CUSTOMER'),
    'GET /categories': [200, { categories: [{ id: 'c1', name: 'Bug', projectId: null }] }],
  };

  it('shows the form straight away when nothing suggests an answer, validates, and submits multipart data', async () => {
    const calls = mockApi({
      ...base,
      'GET /faq/suggest': [200, { items: [], total: 0, searchLogId: 'log0' }],
      'POST /tickets': [201, { ticket: { id: 't1', number: 'ACME-WEB-0007' } }],
      'GET /tickets/t1': detail(),
    });
    renderApp('/app/tickets/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Create ticket' }));
    expect(await screen.findByText('Subject is required')).toBeInTheDocument();
    expect(screen.getByText('Please describe the problem')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Subject'), 'Printer is on fire');
    await userEvent.type(screen.getByLabelText('Description'), 'It started smoking this morning.');
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'HIGH');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'c1');
    await userEvent.upload(
      screen.getByLabelText(/Attachments/),
      new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create ticket' }));

    await screen.findByRole('heading', { name: /Printer is on fire/ });
    const post = calls.find((c) => c.key === 'POST /tickets').body;
    expect(post).toMatchObject({
      subject: 'Printer is on fire',
      description: 'It started smoking this morning.',
      priority: 'HIGH',
      categoryId: 'c1',
      files: 'invoice.pdf',
      searchLogId: 'log0',
    });
  });

  it('asks whether the suggested articles were enough before showing the rest of the form', async () => {
    const calls = mockApi({
      ...base,
      'GET /faq/suggest': [
        200,
        {
          items: [{ id: 'a1', question: 'How do I fix printer fires?', snippet: 'Unplug it.' }],
          total: 1,
          searchLogId: 'log1',
        },
      ],
      'POST /tickets': [201, { ticket: { id: 't1', number: 'ACME-WEB-0007' } }],
      'GET /tickets/t1': detail(),
    });
    renderApp('/app/tickets/new');
    await userEvent.type(await screen.findByLabelText('Subject'), 'printer on fire');
    expect(
      await screen.findByRole('region', { name: 'Suggested articles' }, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Still need help, create a ticket' }));
    await userEvent.type(
      await screen.findByLabelText('Description'),
      'Smoke everywhere, please help.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
    await screen.findByRole('heading', { name: /Printer is on fire/ });
    expect(calls.find((c) => c.key === 'POST /tickets').body.searchLogId).toBe('log1');
  });

  it('"This answered my question" records the search and returns to the dashboard without a ticket', async () => {
    const calls = mockApi({
      ...base,
      'GET /faq/suggest': [
        200,
        {
          items: [{ id: 'a1', question: 'How do I fix printer fires?', snippet: 'Unplug it.' }],
          total: 1,
          searchLogId: 'log1',
        },
      ],
      'GET /tickets': page([]),
    });
    renderApp('/app/tickets/new');
    await userEvent.type(await screen.findByLabelText('Subject'), 'printer on fire');
    await userEvent.click(
      await screen.findByRole('button', { name: 'This answered my question' }, { timeout: 2000 }),
    );
    expect(await screen.findByText('Glad we could help!')).toBeInTheDocument();
    expect(calls.some((c) => c.key.includes('log=true'))).toBe(true);
    expect(calls.some((c) => c.key === 'POST /tickets')).toBe(false);
  });

  it('rejects disallowed attachments immediately', async () => {
    mockApi({ ...base, 'GET /faq/suggest': [200, { items: [], total: 0, searchLogId: null }] });
    renderApp('/app/tickets/new');
    await userEvent.upload(
      await screen.findByLabelText(/Attachments/),
      new File(['MZ'], 'virus.exe', { type: 'application/x-msdownload' }),
      { applyAccept: false },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/not an allowed type/);
  });

  it('shows server-side errors', async () => {
    mockApi({
      ...base,
      'GET /faq/suggest': [200, { items: [], total: 0, searchLogId: null }],
      'POST /tickets': [
        400,
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ path: 'subject', message: 'Subject too vague' }],
          },
        },
      ],
    });
    renderApp('/app/tickets/new');
    await userEvent.type(await screen.findByLabelText('Subject'), 'Printer is on fire');
    await userEvent.type(screen.getByLabelText('Description'), 'It started smoking this morning.');
    await userEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Subject too vague');
  });
});

describe('ticket lists', () => {
  it('customers default to open tickets and can switch the status group', async () => {
    const calls = mockApi({
      ...as('CUSTOMER'),
      'GET /tickets': page([
        row(),
        row({
          id: 't2',
          number: 'ACME-WEB-0002',
          subject: 'Second one',
          status: 'WAITING_ON_CUSTOMER',
        }),
      ]),
    });
    renderApp('/app/tickets');
    expect(await screen.findByRole('link', { name: 'Second one' })).toBeInTheDocument();
    expect(
      calls.some((c) =>
        c.key.includes('status=OPEN%2CIN_PROGRESS%2CWAITING_ON_CUSTOMER%2CREOPENED'),
      ),
    ).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'Resolved');
    await waitFor(() => expect(calls.some((c) => c.key.includes('status=RESOLVED'))).toBe(true));
    expect(screen.queryByRole('columnheader', { name: 'Assignee' })).not.toBeInTheDocument(); // staff-only column
  });

  it('shows an empty state', async () => {
    mockApi({ ...as('CUSTOMER'), 'GET /tickets': page([]) });
    renderApp('/app/tickets');
    expect(await screen.findByText(/No tickets match/)).toBeInTheDocument();
  });

  it('the dashboard lists your open tickets', async () => {
    mockApi({ ...as('CUSTOMER'), 'GET /tickets': page([row()]) });
    renderApp('/app');
    expect(await screen.findByRole('link', { name: 'Printer is on fire' })).toBeInTheDocument();
  });
  it('the dashboard shows ticket summary tiles', async () => {
    mockApi({ ...as('CUSTOMER'), 'GET /tickets': page([row()]) });
    renderApp('/app');
    expect(await screen.findByRole('link', { name: /Waiting on you/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Open/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Resolved/ })).toBeInTheDocument();
  });
});

describe('ticket detail as a customer', () => {
  it('shows the conversation, replies with attachments, and has no internal-note controls', async () => {
    const calls = mockApi({
      ...as('CUSTOMER'),
      'GET /tickets/t1': detail(),
      'GET /canned-replies': [403, { error: { code: 'FORBIDDEN', message: 'no' } }],
      'POST /tickets/t1/messages': [201, { message: {} }],
    });
    renderApp('/app/tickets/t1');
    expect(await screen.findByRole('heading', { name: /Printer is on fire/ })).toBeInTheDocument();
    expect(
      screen.getByText('Status changed from Open to In progress', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download photo.png' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Internal note' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Staff controls' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Raised by', { selector: 'dt' })?.nextSibling?.textContent,
    ).not.toMatch(/@/); // no email shown

    await userEvent.type(screen.getByLabelText('Your reply'), 'Any update?');
    await userEvent.upload(
      screen.getByLabelText(/Attachments \(optional\)/),
      new File(['hi'], 'notes.txt', { type: 'text/plain' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await screen.findByText('Reply sent');
    expect(calls.find((c) => c.key === 'POST /tickets/t1/messages').body).toEqual({
      body: 'Any update?',
      type: 'PUBLIC',
      files: 'notes.txt',
    });
  });

  it('closing asks for confirmation first', async () => {
    const calls = mockApi({
      ...as('CUSTOMER'),
      'GET /tickets/t1': detail(),
      'POST /tickets/t1/status': [200, { ticket: { status: 'CLOSED' } }],
    });
    renderApp('/app/tickets/t1');
    await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }));
    expect(calls.some((c) => c.key.endsWith('/status'))).toBe(false);
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close ticket' }));
    await screen.findByText('Ticket closed');
    expect(calls.find((c) => c.key.endsWith('/status')).body).toEqual({ status: 'CLOSED' });
  });

  it('a resolved ticket offers to reopen inside the window and hides the reply box', async () => {
    mockApi({
      ...as('CUSTOMER'),
      'GET /tickets/t1': detail({
        status: 'RESOLVED',
        canReply: false,
        allowedStatuses: ['REOPENED', 'CLOSED'],
        reopenUntil: '2099-01-01T00:00:00Z',
      }),
    });
    renderApp('/app/tickets/t1');
    expect(await screen.findByRole('button', { name: 'Reopen ticket' })).toBeInTheDocument();
    expect(screen.getByText(/You can reopen it until/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument();
  });

  it('after the window it explains instead of offering reopen', async () => {
    mockApi({
      ...as('CUSTOMER'),
      'GET /tickets/t1': detail({
        status: 'RESOLVED',
        canReply: false,
        allowedStatuses: ['CLOSED'],
        reopenUntil: '2020-01-01T00:00:00Z',
      }),
    });
    renderApp('/app/tickets/t1');
    expect(await screen.findByText(/reopening period has ended/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen ticket' })).not.toBeInTheDocument();
  });

  it('closed tickets show a notice instead of a reply box; unknown tickets show a friendly error', async () => {
    mockApi({
      ...as('CUSTOMER'),
      'GET /tickets/t1': detail({ status: 'CLOSED', canReply: false, allowedStatuses: [] }),
      'GET /tickets/zz': [404, { error: { code: 'NOT_FOUND', message: 'Ticket not found' } }],
    });
    const { unmount } = renderApp('/app/tickets/t1');
    expect(await screen.findByText('This ticket is closed.')).toBeInTheDocument();
    unmount();
    renderApp('/app/tickets/zz');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /does not exist or is not available/,
    );
  });
});

describe('ticket detail as staff', () => {
  const staffDetail = (over = {}) =>
    detail(
      {
        allowedStatuses: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'],
        canAddNote: true,
        createdBy: {
          id: 'c1',
          name: 'Bob',
          email: 'bob@acme.example',
          organization: { id: 'o1', name: 'Acme Corp' },
        },
        ...over,
      },
      {
        events: [
          {
            id: 'e1',
            type: 'CREATED',
            toValue: 'OPEN',
            createdAt: '2026-01-01T10:00:00Z',
            actor: { id: 'c1', name: 'Bob' },
          },
          {
            id: 'e2',
            type: 'ASSIGNED',
            fromValue: null,
            toValue: 'Sam',
            createdAt: '2026-01-01T10:05:00Z',
            actor: { id: 's1', name: 'Sam' },
          },
          {
            id: 'e3',
            type: 'PRIORITY_CHANGED',
            fromValue: 'MEDIUM',
            toValue: 'HIGH',
            createdAt: '2026-01-01T10:06:00Z',
            actor: { id: 's1', name: 'Sam' },
          },
        ],
      },
    );
  const staffApi = (extra = {}) => ({
    ...as('SUPPORT'),
    'GET /tickets/t1': staffDetail(),
    'GET /canned-replies': [
      200,
      {
        replies: [
          { id: 'r1', title: 'Greeting', body: 'Thanks for reaching out!', scope: 'GLOBAL' },
        ],
      },
    ],
    'GET /tickets/assignees': [
      200,
      {
        assignees: [
          { id: 'u1', name: 'Test User', role: 'SUPPORT' },
          { id: 's2', name: 'Riley', role: 'SUPPORT' },
        ],
      },
    ],
    'GET /categories': [200, { categories: [{ id: 'c1', name: 'Bug', projectId: null }] }],
    ...extra,
  });

  it("shows the customer's details and the full history", async () => {
    mockApi(staffApi());
    renderApp('/app/tickets/t1');
    expect(await screen.findByText('bob@acme.example · Acme Corp')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /History/ }));
    expect(screen.getByText('Assigned to Sam')).toBeInTheDocument();
    expect(screen.getByText('Priority: Medium → High')).toBeInTheDocument();
  });

  it('adds an internal note (not a public reply)', async () => {
    const calls = mockApi(staffApi({ 'POST /tickets/t1/messages': [201, { message: {} }] }));
    renderApp('/app/tickets/t1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Internal note' }));
    expect(screen.getByText(/customer is never notified/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Internal note'), 'Looks like a hardware fault');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await screen.findByText('Note added');
    expect(calls.find((c) => c.key === 'POST /tickets/t1/messages').body).toMatchObject({
      body: 'Looks like a hardware fault',
      type: 'INTERNAL_NOTE',
    });
  });

  it('inserts a canned reply into the editor', async () => {
    mockApi(staffApi());
    renderApp('/app/tickets/t1');
    await screen.findByLabelText('Your reply');
    await userEvent.selectOptions(await screen.findByLabelText('Canned reply'), 'r1');
    expect(screen.getByLabelText('Your reply')).toHaveValue('Thanks for reaching out!');
  });

  it('changes status, priority and assignee through separate calls', async () => {
    const calls = mockApi(
      staffApi({
        'POST /tickets/t1/status': [200, { ticket: { status: 'RESOLVED' } }],
        'PATCH /tickets/t1': [200, { ticket: {} }],
        'POST /tickets/t1/assign': [200, { ticket: {} }],
      }),
    );
    renderApp('/app/tickets/t1');
    const controls = await screen.findByRole('region', { name: 'Staff controls' });
    await userEvent.selectOptions(within(controls).getByLabelText('Status'), 'RESOLVED');
    await userEvent.selectOptions(within(controls).getByLabelText('Priority'), 'URGENT');
    await userEvent.selectOptions(
      await within(controls)
        .findByRole('option', { name: 'Riley' })
        .then((o) => o.closest('select')),
      's2',
    );
    await waitFor(() =>
      expect(
        calls.filter((c) => /status|assign/.test(c.key) || c.key.startsWith('PATCH')).length,
      ).toBeGreaterThanOrEqual(3),
    );
    expect(calls.find((c) => c.key === 'POST /tickets/t1/status').body).toEqual({
      status: 'RESOLVED',
    });
    expect(calls.find((c) => c.key === 'PATCH /tickets/t1').body).toEqual({ priority: 'URGENT' });
    expect(calls.find((c) => c.key === 'POST /tickets/t1/assign').body).toEqual({
      assigneeId: 's2',
    });
  });

  it('only offers the statuses the server allows, and nothing on closed tickets', async () => {
    mockApi(
      staffApi({
        'GET /tickets/t1': staffDetail({ status: 'CLOSED', allowedStatuses: [], canReply: false }),
      }),
    );
    renderApp('/app/tickets/t1');
    const controls = await screen.findByRole('region', { name: 'Staff controls' });
    expect(within(controls).getByLabelText('Status')).toBeDisabled();
    expect(within(controls).getByRole('button', { name: /Merge/ })).toBeDisabled();
    expect(
      screen.getByText('This ticket is closed. You can still add internal notes.'),
    ).toBeInTheDocument();
  });

  it('merges into another ticket after choosing it', async () => {
    const calls = mockApi(
      staffApi({
        'GET /tickets': page([
          row({ id: 't1' }),
          row({ id: 't9', number: 'ACME-WEB-0009', subject: 'Original report' }),
        ]),
        'POST /tickets/t1/merge': [200, { ticket: {} }],
      }),
    );
    renderApp('/app/tickets/t1');
    await userEvent.click(await screen.findByRole('button', { name: /Merge into another ticket/ }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.type(within(dialog).getByLabelText('Find the ticket to keep'), 'original');
    await userEvent.click(await within(dialog).findByRole('radio', {}, { timeout: 2000 }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Merge tickets' }));
    await screen.findByText('Tickets merged');
    expect(calls.find((c) => c.key === 'POST /tickets/t1/merge').body).toEqual({
      targetTicketId: 't9',
    });
  });
});

describe('staff queue', () => {
  const tickets = page([
    row({ id: 't1' }),
    row({
      id: 't2',
      number: 'ACME-WEB-0002',
      subject: 'Second',
      priority: 'URGENT',
      assignee: { id: 's1', name: 'Sam' },
    }),
  ]);
  const queueApi = (extra = {}) => ({
    ...as('SUPPORT'),
    'GET /tickets': tickets,
    'GET /categories': [200, { categories: [] }],
    'GET /tickets/assignees': [
      200,
      {
        assignees: [
          { id: 'u1', name: 'Test User', role: 'SUPPORT' },
          { id: 's2', name: 'Riley', role: 'SUPPORT' },
        ],
      },
    ],
    ...extra,
  });

  it('shows staff columns, filters and sends them to the API', async () => {
    const calls = mockApi(queueApi());
    renderApp('/app/queue');
    expect(await screen.findByRole('columnheader', { name: 'Assignee' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'URGENT');
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'unassigned');
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.key.includes('priority=URGENT') && c.key.includes('assigneeId=unassigned'),
        ),
      ).toBe(true),
    );
  });

  it('my assigned tickets starts filtered to me', async () => {
    const calls = mockApi(queueApi());
    renderApp('/app/assigned');
    await screen.findByRole('heading', { name: 'My assigned tickets' });
    await waitFor(() => expect(calls.some((c) => c.key.includes('assigneeId=me'))).toBe(true));
  });

  it('bulk-assigns the selected tickets', async () => {
    const calls = mockApi(queueApi({ 'POST /tickets/bulk-assign': [200, { updated: 2 }] }));
    renderApp('/app/queue');
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Select all tickets on this page' }),
    );
    const bar = await screen.findByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    await userEvent.selectOptions(within(bar).getByLabelText('Assign to'), 'me');
    await userEvent.click(within(bar).getByRole('button', { name: 'Apply' }));
    await screen.findByText('2 ticket(s) updated');
    expect(calls.find((c) => c.key === 'POST /tickets/bulk-assign').body).toEqual({
      ticketIds: ['t1', 't2'],
      assigneeId: 'u1',
    });
  });

  it('saves a view of the current filters and re-applies it later', async () => {
    const calls = mockApi(queueApi());
    renderApp('/app/queue');
    await userEvent.selectOptions(await screen.findByLabelText('Priority'), 'HIGH');
    await userEvent.type(screen.getByLabelText('Name for this view'), 'High priority');
    await userEvent.click(screen.getByRole('button', { name: 'Save view' }));
    const views = await screen.findByRole('group', { name: 'Saved views' });

    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'LOW');
    await userEvent.click(within(views).getByRole('button', { name: 'High priority' }));
    expect(screen.getByLabelText('Priority')).toHaveValue('HIGH');
    expect(calls.length).toBeGreaterThan(0);
    await userEvent.click(within(views).getByRole('button', { name: 'Delete view High priority' }));
    expect(screen.queryByRole('group', { name: 'Saved views' })).not.toBeInTheDocument();
  });

  it('customers cannot open the queue', async () => {
    mockApi(as('CUSTOMER'));
    renderApp('/app/queue');
    expect(await screen.findByRole('heading', { name: /don.t have access/i })).toBeInTheDocument();
  });
});

describe('canned replies page', () => {
  it('lists replies, only offers edit/delete on ones you may change, and creates a new one', async () => {
    const calls = mockApi({
      ...as('SUPPORT'),
      'GET /canned-replies': [
        200,
        {
          replies: [
            {
              id: 'r1',
              title: 'Global greeting',
              body: 'Hello',
              scope: 'GLOBAL',
              ownerId: null,
              project: null,
            },
            {
              id: 'r2',
              title: 'My reply',
              body: 'Mine',
              scope: 'PERSONAL',
              ownerId: 'u1',
              project: null,
            },
          ],
        },
      ],
      'POST /canned-replies': [201, { reply: {} }],
    });
    renderApp('/app/canned-replies');
    expect(await screen.findByText('Global greeting')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Global greeting' })).not.toBeInTheDocument(); // admins only
    expect(screen.getByRole('button', { name: 'Edit My reply' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New reply' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    expect(within(dialog).queryByRole('option', { name: 'All staff' })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Resolved');
    await userEvent.type(within(dialog).getByLabelText('Text'), 'We fixed it.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Reply created');
    expect(calls.find((c) => c.key === 'POST /canned-replies').body).toEqual({
      title: 'Resolved',
      body: 'We fixed it.',
      scope: 'PERSONAL',
    });
  });
});

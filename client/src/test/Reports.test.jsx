import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarList, VolumeChart } from '../components/charts.jsx';
import { fmtHours, niceTicks } from '../lib/format.js';
import { mockApi, renderApp, sessionFor, project } from './utils.jsx';

const proj = project('p1', 'Acme Website', 'ACME-WEB');
const proj2 = project('p2', 'Acme Mobile App', 'ACME-APP');
const as = (role, over) => ({
  'POST /auth/refresh': [
    200,
    sessionFor(role, { projects: [proj, proj2], activeProjectId: 'ALL', ...over }),
  ],
});

const series = [
  { date: '2026-03-01', created: 2, resolved: 0 },
  { date: '2026-03-02', created: 4, resolved: 1 },
  { date: '2026-03-03', created: 1, resolved: 3 },
];
const overview = (over = {}) => [
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
      resolution: { avgHours: 12.75, medianHours: 9, count: 4 },
    },
    sla: {
      firstResponse: { met: 4, total: 6, rate: 66.7 },
      resolution: { met: 3, total: 5, rate: 60 },
    },
    series,
    statuses: [
      { status: 'OPEN', count: 2 },
      { status: 'IN_PROGRESS', count: 0 },
      { status: 'WAITING_ON_CUSTOMER', count: 1 },
      { status: 'RESOLVED', count: 3 },
      { status: 'CLOSED', count: 1 },
      { status: 'REOPENED', count: 2 },
    ],
    categories: [
      { name: 'Bug', count: 3 },
      { name: 'Uncategorised', count: 1 },
    ],
    ...over,
  },
];
const csat = [
  200,
  {
    range: {},
    summary: {
      count: 4,
      average: 3.5,
      distribution: [
        { rating: 1, count: 0 },
        { rating: 2, count: 1 },
        { rating: 3, count: 1 },
        { rating: 4, count: 1 },
        { rating: 5, count: 1 },
      ],
    },
    byAgent: [{ id: 'a', name: 'Sam Support', count: 2, average: 3.5 }],
    byProject: [{ id: 'p', name: 'ACME-WEB · Acme Website', count: 4, average: 3.5 }],
    byCategory: [{ id: 'c', name: 'Bug', count: 3, average: 3.33 }],
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
const dashboard = (extra = {}) => ({
  ...as('ADMIN'),
  'GET /reports/overview': overview(),
  'GET /reports/csat': csat,
  'GET /reports/deflection': deflection,
  ...extra,
});

describe('format helpers', () => {
  it('formats durations and picks clean axis ticks', () => {
    expect(fmtHours(null)).toBe('—');
    expect(fmtHours(0.5)).toBe('30m');
    expect(fmtHours(2.14)).toBe('2.1h');
    expect(fmtHours(72)).toBe('3d');
    expect(niceTicks(0)).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceTicks(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceTicks(23)).toEqual({ max: 30, ticks: [0, 10, 20, 30] });
    expect(niceTicks(1200).ticks.at(-1)).toBeGreaterThanOrEqual(1200);
  });
});

describe('VolumeChart', () => {
  it('has a legend, an accessible summary, and a table twin with every value', () => {
    render(<VolumeChart series={series} granularity="day" />);
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getByText('Created')).toBeInTheDocument();
    expect(within(legend).getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /left and right arrow keys/ })).toBeInTheDocument();
    expect(document.querySelector('figcaption').textContent).toMatch(
      /7 created and 4 resolved between Mar 1 and Mar 3/,
    );
    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(4); // header + 3 days
    expect(within(table).getByText('2026-03-02')).toBeInTheDocument();
  });

  it('is readable from the keyboard: arrow keys move the crosshair and show the values', async () => {
    render(<VolumeChart series={series} granularity="day" />);
    const chart = screen.getByRole('group', { name: /arrow keys/ });
    act(() => chart.focus());
    expect(await screen.findByRole('status')).toHaveTextContent('Mar 3'); // starts on the latest point
    await userEvent.keyboard('{ArrowLeft}');
    const tip = screen.getByRole('status');
    expect(tip).toHaveTextContent('Mar 2');
    expect(tip).toHaveTextContent('Created: 4');
    expect(tip).toHaveTextContent('Resolved: 1');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('status')).toHaveTextContent('Mar 1');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('follows the pointer too', () => {
    render(<VolumeChart series={series} granularity="day" />);
    const chart = screen.getByRole('group', { name: /arrow keys/ });
    chart.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 720,
      height: 260,
      right: 720,
      bottom: 260,
    });
    // jsdom has no PointerEvent, so build the event by hand (clientX is what the chart reads)
    const move = new Event('pointermove', { bubbles: true });
    move.clientX = 40; // left edge of the plot
    act(() => {
      chart.dispatchEvent(move);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Mar 1');
    fireEvent.pointerLeave(chart);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('labels weeks as weeks and shows a friendly empty state', () => {
    const { unmount } = render(<VolumeChart series={series} granularity="week" />);
    expect(screen.getByText('Week starting')).toBeInTheDocument();
    unmount();
    render(
      <VolumeChart
        series={series.map((p) => ({ ...p, created: 0, resolved: 0 }))}
        granularity="day"
      />,
    );
    expect(screen.getByText(/No tickets were created or resolved/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Legend' })).not.toBeInTheDocument();
  });
});

describe('BarList', () => {
  it('prints every value, draws bars only for non-zero rows, and handles empty data', () => {
    const { unmount } = render(
      <BarList
        ariaLabel="By status"
        items={[
          { label: 'Open', value: 4 },
          { label: 'Closed', value: 0 },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'By status' });
    expect(within(list).getByText('4')).toBeInTheDocument();
    expect(within(list).getByText('0')).toBeInTheDocument();
    expect(list.querySelectorAll('span[style*="width"]')).toHaveLength(1);
    unmount();
    render(<BarList ariaLabel="x" items={[{ label: 'a', value: 0 }]} empty="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});

describe('admin dashboard', () => {
  it('shows the KPIs, charts, satisfaction breakdowns and self-service numbers', async () => {
    mockApi(dashboard());
    renderApp('/app/admin');
    expect(await screen.findByText('Tickets created')).toBeInTheDocument();
    const kpi = screen.getByRole('region', { name: 'At a glance' });
    expect(within(kpi).getByText('2.1h')).toBeInTheDocument(); // avg first response
    expect(within(kpi).getByText('12.8h')).toBeInTheDocument(); // avg resolution (12.75 shown to 1 dp)
    expect(within(kpi).getByText('66.7%')).toBeInTheDocument();
    expect(within(kpi).getByText('60%')).toBeInTheDocument();
    expect(await within(kpi).findByText('3.50 / 5')).toBeInTheDocument();
    expect(within(kpi).getByText('25%')).toBeInTheDocument(); // reopen rate

    const status = screen.getByRole('region', { name: 'Open vs resolved' });
    expect(within(status).getByText(/open · /)).toHaveTextContent('5 open · 4 resolved or closed');
    expect(
      within(screen.getByRole('list', { name: 'Tickets by category' })).getByText('Bug'),
    ).toBeInTheDocument();

    const sat = screen.getByRole('region', { name: 'Customer satisfaction' });
    expect(within(sat).getByRole('table', { name: 'Satisfaction by agent' })).toHaveTextContent(
      'Sam Support',
    );
    expect(within(sat).getByRole('table', { name: 'Satisfaction by project' })).toHaveTextContent(
      'ACME-WEB · Acme Website',
    );
    expect(within(sat).getByRole('table', { name: 'Satisfaction by month' })).toHaveTextContent(
      '2026-03',
    );

    const faq = screen.getByRole('region', { name: /Self-service/ });
    expect(within(faq).getByText('35%')).toBeInTheDocument();
    expect(within(faq).getByText('invoice pdf')).toBeInTheDocument();
  });

  it('re-queries with the chosen period; one filter row drives every block', async () => {
    const calls = mockApi(dashboard());
    renderApp('/app/admin');
    await screen.findByText('Tickets created');
    const before = calls.filter((c) => c.key.startsWith('GET /reports/overview')).length;
    await userEvent.selectOptions(screen.getByLabelText('Period'), '7');
    await waitFor(() =>
      expect(calls.filter((c) => c.key.startsWith('GET /reports/overview')).length).toBeGreaterThan(
        before,
      ),
    );
    const last = (name) => calls.filter((c) => c.key.startsWith(`GET /reports/${name}`)).at(-1).key;
    for (const name of ['overview', 'csat', 'deflection']) {
      const params = new URL(`http://x/${last(name).split(' ')[1]}`).searchParams;
      const days = (Date.parse(params.get('to')) - Date.parse(params.get('from'))) / 86_400_000 + 1;
      expect(days).toBe(7);
    }
  });

  it('custom ranges are validated before anything is requested; project filter only in "All projects"', async () => {
    const calls = mockApi(dashboard());
    renderApp('/app/admin');
    await screen.findByText('Tickets created');
    expect(
      within(screen.getByLabelText('Period').closest('label').parentElement).getByText('Project'),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'custom');
    await userEvent.type(screen.getByLabelText('From'), '2026-03-10');
    await userEvent.type(screen.getByLabelText('To'), '2026-03-01');
    expect(
      await screen.findByText(/start date that is not after the end date/),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key.includes('from=2026-03-10'))).toBe(false);
    await userEvent.clear(screen.getByLabelText('To'));
    await userEvent.type(screen.getByLabelText('To'), '2026-03-20');
    await waitFor(() =>
      expect(
        calls.some((c) => c.key.includes('from=2026-03-10') && c.key.includes('to=2026-03-20')),
      ).toBe(true),
    );
  });

  it('with a single project selected there is no project filter (the scope is already narrow)', async () => {
    mockApi({ ...dashboard(), ...as('ADMIN', { activeProjectId: 'p1' }) });
    renderApp('/app/admin');
    await screen.findByText('Tickets created');
    const filterRow = screen.getByLabelText('Period').closest('label').parentElement;
    expect(within(filterRow).queryByText('Project')).not.toBeInTheDocument();
  });

  it('exports the current period as CSV', async () => {
    const calls = mockApi(dashboard({ 'GET /tickets/export.csv': [200, {}] }));
    renderApp('/app/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Export tickets (CSV)' }));
    await screen.findByText('Export downloaded');
    const exp = calls.find((c) => c.key.startsWith('GET /tickets/export.csv'));
    expect(exp.key).toMatch(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  });

  it("shows the server's message when an export is too large", async () => {
    mockApi(
      dashboard({
        'GET /tickets/export.csv': [
          413,
          {
            error: {
              code: 'EXPORT_TOO_LARGE',
              message: 'This export has 30000 tickets; narrow it with filters.',
            },
          },
        ],
      }),
    );
    renderApp('/app/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Export tickets (CSV)' }));
    expect(await screen.findByText(/narrow it with filters/)).toBeInTheDocument();
  });

  it('a failing block shows an error with retry while the others keep working', async () => {
    mockApi(
      dashboard({
        'GET /reports/csat': [
          500,
          { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
        ],
      }),
    );
    renderApp('/app/admin');
    const sat = await screen.findByRole('region', { name: 'Customer satisfaction' });
    expect(await within(sat).findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(within(sat).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText('Tickets created')).toBeInTheDocument();
  });

  it('is admin only', async () => {
    mockApi(as('SUPPORT'));
    renderApp('/app/admin');
    expect(await screen.findByRole('heading', { name: /don.t have access/i })).toBeInTheDocument();
  });
});

describe('my stats', () => {
  const me = [
    200,
    {
      range: { from: '2026-03-01', to: '2026-03-03', days: 3, granularity: 'day' },
      totals: {
        created: 3,
        resolved: 2,
        openNow: 2,
        reopens: 0,
        resolutionEvents: 2,
        reopenRate: 0,
      },
      responseTimes: {
        firstResponse: { avgHours: 0.5, medianHours: 0.5, count: 3 },
        resolution: { avgHours: 19, medianHours: 19, count: 2 },
      },
      sla: {
        firstResponse: { met: 2, total: 3, rate: 66.7 },
        resolution: { met: 1, total: 1, rate: 100 },
      },
      series,
      statuses: [
        { status: 'OPEN', count: 1 },
        { status: 'IN_PROGRESS', count: 0 },
        { status: 'WAITING_ON_CUSTOMER', count: 1 },
        { status: 'RESOLVED', count: 1 },
        { status: 'CLOSED', count: 1 },
        { status: 'REOPENED', count: 0 },
      ],
      csat: {
        count: 2,
        average: 3.5,
        distribution: [
          { rating: 1, count: 0 },
          { rating: 2, count: 1 },
          { rating: 3, count: 0 },
          { rating: 4, count: 0 },
          { rating: 5, count: 1 },
        ],
      },
    },
  ];

  it("shows the agent's own numbers", async () => {
    mockApi({ ...as('SUPPORT'), 'GET /reports/me': me });
    renderApp('/app/stats');
    const glance = await screen.findByRole('region', { name: 'At a glance' });
    expect(await within(glance).findByText('30m')).toBeInTheDocument();
    expect(within(glance).getByText('19h')).toBeInTheDocument();
    expect(within(glance).getByText('3.50 / 5')).toBeInTheDocument();
    expect(within(glance).getByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Your tickets by status' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Your ticket volume/ })).toBeInTheDocument();
  });

  it('customers cannot open it', async () => {
    mockApi(as('CUSTOMER', { activeProjectId: 'p1' }));
    renderApp('/app/stats');
    expect(await screen.findByRole('heading', { name: /don.t have access/i })).toBeInTheDocument();
  });
});

describe('audit log page', () => {
  const entry = (over) => ({
    id: 'l1',
    createdAt: '2026-03-02T10:00:00Z',
    action: 'user.deactivate',
    entity: 'User',
    entityId: 'u-2',
    metadata: { previousStatus: 'ACTIVE' },
    actor: { id: 'a1', name: 'Ada Admin', email: 'a@x.co', role: 'ADMIN' },
    ...over,
  });
  const page = (items) => [200, { items, page: 1, limit: 25, total: items.length, totalPages: 1 }];
  const base = (extra = {}) => ({
    ...as('ADMIN'),
    'GET /admin/audit-logs/filters': [
      200,
      {
        actions: ['user.create', 'user.deactivate'],
        entities: ['User'],
        actors: [{ id: 'a1', name: 'Ada Admin' }],
      },
    ],
    'GET /admin/audit-logs': page([
      entry(),
      entry({ id: 'l2', action: 'project.update', entity: 'Project', metadata: null, actor: null }),
    ]),
    ...extra,
  });

  it('lists entries with actor, action, entity and expandable details as plain text', async () => {
    mockApi(
      base({
        'GET /admin/audit-logs': page([
          entry({ metadata: { note: '<img src=x onerror=alert(1)>' } }),
          entry({
            id: 'l2',
            action: 'project.update',
            entity: 'Project',
            metadata: null,
            actor: null,
          }),
        ]),
      }),
    );
    renderApp('/app/admin/audit');
    const table = await screen.findByRole('table', { name: 'Audit log' });
    expect(within(table).getByText('user.deactivate')).toBeInTheDocument();
    expect(within(table).getByText('Ada Admin')).toBeInTheDocument();
    expect(within(table).getByText('System')).toBeInTheDocument();
    await userEvent.click(within(table).getByText('View'));
    expect(within(table).getByText(/onerror=alert\(1\)/)).toBeInTheDocument();
    expect(table.querySelector('img')).toBeNull(); // metadata is text, never markup
  });

  it('filters by action and date range, and rejects an inverted range', async () => {
    const calls = mockApi(base());
    renderApp('/app/admin/audit');
    await screen.findByRole('table', { name: 'Audit log' });
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'user.create');
    await waitFor(() => expect(calls.some((c) => c.key.includes('action=user.create'))).toBe(true));
    await userEvent.type(screen.getByLabelText('From'), '2026-03-10');
    await userEvent.type(screen.getByLabelText('To'), '2026-03-01');
    expect(await screen.findByText(/start date is after the end date/)).toBeInTheDocument();
    // an inverted range is never sent to the API
    expect(
      calls.some((c) => c.key.includes('from=2026-03-10') && c.key.includes('to=2026-03-01')),
    ).toBe(false);
  });

  it('shows an empty state and is admin only', async () => {
    mockApi(base({ 'GET /admin/audit-logs': page([]) }));
    const { unmount } = renderApp('/app/admin/audit');
    expect(await screen.findByText('No audit entries match these filters.')).toBeInTheDocument();
    unmount();
    mockApi(as('SUPPORT'));
    renderApp('/app/admin/audit');
    expect(await screen.findByRole('heading', { name: /don.t have access/i })).toBeInTheDocument();
  });
});

describe('queue export', () => {
  it('exports with exactly the filters on screen', async () => {
    const calls = mockApi({
      ...as('SUPPORT'),
      'GET /tickets': [200, { items: [], page: 1, limit: 20, total: 0, totalPages: 1 }],
      'GET /categories': [200, { categories: [] }],
      'GET /tickets/export.csv': [200, {}],
    });
    renderApp('/app/queue');
    await userEvent.selectOptions(await screen.findByLabelText('Priority'), 'URGENT');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await screen.findByText('Export downloaded');
    const key = calls.find((c) => c.key.startsWith('GET /tickets/export.csv')).key;
    expect(key).toContain('priority=URGENT');
    expect(key).toContain('status=OPEN%2CIN_PROGRESS%2CWAITING_ON_CUSTOMER%2CREOPENED');
    expect(key).not.toContain('sort=');
    expect(key).not.toContain('page=');
  });
});

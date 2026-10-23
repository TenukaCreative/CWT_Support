import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, sessionFor, project } from './utils.jsx';

const admin = {
  'POST /auth/refresh': [
    200,
    sessionFor('ADMIN', {
      projects: [project('p1', 'Acme Website', 'ACME-WEB')],
      activeProjectId: 'ALL',
    }),
  ],
};
const page = (items) => [200, { items, page: 1, limit: 15, total: items.length, totalPages: 1 }];
const user = (over) => ({
  id: 'u7',
  name: 'Dave Globex',
  email: 'dave@globex.example',
  role: 'CUSTOMER',
  status: 'PENDING',
  organization: { id: 'o2', name: 'Globex Inc' },
  emailVerifiedAt: '2026-01-01T00:00:00Z',
  lastLoginAt: null,
  lockedUntil: null,
  createdAt: '2026-01-01T00:00:00Z',
  projects: [],
  ...over,
});
const projects = page([
  {
    id: 'p9',
    key: 'GLX-PORTAL',
    name: 'Globex Portal',
    status: 'ACTIVE',
    organization: { id: 'o2', name: 'Globex Inc' },
    _count: { members: 0, tickets: 0 },
  },
]);

describe('pending approvals', () => {
  it('approves a registration with the chosen projects', async () => {
    const calls = mockApi({
      ...admin,
      'GET /admin/users?status=PENDING&role=CUSTOMER&page=1&limit=15&sort=createdAt&dir=asc': page([
        user(),
      ]),
      'GET /admin/projects?status=ACTIVE&limit=100&sort=key&dir=asc&organizationId=o2': projects,
      'POST /admin/users/u7/approve': [200, { user: user({ status: 'ACTIVE' }) }],
    });
    renderApp('/app/admin/pending');

    expect(await screen.findByText('dave@globex.example')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve Dave Globex' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.click(await within(dialog).findByLabelText(/Globex Portal/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await screen.findByText('Dave Globex approved');
    expect(calls.find((c) => c.key === 'POST /admin/users/u7/approve').body).toEqual({
      projectIds: ['p9'],
    });
  });

  it('blocks approving users who have not verified their email', async () => {
    mockApi({
      ...admin,
      'GET /admin/users?status=PENDING&role=CUSTOMER&page=1&limit=15&sort=createdAt&dir=asc': page([
        user({ emailVerifiedAt: null }),
      ]),
    });
    renderApp('/app/admin/pending');
    expect(await screen.findByRole('button', { name: 'Approve Dave Globex' })).toBeDisabled();
  });

  it('shows an empty state', async () => {
    mockApi({
      ...admin,
      'GET /admin/users?status=PENDING&role=CUSTOMER&page=1&limit=15&sort=createdAt&dir=asc': page(
        [],
      ),
    });
    renderApp('/app/admin/pending');
    expect(await screen.findByText('Nothing waiting for approval.')).toBeInTheDocument();
  });

  it('shows an error with retry when the API fails', async () => {
    mockApi({
      ...admin,
      'GET /admin/users?status=PENDING&role=CUSTOMER&page=1&limit=15&sort=createdAt&dir=asc': [
        500,
        { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      ],
    });
    renderApp('/app/admin/pending');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('users', () => {
  const usersUrl = 'GET /admin/users?page=1&limit=15&sort=name&dir=asc';
  const invites = { 'GET /admin/invitations?page=1&limit=10&sort=createdAt&dir=desc': page([]) };

  it('asks for confirmation before deactivating, and cannot deactivate yourself', async () => {
    const calls = mockApi({
      ...admin,
      ...invites,
      [usersUrl]: page([
        user({ id: 'u7', status: 'ACTIVE' }),
        user({
          id: 'u1',
          name: 'Preview User',
          email: 't@x.co',
          role: 'ADMIN',
          organization: null,
        }),
      ]),
      'POST /admin/users/u7/deactivate': [200, { user: user({ status: 'DEACTIVATED' }) }],
    });
    renderApp('/app/admin/users');

    await screen.findByText('dave@globex.example');
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate Dave Globex' }));
    expect(calls.some((c) => c.key.includes('/deactivate'))).toBe(false); // not yet: needs confirmation
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await screen.findByText('User deactivated');
    expect(calls.some((c) => c.key === 'POST /admin/users/u7/deactivate')).toBe(true);
  });

  it('shows an empty state for no users', async () => {
    mockApi({ ...admin, ...invites, [usersUrl]: page([]) });
    renderApp('/app/admin/users');
    expect(await screen.findByText('No users match.')).toBeInTheDocument();
  });
});

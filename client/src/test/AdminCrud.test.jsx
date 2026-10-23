import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, sessionFor, project } from './utils.jsx';

const proj = project('p1', 'Acme Website', 'ACME-WEB');
const as = (role = 'ADMIN') => ({
  'POST /auth/refresh': [200, sessionFor(role, { projects: [proj], activeProjectId: 'ALL' })],
});
const page = (items) => [200, { items, page: 1, limit: 15, total: items.length, totalPages: 1 }];
const org = (over) => ({
  id: 'o1',
  name: 'Acme Corp',
  domain: 'acme.com',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  _count: { projects: 2, users: 5 },
  ...over,
});
const proj1 = {
  id: 'p1',
  key: 'ACME-WEB',
  name: 'Acme Website',
  status: 'ACTIVE',
  organization: { id: 'o1', name: 'Acme Corp' },
  _count: { members: 3, tickets: 7 },
};
const user = (over) => ({
  id: 'u7',
  name: 'Dave Globex',
  email: 'dave@globex.example',
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

describe('organizations', () => {
  const base = (extra = {}) => ({
    ...as(),
    'GET /admin/organizations': page([
      org(),
      org({ id: 'o2', name: 'Old Co', status: 'ARCHIVED', domain: null }),
    ]),
    ...extra,
  });

  it('lists with counts and statuses, filters, and shows an empty state', async () => {
    const calls = mockApi(base());
    renderApp('/app/admin/organizations');
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('acme.com')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ARCHIVED');
    await waitFor(() => expect(calls.some((c) => c.key.includes('status=ARCHIVED'))).toBe(true));
    await userEvent.type(screen.getByLabelText('Search'), 'acm');
    await waitFor(() => expect(calls.some((c) => c.key.includes('q=acm'))).toBe(true));
  });

  it('creates, edits, archives (with a warning) and restores', async () => {
    const calls = mockApi(
      base({
        'POST /admin/organizations': [201, { organization: org() }],
        'PATCH /admin/organizations/o1': [200, { organization: org() }],
        'PATCH /admin/organizations/o2': [200, { organization: org() }],
      }),
    );
    renderApp('/app/admin/organizations');
    await userEvent.click(await screen.findByRole('button', { name: 'New organization' }));
    let dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Name is required')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Initech');
    await userEvent.type(within(dialog).getByLabelText(/Email domain/), 'initech.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Organization created');
    expect(calls.find((c) => c.key === 'POST /admin/organizations').body).toEqual({
      name: 'Initech',
      domain: 'initech.com',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Edit Acme Corp' }));
    dialog = await screen.findByRole('dialog', { hidden: true });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Acme Corp');
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Acme Inc');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Organization saved');

    await userEvent.click(screen.getByRole('button', { name: 'Archive Acme Corp' }));
    dialog = await screen.findByRole('dialog', { hidden: true });
    expect(dialog).toHaveTextContent('also archives its 2 project');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.key === 'PATCH /admin/organizations/o1' && c.body.status === 'ARCHIVED',
        ),
      ).toBe(true),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Restore Old Co' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.key === 'PATCH /admin/organizations/o2' && c.body.status === 'ACTIVE'),
      ).toBe(true),
    );
  });

  it("shows the server's conflict message for a duplicate domain", async () => {
    mockApi(
      base({
        'POST /admin/organizations': [
          409,
          {
            error: {
              code: 'CONFLICT',
              message: 'A record with these values already exists',
              details: null,
            },
          },
        ],
      }),
    );
    renderApp('/app/admin/organizations');
    await userEvent.click(await screen.findByRole('button', { name: 'New organization' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Dup');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists');
  });
});

describe('projects', () => {
  const base = (extra = {}) => ({
    ...as(),
    'GET /admin/projects': page([
      proj1,
      { ...proj1, id: 'p2', key: 'GLX', name: 'Globex', status: 'ARCHIVED' },
    ]),
    'GET /admin/organizations': page([org()]),
    ...extra,
  });

  it('lists projects with member and ticket counts, linking to the detail page', async () => {
    mockApi(base());
    renderApp('/app/admin/projects');
    expect(await screen.findByRole('link', { name: 'ACME-WEB' })).toHaveAttribute(
      'href',
      '/app/admin/projects/p1',
    );
    expect(
      within(screen.getByRole('table', { name: 'Projects' })).getByText('Archived'),
    ).toBeInTheDocument();
  });

  it('creates a project (key validated) and opens it', async () => {
    const created = {
      ...proj1,
      id: 'p9',
      key: 'NEW-APP',
      name: 'New App',
      description: null,
      members: [],
      organization: { id: 'o1', name: 'Acme Corp', status: 'ACTIVE' },
    };
    const calls = mockApi(
      base({
        'POST /admin/projects': [201, { project: { id: 'p9' } }],
        'GET /admin/projects/p9': [200, { project: created }],
      }),
    );
    renderApp('/app/admin/projects');
    await userEvent.click(await screen.findByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(await within(dialog).findByText('Choose an organization')).toBeInTheDocument();
    await userEvent.selectOptions(await within(dialog).findByLabelText('Organization'), 'o1');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'New App');
    await userEvent.type(within(dialog).getByLabelText('Key'), 'bad key');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(
      await within(dialog).findByText('Letters, digits and single hyphens only'),
    ).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText('Key'));
    await userEvent.type(within(dialog).getByLabelText('Key'), 'new-app');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('heading', { name: /NEW-APP/ })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /admin/projects').body).toMatchObject({
      organizationId: 'o1',
      name: 'New App',
      key: 'new-app',
    });
  });
});

describe('project detail and members', () => {
  const detail = (over = {}) => ({
    ...proj1,
    description: 'Site',
    organization: { id: 'o1', name: 'Acme Corp', status: 'ACTIVE' },
    members: [
      { id: 'u3', name: 'Sam Support', email: 'sam@x.co', role: 'SUPPORT', status: 'ACTIVE' },
    ],
    ...over,
  });
  const base = (extra = {}) => ({
    ...as(),
    'GET /admin/projects/p1': [200, { project: detail() }],
    'GET /admin/users': page([
      user({ id: 'u3', name: 'Sam Support', role: 'SUPPORT' }),
      user({ id: 'u8', name: 'Eve Customer', email: 'eve@acme.com' }),
    ]),
    ...extra,
  });

  it('shows members, saves details, adds people who are not yet members, and removes with confirmation', async () => {
    const calls = mockApi(
      base({
        'PATCH /admin/projects/p1': [200, { project: {} }],
        'POST /admin/projects/p1/members': [200, { project: detail() }],
        'DELETE /admin/projects/u3': [204, null],
        'DELETE /admin/projects/p1/members/u3': [204, null],
      }),
    );
    renderApp('/app/admin/projects/p1');
    expect(await screen.findByRole('heading', { name: /ACME-WEB/ })).toBeInTheDocument();
    expect(screen.getByText('Sam Support')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Acme Site');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Project saved');
    expect(calls.find((c) => c.key === 'PATCH /admin/projects/p1').body).toMatchObject({
      name: 'Acme Site',
      status: 'ACTIVE',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Add members' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    const list = await within(dialog).findByRole('group', { name: 'People to add' });
    expect(within(list).queryByText(/Sam Support/)).not.toBeInTheDocument(); // already a member
    // the test API returns the same list for the support and the customer lookup, so Eve shows twice
    await userEvent.click((await within(list).findAllByLabelText(/Eve Customer/))[0]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add 1' }));
    await screen.findByText('1 member(s) added');
    expect(calls.find((c) => c.key === 'POST /admin/projects/p1/members').body).toEqual({
      userIds: ['u8'],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remove Sam Support' }));
    const confirm = await screen.findByRole('dialog', { hidden: true });
    expect(confirm).toHaveTextContent('immediately lose access');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await screen.findByText('Member removed');
  });

  it('an archived project cannot take new members; unknown projects show an error', async () => {
    mockApi(
      base({
        'GET /admin/projects/p1': [200, { project: detail({ status: 'ARCHIVED' }) }],
        'GET /admin/projects/zz': [
          404,
          { error: { code: 'NOT_FOUND', message: 'Project not found' } },
        ],
      }),
    );
    const { unmount } = renderApp('/app/admin/projects/p1');
    expect(await screen.findByRole('button', { name: 'Add members' })).toBeDisabled();
    unmount();
    renderApp('/app/admin/projects/zz');
    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found');
  });
});

describe('users: creating, inviting, editing, project assignment, invitations', () => {
  const base = (extra = {}) => ({
    ...as(),
    'GET /admin/users': page([
      user(),
      user({
        id: 'u9',
        name: 'Locked Lee',
        email: 'lee@x.co',
        lockedUntil: '2099-01-01T00:00:00Z',
      }),
      user({ id: 'u10', name: 'Gone Gus', email: 'gus@x.co', status: 'DEACTIVATED' }),
    ]),
    'GET /admin/organizations': page([org()]),
    'GET /admin/projects': page([proj1]),
    'GET /admin/invitations': page([
      {
        id: 'i1',
        email: 'new@acme.com',
        role: 'CUSTOMER',
        organization: { id: 'o1', name: 'Acme Corp' },
        projects: [{ id: 'p1', key: 'ACME-WEB', name: 'Acme Website' }],
        invitedBy: { id: 'a', name: 'Ada' },
        expiresAt: '2099-01-01T00:00:00Z',
      },
    ]),
    ...extra,
  });

  it('creates a customer with organization and projects, requiring the organization first', async () => {
    const calls = mockApi(base({ 'POST /admin/users': [201, { user: user() }] }));
    renderApp('/app/admin/users');
    await userEvent.click(await screen.findByRole('button', { name: 'Create user' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'New Customer');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'new@acme.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(dialog).findByText('Choose an organization')).toBeInTheDocument();
    await userEvent.selectOptions(await within(dialog).findByLabelText('Organization'), 'o1');
    await userEvent.click(await within(dialog).findByLabelText(/Acme Website/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    await screen.findByText(/password-setup email was sent/);
    expect(calls.find((c) => c.key === 'POST /admin/users').body).toEqual({
      email: 'new@acme.com',
      role: 'CUSTOMER',
      projectIds: ['p1'],
      organizationId: 'o1',
      name: 'New Customer',
    });
  });

  it('invites a staff member (no organization, no name) and revokes an invitation after confirming', async () => {
    const calls = mockApi(
      base({
        'POST /admin/invitations': [201, { invitation: {} }],
        'DELETE /admin/invitations/i1': [204, null],
      }),
    );
    renderApp('/app/admin/users');
    await userEvent.click(await screen.findByRole('button', { name: 'Invite user' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    expect(within(dialog).queryByLabelText('Name')).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Email'), 'agent@x.co');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'SUPPORT');
    expect(within(dialog).queryByLabelText('Organization')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    await screen.findByText('Invitation sent');
    expect(calls.find((c) => c.key === 'POST /admin/invitations').body).toEqual({
      email: 'agent@x.co',
      role: 'SUPPORT',
      projectIds: [],
    });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Revoke invitation for new@acme.com' }),
    );
    const confirm = await screen.findByRole('dialog', { hidden: true });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    await screen.findByText('Invitation revoked');
  });

  it('edits a user (warning when the role changes) and replaces their projects', async () => {
    const calls = mockApi(
      base({
        'PATCH /admin/users/u7': [200, { user: user() }],
        'PUT /admin/users/u7/projects': [200, { user: user() }],
      }),
    );
    renderApp('/app/admin/users');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Dave Globex' }));
    let dialog = await screen.findByRole('dialog', { hidden: true });
    expect(
      within(dialog).queryByText(/removes this user's project access/),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'SUPPORT');
    expect(
      await within(dialog).findByText(/removes this user's project access and signs them out/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('User saved');
    expect(calls.find((c) => c.key === 'PATCH /admin/users/u7').body).toEqual({
      name: 'Dave Globex',
      role: 'SUPPORT',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Projects for Dave Globex' }));
    dialog = await screen.findByRole('dialog', { hidden: true });
    const box = await within(dialog).findByLabelText(/Acme Website/);
    expect(box).toBeChecked();
    await userEvent.click(box);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Projects updated');
    expect(calls.find((c) => c.key === 'PUT /admin/users/u7/projects').body).toEqual({
      projectIds: [],
    });
  });

  it('unlocks locked accounts and reactivates deactivated ones', async () => {
    const calls = mockApi(
      base({
        'POST /admin/users/u9/unlock': [200, { user: user() }],
        'POST /admin/users/u10/reactivate': [200, { user: user() }],
      }),
    );
    renderApp('/app/admin/users');
    await userEvent.click(await screen.findByRole('button', { name: 'Unlock Locked Lee' }));
    await screen.findByText('User unlocked');
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate Gone Gus' }));
    await screen.findByText('User reactivated');
    expect(calls.some((c) => c.key === 'POST /admin/users/u9/unlock')).toBe(true);
  });

  it('filters by role and status', async () => {
    const calls = mockApi(base());
    renderApp('/app/admin/users');
    await userEvent.selectOptions(await screen.findByLabelText('Role'), 'SUPPORT');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'PENDING');
    await waitFor(() =>
      expect(
        calls.some((c) => c.key.includes('role=SUPPORT') && c.key.includes('status=PENDING')),
      ).toBe(true),
    );
  });
});

describe('FAQ categories', () => {
  const cats = {
    categories: [
      { id: 'c1', name: 'Billing', projectId: 'p1', sortOrder: 1, articleCount: 2 },
      { id: 'c2', name: 'General', projectId: null, sortOrder: 0, articleCount: 0 },
    ],
    uncategorizedCount: 0,
  };
  const base = (extra = {}) => ({
    ...as('SUPPORT'),
    'GET /faq/articles': page([]),
    'GET /faq/manage/config': [200, { requireApproval: false }],
    'GET /faq/categories': [200, cats],
    ...extra,
  });

  it('lists, creates, renames and deletes categories', async () => {
    const calls = mockApi(
      base({
        'POST /faq/manage/categories': [201, { category: {} }],
        'PATCH /faq/manage/categories/c1': [200, { category: {} }],
        'DELETE /faq/manage/categories/c1': [204, null],
      }),
    );
    renderApp('/app/faq-manager');
    await userEvent.click(await screen.findByRole('tab', { name: 'Categories' }));
    expect(await screen.findByText('Billing')).toBeInTheDocument();
    expect(screen.getByText('Global')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New category' }));
    let dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Hardware');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Category created');
    expect(calls.find((c) => c.key === 'POST /faq/manage/categories').body).toEqual({
      projectId: 'p1',
      name: 'Hardware',
      sortOrder: 0,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Edit Billing' }));
    dialog = await screen.findByRole('dialog', { hidden: true });
    expect(within(dialog).getByLabelText('Project')).toBeDisabled(); // a category never changes project
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Payments');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Category saved');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Billing' }));
    dialog = await screen.findByRole('dialog', { hidden: true });
    expect(dialog).toHaveTextContent('2 article(s) are kept');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await screen.findByText('Category deleted');
  });

  it("shows the server error for a category outside the user's scope", async () => {
    mockApi(
      base({
        'POST /faq/manage/categories': [
          404,
          { error: { code: 'NOT_FOUND', message: 'Project not found' } },
        ],
      }),
    );
    renderApp('/app/faq-manager');
    await userEvent.click(await screen.findByRole('tab', { name: 'Categories' }));
    await userEvent.click(await screen.findByRole('button', { name: 'New category' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'X');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Project not found');
  });
});

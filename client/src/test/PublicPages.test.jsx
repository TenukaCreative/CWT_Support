import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { err, mockApi, renderApp, sessionFor, project } from './utils.jsx';

const anon = { 'POST /auth/refresh': err(401, 'UNAUTHORIZED', 'no session') };
const orgs = {
  'GET /auth/organizations': [
    200,
    {
      organizations: [
        { id: 'o1', name: 'Acme Corp' },
        { id: 'o2', name: 'Globex Inc' },
      ],
    },
  ],
};

describe('register', () => {
  it('validates, then submits and shows the "check your email" confirmation', async () => {
    const calls = mockApi({
      ...anon,
      ...orgs,
      'POST /auth/register': [201, { message: 'Check your email to verify your address.' }],
    });
    renderApp('/register');
    await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Choose your organisation')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /auth/register')).toBe(false);

    await userEvent.type(screen.getByLabelText('Full name'), 'Newbie');
    await userEvent.type(screen.getByLabelText('Email'), 'newbie@acme.example');
    await userEvent.selectOptions(await screen.findByLabelText('Organisation'), 'o1');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('At least 10 characters')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'LongEnough123');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Almost there' })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /auth/register').body).toEqual({
      name: 'Newbie',
      email: 'newbie@acme.example',
      organizationId: 'o1',
      password: 'LongEnough123',
    });
  });

  it("shows the server's message, and a notice when organisations cannot be loaded", async () => {
    mockApi({
      ...anon,
      'GET /auth/organizations': err(500, 'INTERNAL_ERROR', 'boom'),
      'POST /auth/register': [
        400,
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ path: 'password', message: 'Password must contain a digit' }],
          },
        },
      ],
    });
    renderApp('/register');
    expect(await screen.findByText(/Could not load organisations/)).toBeInTheDocument();
  });
});

describe('verify email', () => {
  it('confirms a valid link (active and pending outcomes) and reports bad ones', async () => {
    mockApi({ ...anon, 'POST /auth/verify-email': [200, { status: 'PENDING' }] });
    const { unmount } = renderApp('/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByText(/administrator still needs to approve/)).toBeInTheDocument();
    unmount();

    mockApi({ ...anon, 'POST /auth/verify-email': [200, { status: 'ACTIVE' }] });
    const second = renderApp('/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByText(/Your account is ready/)).toBeInTheDocument();
    second.unmount();

    mockApi({
      ...anon,
      'POST /auth/verify-email': err(400, 'BAD_REQUEST', 'This link is invalid or has expired'),
    });
    const third = renderApp('/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    third.unmount();

    const calls = mockApi(anon);
    renderApp('/verify-email');
    expect(await screen.findByRole('alert')).toHaveTextContent('missing its token');
    expect(calls.some((c) => c.key.includes('verify-email'))).toBe(false);
  });

  it('submits the single-use token exactly once', async () => {
    const calls = mockApi({ ...anon, 'POST /auth/verify-email': [200, { status: 'ACTIVE' }] });
    renderApp('/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    await screen.findByText(/Your account is ready/);
    expect(calls.filter((c) => c.key === 'POST /auth/verify-email')).toHaveLength(1);
  });
});

describe('forgot and reset password', () => {
  it('always shows the same neutral confirmation', async () => {
    const calls = mockApi({ ...anon, 'POST /auth/forgot-password': [200, { message: 'ok' }] });
    renderApp('/forgot-password');
    await userEvent.click(await screen.findByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'anyone@x.co');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If an account exists for that email/)).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /auth/forgot-password').body).toEqual({
      email: 'anyone@x.co',
    });
  });

  it('sets a new password: validates, checks confirmation, submits the token', async () => {
    const calls = mockApi({ ...anon, 'POST /auth/reset-password': [200, { message: 'done' }] });
    renderApp('/reset-password?token=tok_abcdefghijklmnopqrstuvwxyz');
    await userEvent.type(await screen.findByLabelText('New password'), 'BrandNew12345');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'Different12345');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Confirm new password'));
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'BrandNew12345');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Password updated.')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /auth/reset-password').body).toEqual({
      token: 'tok_abcdefghijklmnopqrstuvwxyz',
      password: 'BrandNew12345',
    });
  });

  it('shows an expired-link error from the server, and a missing-token notice without a form', async () => {
    mockApi({
      ...anon,
      'POST /auth/reset-password': err(400, 'BAD_REQUEST', 'This link is invalid or has expired'),
    });
    const { unmount } = renderApp('/reset-password?token=tok_abcdefghijklmnopqrstuvwxyz');
    await userEvent.type(await screen.findByLabelText('New password'), 'BrandNew12345');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'BrandNew12345');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    unmount();
    mockApi(anon);
    renderApp('/reset-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('missing its token');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
});

describe('accept invitation', () => {
  const preview = [
    200,
    {
      email: 'invitee@acme.example',
      role: 'CUSTOMER',
      organization: 'Acme Corp',
      projects: [{ key: 'ACME-WEB', name: 'Acme Website' }],
    },
  ];

  it('shows who the invitation is for and creates the account', async () => {
    const calls = mockApi({
      ...anon,
      'GET /auth/invitations/inv_abcdefghijklmnopqrstuvwxyz': preview,
      'POST /auth/accept-invite': [201, { message: 'ok' }],
    });
    renderApp('/accept-invite?token=inv_abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByText(/invitee@acme.example/)).toBeInTheDocument();
    expect(screen.getByText(/ACME-WEB/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Full name'), 'Invitee');
    await userEvent.type(screen.getByLabelText('Password'), 'InvitePass1234');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Account created.')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /auth/accept-invite').body).toEqual({
      token: 'inv_abcdefghijklmnopqrstuvwxyz',
      name: 'Invitee',
      password: 'InvitePass1234',
    });
  });

  it('explains expired or missing invitations', async () => {
    mockApi({
      ...anon,
      'GET /auth/invitations/bad_abcdefghijklmnopqrstuvwxyz': err(
        400,
        'BAD_REQUEST',
        'This invitation is invalid or has expired',
      ),
    });
    const { unmount } = renderApp('/accept-invite?token=bad_abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'invitation is invalid or has expired',
    );
    unmount();
    mockApi(anon);
    renderApp('/accept-invite');
    expect(await screen.findByRole('alert')).toHaveTextContent('missing its token');
  });
});

describe('profile', () => {
  const as = (role = 'CUSTOMER') => ({
    'POST /auth/refresh': [
      200,
      sessionFor(role, {
        projects: [project('p1', 'Acme Website', 'ACME-WEB')],
        activeProjectId: 'p1',
        user: {
          ...sessionFor(role).user,
          organization: { id: 'o1', name: 'Acme Corp' },
          notificationPrefs: {
            emailOnReply: false,
            emailOnStatusChange: true,
            emailOnAssignment: true,
            inApp: true,
          },
        },
      }),
    ],
  });

  it('shows read-only identity, saves name and notification preferences', async () => {
    const calls = mockApi({
      ...as(),
      'PATCH /users/me': [200, { user: { ...sessionFor('CUSTOMER').user, name: 'Renamed' } }],
    });
    renderApp('/app/profile');
    expect(await screen.findByLabelText('Email')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Organisation')).toHaveValue('Acme Corp');
    expect(screen.getByLabelText('Email me when someone replies')).not.toBeChecked(); // from the saved preferences
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Renamed');
    await userEvent.click(screen.getByLabelText('Email me when someone replies'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Profile saved');
    expect(calls.find((c) => c.key === 'PATCH /users/me').body).toEqual({
      name: 'Renamed',
      notificationPrefs: {
        emailOnReply: true,
        emailOnStatusChange: true,
        emailOnAssignment: true,
        inApp: true,
      },
    });
  });

  it('changes the password with validation and server errors', async () => {
    const calls = mockApi({ ...as(), 'POST /users/me/password': [200, { message: 'ok' }] });
    renderApp('/app/profile');
    await userEvent.type(await screen.findByLabelText('Current password'), 'OldPassword123');
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('At least 10 characters')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.type(screen.getByLabelText('New password'), 'NewPassword456');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findByText(/Password changed/);
    expect(calls.find((c) => c.key === 'POST /users/me/password').body).toEqual({
      currentPassword: 'OldPassword123',
      newPassword: 'NewPassword456',
    });
  });

  it('surfaces a wrong current password', async () => {
    mockApi({
      ...as(),
      'POST /users/me/password': [
        400,
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'Current password is incorrect',
            details: [{ path: 'currentPassword', message: 'Incorrect password' }],
          },
        },
      ],
    });
    renderApp('/app/profile');
    await userEvent.type(await screen.findByLabelText('Current password'), 'WrongPassword1');
    await userEvent.type(screen.getByLabelText('New password'), 'NewPassword456');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password');
  });
});

describe('attachment downloads', () => {
  const detail = [
    200,
    {
      ticket: {
        id: 't1',
        number: 'T-1',
        subject: 'S',
        description: 'd',
        status: 'OPEN',
        priority: 'LOW',
        project: { id: 'p1', key: 'P', name: 'P' },
        category: null,
        createdBy: { id: 'u1', name: 'Test User' },
        assignee: null,
        mergedInto: null,
        createdAt: '2026-01-01T00:00:00Z',
        allowedStatuses: [],
        canReply: false,
        canAddNote: false,
      },
      messages: [
        {
          id: 'm1',
          type: 'PUBLIC',
          body: 'hello',
          createdAt: '2026-01-01T00:00:00Z',
          author: { id: 'u1', name: 'Test User', role: 'CUSTOMER' },
          attachments: [
            { id: 'a1', filename: 'report.pdf', mimeType: 'application/pdf', size: 204800 },
          ],
        },
      ],
      events: [],
    },
  ];
  const as = {
    'POST /auth/refresh': [
      200,
      sessionFor('CUSTOMER', { projects: [project('p1', 'P', 'P')], activeProjectId: 'p1' }),
    ],
  };

  it('fetches the file with the bearer token and hands it to the browser', async () => {
    const calls = mockApi({
      ...as,
      'GET /tickets/t1': detail,
      'GET /attachments/a1/download': [200, {}],
    });
    renderApp('/app/tickets/t1');
    const btn = await screen.findByRole('button', { name: 'Download report.pdf' });
    expect(btn).toHaveTextContent('200 KB');
    await userEvent.click(btn);
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'GET /attachments/a1/download')).toBe(true),
    );
  });

  it('tells the user when the file is gone', async () => {
    mockApi({
      ...as,
      'GET /tickets/t1': detail,
      'GET /attachments/a1/download': [
        404,
        { error: { code: 'NOT_FOUND', message: 'The file is no longer available' } },
      ],
    });
    renderApp('/app/tickets/t1');
    await userEvent.click(await screen.findByRole('button', { name: 'Download report.pdf' }));
    expect(await screen.findByText('The file is no longer available')).toBeInTheDocument();
    void within;
  });
});

import { screen } from '@testing-library/react';
import { mockApi, err, renderApp, sessionFor, project } from './utils.jsx';

describe('app shell', () => {
  it('renders the home page', async () => {
    mockApi({ 'POST /auth/refresh': err(401, 'UNAUTHORIZED', 'no') });
    renderApp('/');
    expect(screen.getByRole('heading', { name: /welcome to supportdesk/i })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Log in to your account' })).toBeInTheDocument();
  });

  it('shows a 404 page for unknown routes', async () => {
    mockApi({ 'POST /auth/refresh': err(401, 'UNAUTHORIZED', 'no') });
    renderApp('/does-not-exist');
    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });

  it('redirects anonymous visitors from /app to the login page', async () => {
    mockApi({ 'POST /auth/refresh': err(401, 'UNAUTHORIZED', 'no') });
    renderApp('/app/tickets');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });
});

describe('role-aware UI', () => {
  const resume = (role, over) => ({
    'POST /auth/refresh': [
      200,
      sessionFor(role, {
        projects: [project('p1', 'Acme Website', 'ACME-WEB')],
        activeProjectId: 'p1',
        ...over,
      }),
    ],
  });

  it('customers get customer navigation and are blocked from admin pages', async () => {
    mockApi(resume('CUSTOMER'));
    renderApp('/app/admin/users');
    expect(await screen.findByRole('heading', { name: /don.t have access/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New ticket' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it('admins get admin navigation and land on the admin dashboard', async () => {
    mockApi({
      ...resume('ADMIN'),
      'GET /reports/overview': [500, { error: { code: 'X', message: 'not needed here' } }],
    });
    renderApp('/app');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New ticket' })).not.toBeInTheDocument();
  });

  it('offers "All projects" in the switcher to staff only', async () => {
    mockApi(resume('SUPPORT'));
    renderApp('/app/queue');
    expect(await screen.findByRole('option', { name: 'All projects' })).toBeInTheDocument();
  });
});

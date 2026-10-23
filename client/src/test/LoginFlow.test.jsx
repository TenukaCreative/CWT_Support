import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, err, renderApp, sessionFor, project } from './utils.jsx';

const anon = { 'POST /auth/refresh': err(401, 'UNAUTHORIZED', 'no session') };

async function fillAndSubmit(email = 'alice@acme.example', password = 'Passw0rd!dev') {
  await userEvent.type(await screen.findByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('login', () => {
  it('validates required fields before calling the API', async () => {
    const calls = mockApi(anon);
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /auth/login')).toBe(false);
  });

  it('shows the server error for bad credentials', async () => {
    mockApi({ ...anon, 'POST /auth/login': err(401, 'UNAUTHORIZED', 'Invalid email or password') });
    renderApp('/login');
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('sends a single-project user straight to their dashboard', async () => {
    const session = sessionFor('CUSTOMER', {
      projects: [project('p1', 'Acme Website', 'ACME-WEB')],
      activeProjectId: 'p1',
    });
    mockApi({ ...anon, 'POST /auth/login': [200, session] });
    renderApp('/login');
    await fillAndSubmit();
    expect(
      await screen.findByRole('heading', { name: 'Welcome to Acme Website' }),
    ).toBeInTheDocument();
  });

  it('sends a multi-project user to the picker', async () => {
    const projects = [
      project('p1', 'Acme Website', 'ACME-WEB'),
      project('p2', 'Acme Mobile App', 'ACME-APP'),
    ];
    mockApi({
      ...anon,
      'POST /auth/login': [200, sessionFor('CUSTOMER', { projects, needsProjectSelection: true })],
    });
    renderApp('/login');
    await fillAndSubmit();
    expect(await screen.findByRole('heading', { name: 'Choose a project' })).toBeInTheDocument();
  });
});

describe('project picker', () => {
  const projects = [
    project('p1', 'Acme Website', 'ACME-WEB'),
    project('p2', 'Acme Mobile App', 'ACME-APP'),
  ];

  it('lists project cards, highlights the last used, and selects on click', async () => {
    const pickerSession = sessionFor('CUSTOMER', {
      projects,
      needsProjectSelection: true,
      lastProjectId: 'p2',
    });
    const calls = mockApi({
      'POST /auth/refresh': [200, pickerSession],
      'POST /auth/select-project': [200, { accessToken: 'tok2', activeProjectId: 'p2', projects }],
    });
    renderApp('/app');

    // The guard forces the picker before any app page.
    expect(await screen.findByRole('heading', { name: 'Choose a project' })).toBeInTheDocument();
    expect(screen.getByText('Last used')).toBeInTheDocument();
    expect(screen.queryByText('All projects')).not.toBeInTheDocument(); // customers never get "All"

    await userEvent.click(screen.getByRole('button', { name: /Acme Mobile App/ }));
    expect(
      await screen.findByRole('heading', { name: 'Welcome to Acme Mobile App' }),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /auth/select-project').body).toEqual({
      projectId: 'p2',
    });
  });

  it('offers "All projects" to admins', async () => {
    mockApi({
      'POST /auth/refresh': [200, sessionFor('ADMIN', { projects, needsProjectSelection: true })],
    });
    renderApp('/app');
    expect(await screen.findByRole('button', { name: /All projects/ })).toBeInTheDocument();
  });

  it('shows an explanation when the user has no projects', async () => {
    mockApi({ 'POST /auth/refresh': [200, sessionFor('CUSTOMER', { projects: [] })] });
    renderApp('/select-project');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument(),
    );
  });
});

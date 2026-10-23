import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { titleFor } from '../lib/routeTitles.js';
import { err, mockApi, renderApp, sessionFor, project } from './utils.jsx';

const proj = project('p1', 'Acme Website', 'ACME-WEB');
const customer = (over) => [
  200,
  sessionFor('CUSTOMER', { projects: [proj], activeProjectId: 'p1', ...over }),
];

describe('error boundary', () => {
  let explode = true;
  const Bomb = () => {
    if (explode) throw new Error('kaboom');
    return <p>All good now</p>;
  };

  beforeEach(() => {
    explode = true;
    vi.spyOn(console, 'error').mockImplementation(() => {}); // React logs caught render errors
  });
  afterEach(() => vi.restoreAllMocks());

  it('replaces a crashed screen with a friendly message instead of a blank page, and can recover', async () => {
    render(
      <ErrorBoundary resetKey="a">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
    explode = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('All good now')).toBeInTheDocument();
  });

  it('clears itself when the user navigates elsewhere (new resetKey)', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="a">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    explode = false;
    rerender(
      <ErrorBoundary resetKey="b">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good now')).toBeInTheDocument();
  });
});

describe('navigation accessibility', () => {
  it('maps every screen to a title and falls back for unknown paths', () => {
    expect(titleFor('/app/tickets/abc123')).toBe('Ticket');
    expect(titleFor('/app/tickets/new')).toBe('New ticket');
    expect(titleFor('/app/admin/projects/p1')).toBe('Project');
    expect(titleFor('/login')).toBe('Log in');
    expect(titleFor('/nope/at/all')).toBe('Page not found');
  });

  it('sets the page title on load without stealing focus', async () => {
    mockApi({
      'POST /auth/refresh': customer(),
      'GET /tickets': [200, { items: [], page: 1, limit: 5, total: 0, totalPages: 1 }],
    });
    renderApp('/app');
    await screen.findByRole('heading', { name: /Welcome to Acme Website/ });
    expect(document.title).toBe('Dashboard · SupportDesk');
    expect(document.activeElement).toBe(document.body);
  });

  it('on navigation: updates the title, announces the new screen and moves focus to the main content', async () => {
    mockApi({
      'POST /auth/refresh': customer(),
      'GET /tickets': [200, { items: [], page: 1, limit: 5, total: 0, totalPages: 1 }],
      'GET /faq/categories': [200, { categories: [], uncategorizedCount: 0 }],
      'GET /faq/articles': [200, { items: [], page: 1, limit: 15, total: 0, totalPages: 1 }],
    });
    renderApp('/app');
    await userEvent.click(await screen.findByRole('link', { name: 'Help Center' }));
    await screen.findByRole('heading', { name: 'Help Center' });
    await waitFor(() => expect(document.title).toBe('Help Center · SupportDesk'));
    expect(screen.getByText('Navigated to Help Center')).toBeInTheDocument();
    expect(document.activeElement).toBe(document.getElementById('main'));
  });

  it('typing in a search box (query-string changes) does not move focus or re-announce', async () => {
    mockApi({
      'POST /auth/refresh': customer(),
      'GET /faq/categories': [200, { categories: [], uncategorizedCount: 0 }],
      'GET /faq/articles': [200, { items: [], page: 1, limit: 15, total: 0, totalPages: 1 }],
      'GET /faq/search': [200, { items: [], total: 0, searchLogId: null }],
    });
    renderApp('/app/faq');
    const box = await screen.findByRole('searchbox');
    await userEvent.type(box, 'invoice');
    expect(box).toHaveFocus();
    expect(screen.queryByText(/Navigated to/)).not.toBeInTheDocument();
  });

  it('unknown pages inside the app keep the navigation and offer a way back', async () => {
    mockApi({ 'POST /auth/refresh': customer() });
    renderApp('/app/does/not/exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your dashboard' })).toHaveAttribute(
      'href',
      '/app',
    );
  });

  it('every page has a skip link and a focusable main landmark', async () => {
    mockApi({ 'POST /auth/refresh': err(401, 'UNAUTHORIZED', 'no') });
    renderApp('/login');
    expect(await screen.findByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(document.getElementById('main')).toHaveAttribute('tabindex', '-1');
  });
});

describe('phone-width navigation', () => {
  it('the menu button discloses the navigation, exposes its state, and closes after choosing a page', async () => {
    mockApi({
      'POST /auth/refresh': customer(),
      'GET /tickets': [200, { items: [], page: 1, limit: 5, total: 0, totalPages: 1 }],
      'GET /faq/categories': [200, { categories: [], uncategorizedCount: 0 }],
      'GET /faq/articles': [200, { items: [], page: 1, limit: 15, total: 0, totalPages: 1 }],
    });
    renderApp('/app');
    const menu = await screen.findByRole('button', { name: 'Menu' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveAttribute('aria-controls', nav.id);
    expect(nav.className).toMatch(/\bhidden\b/);

    await userEvent.click(menu);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(nav.className).toMatch(/\bflex\b/);
    expect(nav.className).not.toMatch(/(^|\s)hidden(\s|$)/);

    await userEvent.click(screen.getByRole('link', { name: 'Help Center' }));
    await screen.findByRole('heading', { name: 'Help Center' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute(
        'aria-expanded',
        'false',
      ),
    );
  });
});

describe('session and network failures', () => {
  it('a session that dies mid-use sends the user to the login page and says why', async () => {
    let refreshes = 0;
    mockApi({
      'POST /auth/refresh': () =>
        refreshes++ === 0 ? customer() : err(401, 'UNAUTHORIZED', 'expired'),
      'GET /tickets': err(401, 'UNAUTHORIZED', 'Invalid or expired token'),
    });
    renderApp('/app');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByText('Your session expired. Please log in again.')).toBeInTheDocument();
  });

  it('a first visit without a session does not claim it expired', async () => {
    mockApi({ 'POST /auth/refresh': err(401, 'UNAUTHORIZED', 'no session') });
    renderApp('/login');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByText(/session expired/)).not.toBeInTheDocument();
  });

  it('an unreachable server produces a human message, not "Failed to fetch"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever123');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot reach the server. Check your connection and try again.',
    );
    void act;
  });
});

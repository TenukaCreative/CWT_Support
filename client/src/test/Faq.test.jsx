import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FaqSuggestions from '../components/FaqSuggestions.jsx';
import { mockApi, renderApp, sessionFor, project } from './utils.jsx';

const proj = project('p1', 'Acme Website', 'ACME-WEB');
const customer = {
  'POST /auth/refresh': [200, sessionFor('CUSTOMER', { projects: [proj], activeProjectId: 'p1' })],
};
const support = {
  'POST /auth/refresh': [200, sessionFor('SUPPORT', { projects: [proj], activeProjectId: 'p1' })],
};
const item = (over) => ({
  id: 'a1',
  projectId: 'p1',
  categoryId: null,
  category: null,
  question: 'How do I reset my password?',
  snippet: 'Use the forgot password link.',
  status: 'PUBLISHED',
  sortOrder: 0,
  helpfulYes: 0,
  helpfulNo: 0,
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});
const page = (items) => [200, { items, page: 1, limit: 15, total: items.length, totalPages: 1 }];
const article = (over) => ({
  ...item(),
  answer: 'Use **Forgot password**.',
  answerHtml: '<p>Use <strong>Forgot password</strong>.</p>',
  createdAt: '2026-01-01T00:00:00Z',
  myVote: null,
  ...over,
});

describe('Help Center', () => {
  it('browses by category and filters when a category is chosen', async () => {
    const calls = mockApi({
      ...customer,
      'GET /faq/categories': [
        200,
        {
          categories: [
            { id: 'c1', name: 'Billing', projectId: 'p1', sortOrder: 0, articleCount: 1 },
            { id: 'c2', name: 'Empty', projectId: 'p1', sortOrder: 1, articleCount: 0 },
          ],
          uncategorizedCount: 1,
        },
      ],
      'GET /faq/articles': page([item({ question: 'Where are my invoices?' })]),
    });
    renderApp('/app/faq');
    expect(await screen.findByRole('link', { name: 'Where are my invoices?' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Categories' });
    expect(within(group).queryByText('Empty')).not.toBeInTheDocument(); // empty categories are hidden
    await userEvent.click(within(group).getByRole('button', { name: 'Billing' }));
    await screen.findByRole('link', { name: 'Where are my invoices?' });
    expect(calls.some((c) => c.key.includes('categoryId=c1'))).toBe(true);
  });

  it('searches as you type and links results back to the search for click tracking', async () => {
    const calls = mockApi({
      ...customer,
      'GET /faq/categories': [200, { categories: [], uncategorizedCount: 0 }],
      'GET /faq/articles': page([]),
      'GET /faq/search': [200, { items: [item()], total: 1, searchLogId: 'log1' }],
      'POST /faq/search-logs/log1/click': [204, null],
      'GET /faq/articles/a1': [200, { article: article() }],
    });
    renderApp('/app/faq');
    await userEvent.type(
      await screen.findByRole('searchbox', { name: /search the help center/i }),
      'reset pass',
    );
    const link = await screen.findByRole(
      'link',
      { name: 'How do I reset my password?' },
      { timeout: 2000 },
    );
    expect(calls.some((c) => c.key.startsWith('GET /faq/search?q=reset+pass'))).toBe(true);

    await userEvent.click(link);
    expect(
      await screen.findByRole('heading', { name: 'How do I reset my password?' }),
    ).toBeInTheDocument();
    await screen.findByText('Forgot password');
    expect(calls.find((c) => c.key === 'POST /faq/search-logs/log1/click').body).toEqual({
      articleId: 'a1',
    });
  });

  it('offers to create a ticket when nothing matches', async () => {
    mockApi({
      ...customer,
      'GET /faq/categories': [200, { categories: [], uncategorizedCount: 0 }],
      'GET /faq/articles': page([]),
      'GET /faq/search': [200, { items: [], total: 0, searchLogId: null }],
    });
    renderApp('/app/faq?q=invoice pdf');
    expect(await screen.findByText(/No articles match/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a ticket' })).toHaveAttribute(
      'href',
      '/app/tickets/new',
    );
  });

  it('the dashboard quick search jumps to the help center', async () => {
    mockApi({
      ...customer,
      'GET /faq/categories': [200, { categories: [], uncategorizedCount: 0 }],
      'GET /faq/articles': page([]),
      'GET /faq/search': [200, { items: [item()], total: 1, searchLogId: null }],
    });
    renderApp('/app');
    await userEvent.type(await screen.findByLabelText('How can we help?'), 'password{Enter}');
    expect(await screen.findByRole('searchbox', { name: /search the help center/i })).toHaveValue(
      'password',
    );
  });
});

describe('article page', () => {
  it("renders the server HTML and records the customer's vote", async () => {
    const calls = mockApi({
      ...customer,
      'GET /faq/articles/a1': [200, { article: article() }],
      'POST /faq/articles/a1/vote': [200, { helpfulYes: 1, helpfulNo: 0, myVote: true }],
    });
    renderApp('/app/faq/a1');
    expect(await screen.findByText('Forgot password')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await screen.findByText(/Thanks! You can change/);
    expect(calls.find((c) => c.key.includes('/vote')).body).toEqual({ helpful: true });
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/Still need help/)).not.toBeInTheDocument();
  });

  it('after a "No" vote it points to ticket creation', async () => {
    mockApi({
      ...customer,
      'GET /faq/articles/a1': [200, { article: article({ myVote: false }) }],
    });
    renderApp('/app/faq/a1');
    expect(await screen.findByRole('link', { name: 'Create a ticket' })).toBeInTheDocument();
  });

  it('staff do not get vote buttons; missing articles show a friendly message', async () => {
    mockApi({
      ...support,
      'GET /faq/articles/a1': [200, { article: article({ status: 'DRAFT' }) }],
      'GET /faq/articles/zz': [404, { error: { code: 'NOT_FOUND', message: 'Article not found' } }],
    });
    renderApp('/app/faq/a1');
    expect(await screen.findByText('Draft')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument();
  });

  it('404 shows a not-available message', async () => {
    mockApi({
      ...customer,
      'GET /faq/articles/zz': [404, { error: { code: 'NOT_FOUND', message: 'Article not found' } }],
    });
    renderApp('/app/faq/zz');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /does not exist or is not available/,
    );
  });
});

describe('FaqSuggestions', () => {
  const renderSuggestions = (query) =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <FaqSuggestions query={query} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('stays silent for short input and suggests articles for longer input', async () => {
    const calls = mockApi({
      'GET /faq/suggest': [200, { items: [item()], total: 1, searchLogId: null }],
    });
    const { rerender, container } = renderSuggestions('ab');
    await new Promise((r) => setTimeout(r, 500));
    expect(calls).toHaveLength(0);
    expect(container).toBeEmptyDOMElement();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FaqSuggestions query="reset my password" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const region = await screen.findByRole(
      'region',
      { name: 'Suggested articles' },
      { timeout: 2000 },
    );
    expect(
      within(region).getByRole('link', { name: 'How do I reset my password?' }),
    ).toHaveAttribute('target', '_blank');
  });
});

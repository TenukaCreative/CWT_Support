import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, sessionFor, project } from './utils.jsx';

const proj = project('p1', 'Acme Website', 'ACME-WEB');
const session = (role) => ({
  'POST /auth/refresh': [200, sessionFor(role, { projects: [proj], activeProjectId: 'p1' })],
});
const row = {
  id: 'a1',
  projectId: 'p1',
  categoryId: null,
  category: null,
  question: 'How do I export data?',
  snippet: 's',
  status: 'DRAFT',
  sortOrder: 0,
  helpfulYes: 2,
  helpfulNo: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};
const base = (role, extra = {}) => ({
  ...session(role),
  'GET /faq/articles': [200, { items: [row], page: 1, limit: 15, total: 1, totalPages: 1 }],
  'GET /faq/manage/config': [200, { requireApproval: false }],
  'GET /faq/categories': [200, { categories: [], uncategorizedCount: 0 }],
  ...extra,
});

describe('FAQ manager', () => {
  it('lists articles with status and votes', async () => {
    mockApi(base('SUPPORT'));
    renderApp('/app/faq-manager');
    expect(await screen.findByRole('link', { name: 'How do I export data?' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('2 / 1')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('ACME-WEB')).toBeInTheDocument();
  });

  it('creates an article with a live markdown preview', async () => {
    const calls = mockApi(
      base('SUPPORT', {
        'POST /faq/manage/preview': [200, { answerHtml: '<p><strong>Export</strong></p>' }],
        'POST /faq/manage/articles': [201, { article: { ...row, answer: 'x', answerHtml: '' } }],
      }),
    );
    renderApp('/app/faq-manager');
    await userEvent.click(await screen.findByRole('button', { name: 'New article' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.type(within(dialog).getByLabelText('Question'), 'How do I export data?');
    await userEvent.type(within(dialog).getByLabelText(/Answer \(markdown\)/), 'Use **Export**');
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Answer preview')).toHaveTextContent('Export'),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText('Status'), 'PUBLISHED');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save article' }));

    await screen.findByText('Article created');
    expect(calls.find((c) => c.key === 'POST /faq/manage/articles').body).toMatchObject({
      projectId: 'p1',
      question: 'How do I export data?',
      answer: 'Use **Export**',
      status: 'PUBLISHED',
      categoryId: null,
    });
  });

  it('when approval is required, support cannot choose Published; admins get the toggle', async () => {
    mockApi(base('SUPPORT', { 'GET /faq/manage/config': [200, { requireApproval: true }] }));
    const { unmount } = renderApp('/app/faq-manager');
    expect(
      await screen.findByText(/Publishing requires administrator approval/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New article' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    expect(within(dialog).getByRole('option', { name: 'Published' })).toBeDisabled();
    unmount();

    mockApi(base('ADMIN', { 'GET /faq/manage/config': [200, { requireApproval: true }] }));
    renderApp('/app/faq-manager');
    const toggle = await screen.findByRole('checkbox', { name: /Require administrator approval/ });
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('asks before deleting', async () => {
    const calls = mockApi(base('SUPPORT', { 'DELETE /faq/manage/articles/a1': [204, null] }));
    renderApp('/app/faq-manager');
    await userEvent.click(
      await screen.findByRole('button', { name: /Delete How do I export data/ }),
    );
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await screen.findByText('Article deleted');
  });

  it('shows search gaps', async () => {
    mockApi(
      base('SUPPORT', {
        'GET /faq/manage/search-insights': [
          200,
          {
            days: 30,
            totals: { searches: 10, zeroResults: 3, clicked: 5, ticketsAfter: 2 },
            zeroResults: [
              { query: 'invoice pdf', count: 3, lastSearchedAt: '2026-01-02T00:00:00Z' },
            ],
            topQueries: [{ query: 'reset password', count: 5, avgResults: 2 }],
          },
        ],
      }),
    );
    renderApp('/app/faq-manager');
    await userEvent.click(await screen.findByRole('tab', { name: 'Search gaps' }));
    expect(await screen.findByText('invoice pdf')).toBeInTheDocument();
    expect(screen.getByText('Found nothing').previousSibling).toHaveTextContent('3');
  });

  it('customers cannot open the manager', async () => {
    mockApi(session('CUSTOMER'));
    renderApp('/app/faq-manager');
    expect(await screen.findByRole('heading', { name: /don.t have access/i })).toBeInTheDocument();
  });
});

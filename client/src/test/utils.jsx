import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import App from '../App.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { setAccessToken } from '../api/client.js';

// routes: { 'METHOD /path': [status, body] | (body) => [status, body] }
export function mockApi(routes) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const key = `${init.method ?? 'GET'} ${String(url).replace('/api/v1', '')}`;
      // JSON bodies are parsed; multipart bodies become plain objects (files by name).
      let sent;
      if (init.body instanceof FormData) {
        sent = {};
        for (const [k, v] of init.body.entries()) {
          const val = typeof v === 'string' ? v : v.name;
          sent[k] = k in sent ? [].concat(sent[k], val) : val;
        }
      } else if (init.body) sent = JSON.parse(init.body);
      calls.push({ key, body: sent });
      // Exact match first, then the same route ignoring its query string.
      // The header bell polls on every page; tests that do not care get an empty inbox.
      const quiet = key.startsWith('GET /notifications/unread-count') ? [200, { unread: 0 }] : null;
      const entry = routes[key] ?? routes[key.split('?')[0]] ?? quiet;
      if (!entry)
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ error: { code: 'NOT_FOUND', message: `no mock for ${key}` } }),
        };
      const [status, body] = typeof entry === 'function' ? entry() : entry;
      return {
        ok: status < 400,
        status,
        statusText: '',
        json: async () => body,
        blob: async () => new Blob(['Ticket,Subject\r\n'], { type: 'text/csv' }),
      };
    }),
  );
  return calls;
}

export const err = (status, code, message) => [status, { error: { code, message, details: null } }];

export function renderApp(path) {
  setAccessToken(null);
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export const project = (id, name, key, org = 'Acme Corp') => ({
  id,
  name,
  key,
  description: null,
  organization: { id: 'o', name: org },
});
export const sessionFor = (role, over = {}) => ({
  accessToken: 'tok',
  user: {
    id: 'u1',
    name: 'Test User',
    email: 't@x.co',
    role,
    organizationId: null,
    organization: null,
    notificationPrefs: null,
  },
  projects: [],
  activeProjectId: null,
  lastProjectId: null,
  needsProjectSelection: false,
  ...over,
});

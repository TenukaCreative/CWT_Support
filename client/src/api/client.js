const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// The access token lives in memory only (never localStorage): an XSS bug cannot read it from
// storage, and a page reload recovers the session through the httpOnly refresh cookie instead.
let accessToken = null;
let handlers = { onSession: () => {}, onLogout: () => {} };

export const setAccessToken = (t) => {
  accessToken = t;
};
export const configureAuth = (h) => {
  handlers = h;
};

async function rawFetch(path, { method = 'GET', body, headers } = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  // fetch() rejects (TypeError) when the server cannot be reached at all; give that a human message.
  return fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      // For FormData the browser must set the multipart boundary itself.
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      'X-Requested-With': 'SupportDesk', // CSRF header required by cookie endpoints
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  }).catch(() => {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach the server. Check your connection and try again.',
    );
  });
}

async function toError(res) {
  const data = await res.json().catch(() => null);
  const e = data?.error;
  return new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.message ?? res.statusText, e?.details);
}

async function send(path, options) {
  const res = await rawFetch(path, options);
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? null : await res.json().catch(() => null);
}

// Refresh tokens are single-use (rotation), so concurrent 401s MUST share one refresh call;
// a second parallel call would look like token theft to the server and end the session.
let refreshing = null;
export function refreshSession() {
  refreshing ??= send('/auth/refresh', { method: 'POST' })
    .then((session) => {
      accessToken = session.accessToken;
      handlers.onSession(session);
      return session;
    })
    .catch((err) => {
      accessToken = null;
      handlers.onLogout();
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// Run a request; on 401 refresh the session once and retry.
// skipRefresh: for calls where a 401 is a real answer (wrong password), not an expired token.
async function withRefresh(fn, skipRefresh) {
  try {
    return await fn();
  } catch (err) {
    if (err.status === 401 && !skipRefresh && accessToken) {
      await refreshSession(); // throws (and logs out) if the session is really gone
      return fn();
    }
    throw err;
  }
}

export const api = (path, options = {}) =>
  withRefresh(() => send(path, options), options.skipRefresh);

// Authenticated file download: the API needs the bearer token, so a plain <a href> cannot be used.
export const apiBlob = (path) =>
  withRefresh(async () => {
    const res = await rawFetch(path);
    if (!res.ok) throw await toError(res);
    return res.blob();
  });

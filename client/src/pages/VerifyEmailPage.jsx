import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import Alert from '../components/Alert.jsx';

export default function VerifyEmailPage() {
  const token = useSearchParams()[0].get('token');
  const [state, setState] = useState(
    token ? { phase: 'loading' } : { phase: 'error', message: 'This link is missing its token.' },
  );
  const started = useRef(false); // the token is single-use; never submit it twice (StrictMode)

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token }, skipRefresh: true })
      .then((r) => setState({ phase: 'done', status: r.status }))
      .catch((e) => setState({ phase: 'error', message: e.message }));
  }, [token]);

  return (
    <div className="card mx-auto max-w-sm space-y-3">
      <h1 className="text-xl font-semibold">Email verification</h1>
      {state.phase === 'loading' && <p role="status">Verifying…</p>}
      {state.phase === 'error' && <Alert type="error">{state.message}</Alert>}
      {state.phase === 'done' && (
        <Alert type="success">
          {state.status === 'ACTIVE'
            ? 'Email verified. Your account is ready.'
            : 'Email verified. An administrator still needs to approve your account; you will be able to log in afterwards.'}
        </Alert>
      )}
      <Link to="/login" className="text-sm text-brand-700 underline">
        Go to log in
      </Link>
    </div>
  );
}

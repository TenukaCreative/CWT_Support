import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, configureAuth, refreshSession, setAccessToken } from '../api/client.js';

const AuthContext = createContext(null);

const ANON = {
  status: 'anonymous',
  user: null,
  projects: [],
  activeProjectId: null,
  lastProjectId: null,
  needsProjectSelection: false,
};

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ...ANON, status: 'loading' });
  // True when a session that WAS working could no longer be refreshed (so the login page can say why).
  const [expired, setExpired] = useState(false);
  const statusRef = useRef('loading');
  statusRef.current = state.status;

  const applySession = useCallback((s) => {
    setState({
      status: 'authenticated',
      user: s.user,
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      lastProjectId: s.lastProjectId ?? null,
      needsProjectSelection: s.needsProjectSelection ?? false,
    });
  }, []);

  useEffect(() => {
    configureAuth({
      onSession: applySession,
      onLogout: () => {
        if (statusRef.current === 'authenticated') setExpired(true);
        setState(ANON);
      },
    });
    // On load, try to resume the session from the httpOnly refresh cookie.
    refreshSession().catch(() => {});
  }, [applySession]);

  const login = useCallback(
    async (email, password) => {
      const session = await api('/auth/login', {
        method: 'POST',
        body: { email, password },
        skipRefresh: true,
      });
      setAccessToken(session.accessToken);
      setExpired(false);
      applySession(session);
      return session;
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', skipRefresh: true });
    } finally {
      setAccessToken(null);
      setExpired(false);
      setState(ANON);
    }
  }, []);

  const selectProject = useCallback(async (projectId) => {
    const res = await api('/auth/select-project', { method: 'POST', body: { projectId } });
    setAccessToken(res.accessToken);
    setState((s) => ({
      ...s,
      activeProjectId: res.activeProjectId,
      lastProjectId: res.activeProjectId,
      needsProjectSelection: false,
    }));
  }, []);

  const setUser = useCallback((user) => setState((s) => ({ ...s, user })), []);

  const value = useMemo(
    () => ({ ...state, expired, login, logout, selectProject, setUser }),
    [state, expired, login, logout, selectProject, setUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

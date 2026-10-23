import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ForbiddenPage from '../pages/ForbiddenPage.jsx';

export function RequireAuth() {
  const { status, needsProjectSelection } = useAuth();
  const location = useLocation();

  if (status === 'loading')
    return (
      <p role="status" className="p-8 text-slate-500">
        Loading…
      </p>
    );
  if (status === 'anonymous')
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (needsProjectSelection && location.pathname !== '/select-project') {
    return <Navigate to="/select-project" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

// UI-level convenience only; the API enforces the same rules and is the real authority.
export function RequireRole({ roles, children }) {
  const { user } = useAuth();
  return roles.includes(user.role) ? children : <ForbiddenPage />;
}

import { Link, Outlet, useLocation } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { homeFor } from '../lib/navigation.js';
import BrandLogo from '../components/BrandLogo.jsx';

export default function PublicLayout() {
  const { status, user } = useAuth();
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <BrandLogo to="/" />
          <nav aria-label="Account" className="flex items-center gap-4 text-sm">
            {status === 'authenticated' ? (
              <Link
                to={homeFor(user.role)}
                className="text-slate-200 hover:text-white focus-visible:outline-white"
              >
                Open app
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-slate-200 hover:text-white focus-visible:outline-white"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700 focus-visible:outline-white"
                >
                  Register
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 focus:outline-none"
      >
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}

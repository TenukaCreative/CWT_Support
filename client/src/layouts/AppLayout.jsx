import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { navFor } from '../lib/navigation.js';
import ProjectSwitcher from '../components/ProjectSwitcher.jsx';
import NotificationBell from '../components/NotificationBell.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import BrandLogo from '../components/BrandLogo.jsx';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false); // phone-width navigation disclosure
  useEffect(() => setMenuOpen(false), [pathname]);
  const links = navFor(user.role);

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="bg-slate-900 text-slate-100 md:w-64">
        <div className="flex items-center justify-between px-4 py-4">
          <BrandLogo to="/app" />
          <button
            type="button"
            className="btn-secondary border-slate-600 bg-transparent text-white hover:bg-white/10 md:hidden"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? 'Close menu' : 'Menu'}
          </button>
        </div>
        <nav
          id="main-nav"
          aria-label="Main"
          className={`${menuOpen ? 'flex' : 'hidden'} flex-wrap gap-1 px-2 pb-3 md:flex md:flex-col`}
        >
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `rounded px-3 py-2 text-sm focus-visible:outline-white ${
                  isActive
                    ? 'bg-brand-600 font-medium text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 text-sm">
          <ProjectSwitcher />
          <div className="flex items-center gap-4">
            <NotificationBell />
            <Link to="/app/profile" className="hover:underline">
              {user.name}{' '}
              <span className="text-xs text-slate-500">({user.role.toLowerCase()})</span>
            </Link>
            <button type="button" onClick={onLogout} className="btn-secondary">
              Log out
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 p-6 focus:outline-none">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

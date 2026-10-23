import { Navigate, Route, Routes } from 'react-router-dom';
import PublicLayout from './layouts/PublicLayout.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import HomePage from './pages/HomePage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import RouteAnnouncer from './components/RouteAnnouncer.jsx';
import ProjectPickerPage from './pages/ProjectPickerPage.jsx';
import { RequireAuth, RequireRole } from './components/guards.jsx';
import { appRoutes, publicRoutes } from './routes.jsx';

export default function App() {
  return (
    <>
      <RouteAnnouncer />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<HomePage />} />
          {publicRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<PublicLayout />}>
            <Route path="select-project" element={<ProjectPickerPage />} />
          </Route>
          <Route path="app" element={<AppLayout />}>
            {appRoutes.map((r) => (
              <Route
                key={r.path ?? 'index'}
                index={r.index}
                path={r.path}
                element={
                  r.roles ? <RequireRole roles={r.roles}>{r.element}</RequireRole> : r.element
                }
              />
            ))}
            <Route path="*" element={<NotFoundPage inApp />} />
          </Route>
        </Route>

        <Route path="home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

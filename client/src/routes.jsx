import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import AcceptInvitePage from './pages/AcceptInvitePage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import RoleHome from './pages/RoleHome.jsx';
import FaqPage from './pages/faq/FaqPage.jsx';
import FaqArticlePage from './pages/faq/FaqArticlePage.jsx';
import FaqManagerPage from './pages/faq/FaqManagerPage.jsx';
import TicketListPage from './pages/tickets/TicketListPage.jsx';
import NewTicketPage from './pages/tickets/NewTicketPage.jsx';
import TicketDetailPage from './pages/tickets/TicketDetailPage.jsx';
import QueuePage from './pages/tickets/QueuePage.jsx';
import CannedRepliesPage from './pages/tickets/CannedRepliesPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import AdminSettingsPage from './pages/admin/AdminSettingsPage.jsx';
import AdminDashboardPage from './pages/reports/AdminDashboardPage.jsx';
import StatsPage from './pages/reports/StatsPage.jsx';
import AuditLogPage from './pages/admin/AuditLogPage.jsx';
import UsersPage from './pages/admin/UsersPage.jsx';
import PendingApprovalsPage from './pages/admin/PendingApprovalsPage.jsx';
import OrganizationsPage from './pages/admin/OrganizationsPage.jsx';
import ProjectsPage from './pages/admin/ProjectsPage.jsx';
import ProjectDetailPage from './pages/admin/ProjectDetailPage.jsx';

export const publicRoutes = [
  { path: 'login', element: <LoginPage /> },
  { path: 'register', element: <RegisterPage /> },
  { path: 'verify-email', element: <VerifyEmailPage /> },
  { path: 'forgot-password', element: <ForgotPasswordPage /> },
  { path: 'reset-password', element: <ResetPasswordPage /> },
  { path: 'accept-invite', element: <AcceptInvitePage /> },
];

const STAFF = ['SUPPORT', 'ADMIN'];
const ADMIN = ['ADMIN'];
const CUSTOMER = ['CUSTOMER'];

// `roles` is a UI guard; each real API route enforces its own rules server-side.
export const appRoutes = [
  { index: true, element: <RoleHome /> },
  { path: 'profile', element: <ProfilePage /> },
  { path: 'notifications', element: <NotificationsPage /> },
  { path: 'faq', roles: CUSTOMER, element: <FaqPage /> },
  { path: 'faq/:id', element: <FaqArticlePage /> },
  { path: 'tickets', roles: CUSTOMER, element: <TicketListPage /> },
  { path: 'tickets/new', roles: CUSTOMER, element: <NewTicketPage /> },
  { path: 'tickets/:id', element: <TicketDetailPage /> },
  { path: 'queue', roles: STAFF, element: <QueuePage /> },
  {
    path: 'assigned',
    roles: STAFF,
    element: (
      <QueuePage
        preset={{ assigneeId: 'me' }}
        title="My assigned tickets"
        subtitle="Tickets assigned to you."
      />
    ),
  },
  { path: 'canned-replies', roles: STAFF, element: <CannedRepliesPage /> },
  { path: 'faq-manager', roles: STAFF, element: <FaqManagerPage /> },
  { path: 'stats', roles: STAFF, element: <StatsPage /> },
  { path: 'admin', roles: ADMIN, element: <AdminDashboardPage /> },
  { path: 'admin/users', roles: ADMIN, element: <UsersPage /> },
  { path: 'admin/pending', roles: ADMIN, element: <PendingApprovalsPage /> },
  { path: 'admin/organizations', roles: ADMIN, element: <OrganizationsPage /> },
  { path: 'admin/projects', roles: ADMIN, element: <ProjectsPage /> },
  { path: 'admin/projects/:id', roles: ADMIN, element: <ProjectDetailPage /> },
  { path: 'admin/settings', roles: ADMIN, element: <AdminSettingsPage /> },
  { path: 'admin/audit', roles: ADMIN, element: <AuditLogPage /> },
];

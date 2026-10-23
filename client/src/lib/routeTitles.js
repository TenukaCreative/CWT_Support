import { matchPath } from 'react-router-dom';

// One title per screen: announced to screen readers on navigation, shown in the browser tab and
// in history. Dynamic screens (a ticket, an article) use a generic title: the page's own <h1>
// carries the specific name.
const TITLES = [
  ['/', 'Home'],
  ['/login', 'Log in'],
  ['/register', 'Create your account'],
  ['/verify-email', 'Verify your email'],
  ['/forgot-password', 'Forgot password'],
  ['/reset-password', 'Choose a new password'],
  ['/accept-invite', 'Accept your invitation'],
  ['/select-project', 'Choose a project'],
  ['/app', 'Dashboard'],
  ['/app/faq', 'Help Center'],
  ['/app/faq/:id', 'Help article'],
  ['/app/tickets', 'Tickets'],
  ['/app/tickets/new', 'New ticket'],
  ['/app/tickets/:id', 'Ticket'],
  ['/app/queue', 'Ticket queue'],
  ['/app/assigned', 'My assigned tickets'],
  ['/app/faq-manager', 'FAQ manager'],
  ['/app/canned-replies', 'Canned replies'],
  ['/app/stats', 'My stats'],
  ['/app/profile', 'Profile'],
  ['/app/notifications', 'Notifications'],
  ['/app/admin', 'Dashboard'],
  ['/app/admin/users', 'Users'],
  ['/app/admin/pending', 'Pending registrations'],
  ['/app/admin/organizations', 'Organizations'],
  ['/app/admin/projects', 'Projects'],
  ['/app/admin/projects/:id', 'Project'],
  ['/app/admin/settings', 'Categories, priorities and SLA'],
  ['/app/admin/audit', 'Audit log'],
];

export function titleFor(pathname) {
  const hit = TITLES.find(([pattern]) => matchPath({ path: pattern, end: true }, pathname));
  return hit ? hit[1] : 'Page not found';
}

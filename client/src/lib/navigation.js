// Role-aware navigation. This only decides what to *show*; the server is always the authority.
const customer = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/faq', label: 'Help Center' },
  { to: '/app/tickets', label: 'My tickets', end: true },
  { to: '/app/tickets/new', label: 'New ticket' },
];

const support = [
  { to: '/app/queue', label: 'Ticket queue' },
  { to: '/app/assigned', label: 'My tickets' },
  { to: '/app/faq-manager', label: 'FAQ manager' },
  { to: '/app/canned-replies', label: 'Canned replies' },
  { to: '/app/stats', label: 'My stats' },
];

const admin = [
  { to: '/app/admin', label: 'Dashboard', end: true },
  ...support.slice(0, 4),
  { to: '/app/admin/users', label: 'Users' },
  { to: '/app/admin/pending', label: 'Pending approvals' },
  { to: '/app/admin/organizations', label: 'Organizations' },
  { to: '/app/admin/projects', label: 'Projects' },
  { to: '/app/admin/settings', label: 'Categories & SLA' },
  { to: '/app/admin/audit', label: 'Audit log' },
];

export const navFor = (role) =>
  ({ CUSTOMER: customer, SUPPORT: support, ADMIN: admin })[role] ?? [];

export const homeFor = (role) =>
  ({ CUSTOMER: '/app', SUPPORT: '/app/queue', ADMIN: '/app/admin' })[role] ?? '/app';

import {
  LayoutDashboard,
  LifeBuoy,
  Ticket,
  Plus,
  Inbox,
  UserCheck,
  BookOpen,
  MessageSquareText,
  BarChart3,
  Users,
  Building2,
  FolderKanban,
  Settings,
  ScrollText,
} from 'lucide-react';

const customer = [
  { to: '/app', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/app/faq', label: 'Help Center', icon: LifeBuoy },
  { to: '/app/tickets', label: 'My tickets', end: true, icon: Ticket },
  { to: '/app/tickets/new', label: 'New ticket', icon: Plus },
];

const support = [
  { to: '/app/queue', label: 'Ticket queue', icon: Inbox },
  { to: '/app/assigned', label: 'My tickets', icon: UserCheck },
  { to: '/app/faq-manager', label: 'FAQ manager', icon: BookOpen },
  { to: '/app/canned-replies', label: 'Canned replies', icon: MessageSquareText },
  { to: '/app/stats', label: 'My stats', icon: BarChart3 },
];

const admin = [
  { to: '/app/admin', label: 'Dashboard', end: true, icon: LayoutDashboard },
  ...support.slice(0, 4),
  { to: '/app/admin/users', label: 'Users', icon: Users },
  { to: '/app/admin/pending', label: 'Pending approvals', icon: UserCheck },
  { to: '/app/admin/organizations', label: 'Organizations', icon: Building2 },
  { to: '/app/admin/projects', label: 'Projects', icon: FolderKanban },
  { to: '/app/admin/settings', label: 'Categories & SLA', icon: Settings },
  { to: '/app/admin/audit', label: 'Audit log', icon: ScrollText },
];

export const navFor = (role) =>
  ({ CUSTOMER: customer, SUPPORT: support, ADMIN: admin })[role] ?? [];

export const homeFor = (role) =>
  ({ CUSTOMER: '/app', SUPPORT: '/app/queue', ADMIN: '/app/admin' })[role] ?? '/app';

import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import invitationRoutes from './invitation.routes.js';
import adminRoutes from './admin.routes.js';
import faqRoutes from './faq.routes.js';
import notificationRoutes from './notification.routes.js';
import reportRoutes from './report.routes.js';
import ticketRoutes from './ticket.routes.js';

// The ONE list of feature routers and where they are mounted under /api/v1. routes/index.js
// registers them from here, and the OpenAPI generator and the route-matrix security test read
// the same list, so a router can never exist that those tools do not see.
export const mounts = [
  ['/health', healthRoutes],
  ['/auth', authRoutes],
  ['/users', userRoutes],
  ['/invitations', invitationRoutes],
  ['/admin', adminRoutes],
  ['/faq', faqRoutes],
  ['/notifications', notificationRoutes],
  ['/reports', reportRoutes],
  ['/', ticketRoutes],
];

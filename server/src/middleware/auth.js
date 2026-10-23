import { prisma } from '../lib/prisma.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { buildScope } from '../lib/scope.js';
import { scopedDb } from '../lib/scopedDb.js';
import { getAccessibleProjects } from '../lib/access.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Verifies the bearer token, RELOADS the user (so deactivation / role changes take effect on the
// very next request instead of when the token expires), recomputes the project scope from current
// memberships, and attaches:
//   req.auth = { user, scope }   identity + what it may reach
//   req.db                       Prisma client already constrained to that scope
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) throw unauthorized();

  let payload;
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch {
    throw unauthorized('Invalid or expired token');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { organization: { select: { id: true, name: true } } },
  });
  if (!user || user.status !== 'ACTIVE') throw unauthorized();

  const accessibleProjectIds =
    user.role === 'ADMIN' ? [] : (await getAccessibleProjects(user)).map((p) => p.id);

  const scope = buildScope({
    role: user.role,
    userId: user.id,
    organizationId: user.organizationId,
    activeProjectId: payload.pid ?? null,
    accessibleProjectIds,
  });

  req.auth = { user, scope };
  req.db = scopedDb(scope);
  next();
});

authenticate.meta = { auth: true };

// Middleware factories attach `meta` so tooling (the OpenAPI generator and the route-matrix security
// test) can read what each route enforces without guessing.
export const requireRole = (...roles) =>
  Object.assign(
    (req, _res, next) => (roles.includes(req.auth.user.role) ? next() : next(forbidden())),
    { meta: { roles } },
  );

// For routes that read/write tenant data: an active, still-valid project must be selected.
export const requireProject = Object.assign(
  (req, _res, next) => {
    const { activeProjectId, projectIds } = req.auth.scope;
    if (!activeProjectId || (projectIds !== null && projectIds.length === 0)) {
      return next(new AppError(409, 'PROJECT_REQUIRED', 'Select a project first'));
    }
    next();
  },
  { meta: { project: true } },
);

// Cookie-authenticated endpoints (refresh/logout) are CSRF-protected in two ways:
// a custom header (cross-site forms/fetches cannot set it without a CORS preflight, which our
// allow-list rejects) and an Origin check when the browser sends one. SameSite=Lax is the third layer.
export const csrfGuard = Object.assign(
  (req, _res, next) => {
    if (req.get('x-requested-with') !== 'SupportDesk')
      return next(forbidden('Missing CSRF header'));
    const origin = req.get('origin');
    if (origin && !env.corsOrigins.includes(origin)) return next(forbidden('Origin not allowed'));
    next();
  },
  { meta: { csrf: true } },
);

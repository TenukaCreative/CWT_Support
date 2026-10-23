// Pure access-scope logic. No database, no Express, so it is trivially unit-testable.
//
// A "scope" answers one question for the rest of the app: which projects may this request touch?
//   projectIds === null  -> every project (admin viewing "All projects")
//   projectIds === [...] -> exactly those projects (possibly empty = nothing reachable)
export const ALL_PROJECTS = 'ALL';

export function buildScope({
  role,
  userId,
  organizationId = null,
  activeProjectId = null,
  accessibleProjectIds = [],
}) {
  let projectIds;

  if (role === 'ADMIN') {
    if (!activeProjectId)
      projectIds = []; // must pick a project (or "All") before touching tenant data
    else if (activeProjectId === ALL_PROJECTS) projectIds = null;
    else projectIds = [activeProjectId];
  } else if (!activeProjectId) {
    projectIds = [];
  } else if (activeProjectId === ALL_PROJECTS) {
    // Support may widen to "all my assigned projects". Customers are always single-project.
    projectIds = role === 'SUPPORT' ? [...accessibleProjectIds] : [];
  } else {
    // Active project must be one the user is a verified member of; a stale/forged claim yields nothing.
    projectIds = accessibleProjectIds.includes(activeProjectId) ? [activeProjectId] : [];
  }

  return Object.freeze({
    role,
    userId,
    organizationId,
    activeProjectId: activeProjectId ?? null,
    projectIds,
    isStaff: role !== 'CUSTOMER',
  });
}

export const canAccessProject = (scope, projectId) =>
  scope.projectIds === null || scope.projectIds.includes(projectId);

// Prisma `where` fragment restricting a model that has a direct projectId column.
export const projectFilter = (scope) =>
  scope.projectIds === null ? {} : { projectId: { in: scope.projectIds } };

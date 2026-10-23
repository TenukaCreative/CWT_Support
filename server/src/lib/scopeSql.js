import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { notFound } from './errors.js';
import { canAccessProject } from './scope.js';

// Reports use raw SQL aggregates (date bucketing, percentiles, FILTER counts), which the scoped
// Prisma client cannot express. That makes THIS file the isolation boundary for reports: every
// report query must include projectCondition(...) built from the caller's scope. The report
// tests assert that nobody can see numbers of projects outside their scope.

// Project ids a report may cover: the caller's scope, optionally narrowed by a ?projectId filter.
// A filter outside the scope is a 404, like everywhere else (no probing).
export async function reportProjectIds(scope, projectId) {
  if (projectId) {
    // Under "All projects" every id is in scope, so also make sure it exists (404 either way).
    const ok =
      canAccessProject(scope, projectId) &&
      (scope.projectIds !== null || (await prisma.project.count({ where: { id: projectId } })) > 0);
    if (!ok) throw notFound('Project not found');
    return [projectId];
  }
  return scope.projectIds; // null = every project (admin viewing "All projects")
}

// `column` is always a literal from our own code (never user input).
export function projectCondition(ids, column) {
  if (ids === null) return Prisma.empty;
  if (ids.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND ${Prisma.raw(column)} IN (${Prisma.join(ids)})`;
}

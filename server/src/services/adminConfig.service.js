import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { DEFAULT_SLA } from '../lib/sla.js';
import { audit } from './audit.service.js';

// ───────────── categories ─────────────
// Never hard-deleted: tickets reference them. Deactivating hides a category from new tickets
// while old tickets keep their label.
export async function listCategories() {
  const categories = await prisma.category.findMany({
    include: {
      project: { select: { id: true, key: true } },
      _count: { select: { tickets: true } },
    },
    orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
  });
  return { categories };
}

async function assertUniqueName(projectId, name, exceptId) {
  const clash = await prisma.category.findFirst({
    where: {
      projectId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (clash)
    throw conflict('A category with this name already exists here', [
      { path: 'name', message: 'Already exists' },
    ]);
}

export async function createCategory(actor, { projectId, name }) {
  if (projectId && !(await prisma.project.findUnique({ where: { id: projectId } })))
    throw badRequest('Unknown project');
  await assertUniqueName(projectId ?? null, name);
  const category = await prisma.category.create({ data: { projectId: projectId ?? null, name } });
  await audit(actor.id, 'category.create', 'Category', category.id, {
    name,
    projectId: projectId ?? null,
  });
  return { category };
}

export async function updateCategory(actor, id, data) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw notFound('Category not found');
  if (data.name) await assertUniqueName(existing.projectId, data.name, id);
  const category = await prisma.category.update({ where: { id }, data });
  await audit(actor.id, 'category.update', 'Category', id, { changes: data });
  return { category };
}

// ───────────── SLA policies ─────────────
// One row per (project | global, priority). Changing a policy affects tickets created afterwards
// and tickets whose priority is changed afterwards; existing due dates are not rewritten.
export async function listSlaPolicies() {
  const policies = await prisma.slaPolicy.findMany({
    include: { project: { select: { id: true, key: true } } },
    orderBy: [{ projectId: 'asc' }, { priority: 'asc' }],
  });
  return { policies, defaults: DEFAULT_SLA };
}

export async function upsertSlaPolicy(
  actor,
  { projectId, priority, firstResponseHours, resolutionHours },
) {
  if (resolutionHours < firstResponseHours) {
    throw badRequest('Resolution time cannot be shorter than first-response time', [
      { path: 'resolutionHours', message: 'Must be at least the first-response time' },
    ]);
  }
  if (projectId && !(await prisma.project.findUnique({ where: { id: projectId } })))
    throw badRequest('Unknown project');
  const pid = projectId ?? null;

  // Postgres treats NULLs as distinct in unique indexes, so global rows are matched manually.
  const policy = await prisma.$transaction(async (tx) => {
    const existing = await tx.slaPolicy.findFirst({ where: { projectId: pid, priority } });
    const row = existing
      ? await tx.slaPolicy.update({
          where: { id: existing.id },
          data: { firstResponseHours, resolutionHours },
        })
      : await tx.slaPolicy.create({
          data: { projectId: pid, priority, firstResponseHours, resolutionHours },
        });
    await audit(
      actor.id,
      'sla.upsert',
      'SlaPolicy',
      row.id,
      { projectId: pid, priority, firstResponseHours, resolutionHours },
      tx,
    );
    return row;
  });
  return { policy };
}

// Only project overrides can be removed (the project falls back to the global policy).
export async function deleteSlaOverride(actor, id) {
  const row = await prisma.slaPolicy.findUnique({ where: { id } });
  if (!row) throw notFound('Policy not found');
  if (!row.projectId) throw conflict('The global policy cannot be deleted; edit it instead');
  await prisma.slaPolicy.delete({ where: { id } });
  await audit(actor.id, 'sla.delete', 'SlaPolicy', id, {
    projectId: row.projectId,
    priority: row.priority,
  });
}

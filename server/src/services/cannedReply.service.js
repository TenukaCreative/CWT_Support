import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { canAccessProject } from '../lib/scope.js';

// Visibility is enforced by the scoped client (global + in-scope project + own personal ones);
// this layer decides who may create/edit which kind.
const include = { project: { select: { id: true, key: true } } };

export const listCannedReplies = async (db) => ({
  replies: await db.cannedReply.findMany({
    orderBy: [{ scope: 'asc' }, { title: 'asc' }],
    include,
  }),
});

export async function createCannedReply(
  { db, scope, user },
  { title, body, scope: kind, projectId },
) {
  const data = { title, body, scope: kind, projectId: null, ownerId: null };
  if (kind === 'GLOBAL') {
    if (user.role !== 'ADMIN') throw forbidden('Only administrators can create global replies');
  } else if (kind === 'PROJECT') {
    if (!projectId)
      throw badRequest('projectId is required for project replies', [
        { path: 'projectId', message: 'Required' },
      ]);
    if (!canAccessProject(scope, projectId)) throw notFound('Project not found');
    data.projectId = projectId;
  } else {
    data.ownerId = user.id;
  }
  return { reply: await db.cannedReply.create({ data, include }) };
}

async function loadEditable({ db, user }, id) {
  const reply = await db.cannedReply.findUnique({ where: { id } });
  if (!reply) throw notFound('Reply not found');
  const ok =
    reply.scope === 'PERSONAL'
      ? reply.ownerId === user.id
      : reply.scope === 'GLOBAL'
        ? user.role === 'ADMIN'
        : true;
  if (!ok) throw forbidden('You cannot change this reply');
  return reply;
}

export async function updateCannedReply(ctx, id, data) {
  await loadEditable(ctx, id);
  return { reply: await ctx.db.cannedReply.update({ where: { id }, data, include }) };
}

export async function deleteCannedReply(ctx, id) {
  await loadEditable(ctx, id);
  await ctx.db.cannedReply.delete({ where: { id } });
}

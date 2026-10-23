import { prisma } from './prisma.js';
import { AppError, notFound } from './errors.js';
import { canAccessProject, projectFilter } from './scope.js';

// THE central isolation mechanism.
//
// scopedDb(scope) returns a Prisma client whose queries on tenant models automatically get the
// caller's project constraint ANDed in. Handlers/services use `req.db` for tenant data and
// cannot "forget" a filter. An out-of-scope id behaves exactly like a missing one (null / P2025),
// which the API reports as 404 so ids cannot be probed.
//
// Limits (also in CLAUDE.md): query hooks do not see NESTED relation reads/writes. For customers
// we therefore reject nested includes of messages/attachments/events (internal notes!), and
// nested writes must not be used on tenant models.

const NOT_INTERNAL = { type: { not: 'INTERNAL_NOTE' } };
const isCustomer = (s) => s.role === 'CUSTOMER';

const viaTicket = (s) => ({ ticket: projectFilter(s) });

// Global (projectId = null) KB content is visible to everyone; project content only in scope.
const withGlobal = (s) =>
  s.projectIds === null ? {} : { OR: [{ projectId: null }, { projectId: { in: s.projectIds } }] };

const RULES = {
  ticket: { where: projectFilter, projectColumn: true },
  ticketMessage: {
    where: (s) => ({ ...viaTicket(s), ...(isCustomer(s) ? NOT_INTERNAL : {}) }),
    parentTicket: true,
  },
  attachment: {
    // Customers must not reach files attached to internal notes.
    where: (s) => ({
      ...viaTicket(s),
      ...(isCustomer(s) ? { OR: [{ messageId: null }, { message: NOT_INTERNAL }] } : {}),
    }),
    parentTicket: true,
  },
  ticketEvent: { where: viaTicket, parentTicket: true },
  feedback: { where: viaTicket, parentTicket: true },
  faqArticle: {
    where: (s) => ({ ...withGlobal(s), ...(isCustomer(s) ? { status: 'PUBLISHED' } : {}) }),
    projectColumn: true,
  },
  faqCategory: { where: withGlobal, projectColumn: true },
  kbSearchLog: { where: projectFilter, projectColumn: true },
  category: {
    where: (s) => ({ ...withGlobal(s), ...(isCustomer(s) ? { isActive: true } : {}) }),
    projectColumn: true,
  },
  cannedReply: {
    // Staff only. Global replies for everyone on staff, project replies within scope, personal
    // replies only for their owner.
    where: (s) =>
      isCustomer(s)
        ? { id: { in: [] } }
        : {
            OR: [
              { scope: 'GLOBAL' },
              {
                scope: 'PROJECT',
                ...(s.projectIds === null ? {} : { projectId: { in: s.projectIds } }),
              },
              { scope: 'PERSONAL', ownerId: s.userId },
            ],
          },
  },
  notification: { where: (s) => ({ userId: s.userId }) },
};

const READ_OPS = [
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
];
const WRITE_OPS = ['update', 'updateMany', 'delete', 'deleteMany'];

const andWhere = (where = {}, extra) => {
  if (!extra || Object.keys(extra).length === 0) return where;
  const prev = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];
  return { ...where, AND: [...prev, extra] };
};

// Relations a customer must only reach through their scoped model (to keep internal notes out).
const CUSTOMER_DENIED_RELATIONS = new Set(['messages', 'attachments', 'events']);
function assertNoDeniedRelations(node) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (CUSTOMER_DENIED_RELATIONS.has(key) && value) {
      throw new Error(
        `Unscoped nested relation "${key}" is not allowed for customers; query its scoped model instead`,
      );
    }
    if (value && typeof value === 'object') assertNoDeniedRelations(value);
  }
}

async function assertTicketsInScope(scope, rows) {
  const ids = [...new Set(rows.map((r) => r.ticketId))];
  if (ids.some((id) => !id))
    throw new Error('Scoped create requires ticketId (unchecked create input)');
  const found = await prisma.ticket.count({ where: { id: { in: ids }, ...projectFilter(scope) } });
  if (found !== ids.length) throw notFound('Ticket not found');
}

function assertProjectWritable(scope, rows) {
  for (const r of rows) {
    if (r.projectId === undefined)
      throw new Error('Scoped create requires projectId (unchecked create input)');
    // projectId null = global content: only an admin working across ALL projects may write it.
    const ok =
      r.projectId === null ? scope.projectIds === null : canAccessProject(scope, r.projectId);
    if (!ok) throw notFound('Project not found');
  }
}

export function scopedDb(scope) {
  const query = {};

  for (const [model, rule] of Object.entries(RULES)) {
    const ops = {};
    const extra = rule.where(scope);

    for (const op of [...READ_OPS, ...WRITE_OPS]) {
      ops[op] = ({ args, query: run }) => {
        if (isCustomer(scope)) {
          assertNoDeniedRelations(args.include);
          assertNoDeniedRelations(args.select);
        }
        return run({ ...args, where: andWhere(args.where, extra) });
      };
    }

    if (rule.projectColumn || rule.parentTicket) {
      ops.create = async ({ args, query: run }) => {
        if (rule.parentTicket) await assertTicketsInScope(scope, [args.data]);
        else assertProjectWritable(scope, [args.data]);
        return run(args);
      };
      ops.createMany = async ({ args, query: run }) => {
        const rows = Array.isArray(args.data) ? args.data : [args.data];
        if (rule.parentTicket) await assertTicketsInScope(scope, rows);
        else assertProjectWritable(scope, rows);
        return run(args);
      };
    }

    // upsert cannot be scoped safely (create branch + where branch), so it is simply not offered.
    ops.upsert = () => {
      throw new AppError(500, 'INTERNAL_ERROR', `upsert is not allowed on scoped model ${model}`);
    };

    query[model] = ops;
  }

  return prisma.$extends({ name: 'tenantScope', query });
}

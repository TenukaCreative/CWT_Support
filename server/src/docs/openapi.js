import { zodToJsonSchema } from 'zod-to-json-schema';
import { collectRoutes } from './routeTable.js';

// OpenAPI 3.0 description GENERATED from the live routes (docs/routeTable.js) and their Zod
// schemas, so it cannot drift from the code: a new route appears automatically, and a test fails
// when the committed docs/openapi.json is stale (regenerate with `npm run docs:openapi`).
//
// What is described: every path/method, who may call it (bearer token, roles, selected project,
// CSRF header), and the request parameters/body (from the same Zod schemas that validate them).
// Success bodies are left as "2XX" on purpose; their shape is documented in docs/API.md.

const ACTIONS = new Set([
  'approve',
  'reject',
  'deactivate',
  'reactivate',
  'unlock',
  'assign',
  'merge',
  'status',
  'feedback',
  'vote',
  'read',
  'read-all',
  'click',
  'logout',
  'login',
  'refresh',
  'register',
  'verify-email',
  'resend-verification',
  'forgot-password',
  'reset-password',
  'accept-invite',
  'select-project',
  'bulk-assign',
  'preview',
  'password',
]);
const singular = (w) =>
  w.endsWith('ies')
    ? `${w.slice(0, -3)}y`
    : w.endsWith('ses')
      ? w.slice(0, -2)
      : w.endsWith('s')
        ? w.slice(0, -1)
        : w;
const words = (s) => s.replace(/-/g, ' ');

function summarize(method, path) {
  const segs = path.replace('/api/v1/', '').split('/').filter(Boolean);
  const literal = segs.filter((s) => !s.startsWith('{'));
  const endsWithParam = segs.at(-1)?.startsWith('{');
  const last = literal.at(-1) ?? 'api';
  if (method === 'POST' && ACTIONS.has(last)) {
    const parent = literal.at(-2);
    return `${words(last)[0].toUpperCase()}${words(last).slice(1)}${parent && !ACTIONS.has(parent) ? ` ${singular(words(parent))}` : ''}`;
  }
  const noun = words(method === 'GET' && !endsWithParam ? last : singular(last));
  const verb =
    {
      GET: endsWithParam ? 'Get' : 'List',
      POST: 'Create',
      PUT: 'Replace',
      PATCH: 'Update',
      DELETE: 'Delete',
    }[method] ?? method;
  return `${verb} ${noun}`;
}

const toSchema = (zodSchema) => {
  const s = zodToJsonSchema(zodSchema, {
    target: 'openApi3',
    $refStrategy: 'none',
    effectStrategy: 'input',
    pipeStrategy: 'input',
  });
  delete s.$schema;
  return s;
};

const ref = (name) => ({ $ref: `#/components/responses/${name}` });

export function buildOpenApi() {
  const paths = {};

  for (const r of collectRoutes().sort((a, b) =>
    (a.path + a.method).localeCompare(b.path + b.method),
  )) {
    const pathParams = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const parameters = pathParams.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    if (r.schemas.query) {
      const q = toSchema(r.schemas.query);
      for (const [name, schema] of Object.entries(q.properties ?? {})) {
        parameters.push({ name, in: 'query', required: (q.required ?? []).includes(name), schema });
      }
    }
    if (r.csrf) {
      parameters.push({
        name: 'X-Requested-With',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['SupportDesk'] },
        description: 'CSRF protection for cookie-authenticated calls.',
      });
    }

    const notes = [];
    if (r.roles) notes.push(`Roles: ${r.roles.join(', ')}.`);
    if (r.project) notes.push('Needs a selected project (409 PROJECT_REQUIRED otherwise).');
    if (r.csrf)
      notes.push(
        'Authenticated by the httpOnly refresh cookie (path /api/v1/auth), not a bearer token.',
      );

    const op = {
      summary: summarize(r.method, r.path),
      tags: [r.path.replace('/api/v1/', '').split('/')[0] || 'api'],
      operationId: `${r.method.toLowerCase()}_${r.path
        .replace('/api/v1/', '')
        .replace(/[{}]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '_')}`,
      ...(notes.length ? { description: notes.join(' ') } : {}),
      ...(parameters.length ? { parameters } : {}),
      security: r.auth ? [{ bearerAuth: [] }] : r.csrf ? [{ refreshCookie: [] }] : [],
      responses: {
        '2XX': { description: 'Success' },
        ...(r.schemas.body || r.schemas.query || r.schemas.params || r.multipart
          ? { 400: ref('BadRequest') }
          : {}),
        ...(r.auth || r.csrf ? { 401: ref('Unauthorized') } : {}),
        ...(r.roles || r.csrf ? { 403: ref('Forbidden') } : {}),
        ...(pathParams.length ? { 404: ref('NotFound') } : {}),
        ...(r.project ? { 409: ref('Conflict') } : {}),
        ...(r.multipart || r.path.endsWith('export.csv') ? { 413: ref('TooLarge') } : {}),
        429: ref('RateLimited'),
      },
    };

    if (r.schemas.body) {
      const body = toSchema(r.schemas.body);
      op.requestBody = r.multipart
        ? {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  ...body,
                  properties: {
                    ...body.properties,
                    files: {
                      type: 'array',
                      maxItems: 5,
                      items: { type: 'string', format: 'binary' },
                    },
                  },
                },
              },
            },
          }
        : { required: true, content: { 'application/json': { schema: body } } };
    }

    (paths[r.path] ??= {})[r.method.toLowerCase()] = op;
  }

  const errorResponse = (description) => ({
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  });
  return {
    openapi: '3.0.3',
    info: {
      title: 'SupportDesk API',
      version: '1.0.0',
      description:
        'REST API of the SupportDesk customer support app. All paths are under /api/v1. Errors always use { error: { code, message, details } }. ' +
        'List endpoints accept page, limit (max 100), sort and dir and return { items, page, limit, total, totalPages }. ' +
        "Tenant isolation: records outside the caller's project scope are reported as 404, never 403.",
    },
    servers: [{ url: '/' }],
    tags: [...new Set(Object.values(paths).flatMap((p) => Object.values(p).flatMap((o) => o.tags)))]
      .sort()
      .map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Short-lived access token from /auth/login, /auth/refresh or /auth/select-project (carries the active project).',
        },
        refreshCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'sd_refresh',
          description: 'httpOnly rotating refresh token.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'details'],
              properties: {
                code: { type: 'string', example: 'NOT_FOUND' },
                message: { type: 'string' },
                details: { nullable: true },
              },
            },
          },
        },
      },
      responses: {
        BadRequest: errorResponse('Validation failed (VALIDATION_ERROR) or malformed request'),
        Unauthorized: errorResponse('Missing, invalid or expired credentials'),
        Forbidden: errorResponse('Authenticated but not allowed (role / CSRF)'),
        NotFound: errorResponse('Not found, or outside your scope'),
        Conflict: errorResponse(
          'State conflict, for example PROJECT_REQUIRED or INVALID_TRANSITION',
        ),
        TooLarge: errorResponse('Upload or export too large'),
        RateLimited: errorResponse('Too many requests'),
      },
    },
  };
}

import { mounts } from '../routes/mounts.js';

// Walks the real Express routers and returns every endpoint with what it enforces, read from the
// metadata the middleware factories attach (auth, roles, project, csrf, multipart, schemas).
// Router-level middleware (router.use(authenticate, ...)) applies to the routes registered after it.
export function collectRoutes() {
  const out = [];
  for (const [prefix, router] of mounts) {
    let inherited = [];
    for (const layer of router.stack) {
      if (!layer.route) {
        inherited = [...inherited, layer.handle]; // router.use(...)
        continue;
      }
      const handlers = [...inherited, ...layer.route.stack.map((l) => l.handle)];
      const meta = handlers.map((h) => h.meta).filter(Boolean);
      const schemas = handlers.map((h) => h.schemas).filter(Boolean);
      const expressPath =
        `${prefix === '/' ? '' : prefix}${layer.route.path === '/' ? '' : layer.route.path}` || '/';
      for (const method of Object.keys(layer.route.methods)) {
        out.push({
          method: method.toUpperCase(),
          expressPath: `/api/v1${expressPath}`,
          path: `/api/v1${expressPath}`.replace(/:([A-Za-z]+)/g, '{$1}'),
          auth: meta.some((m) => m.auth),
          roles: meta.find((m) => m.roles)?.roles ?? null,
          project: meta.some((m) => m.project),
          csrf: meta.some((m) => m.csrf),
          multipart: meta.some((m) => m.multipart),
          schemas: Object.assign({}, ...schemas),
        });
      }
    }
  }
  return out;
}

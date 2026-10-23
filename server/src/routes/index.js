import { Router } from 'express';
import { env } from '../config/env.js';
import { buildOpenApi } from '../docs/openapi.js';
import { mounts } from './mounts.js';

// Every feature router is registered here under /api/v1 (see mounts.js for the list).
const router = Router();

for (const [prefix, feature] of mounts) router.use(prefix, feature);

// The machine-readable API description is generated from the routes above. Always available in
// development and tests; in production only when EXPOSE_API_DOCS=true.
if (!env.isProd || env.EXPOSE_API_DOCS) {
  let spec;
  router.get('/openapi.json', (_req, res) => res.json((spec ??= buildOpenApi())));
}

export default router;

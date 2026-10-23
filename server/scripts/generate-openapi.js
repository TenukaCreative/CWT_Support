// Usage: npm run docs:openapi   (writes docs/openapi.json from the live routes)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApi } from '../src/docs/openapi.js';

const out = path.resolve(fileURLToPath(new URL('../../docs/openapi.json', import.meta.url)));
fs.writeFileSync(out, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
console.log(`Wrote ${out}`);

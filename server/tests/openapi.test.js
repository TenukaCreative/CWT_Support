import fs from 'node:fs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { collectRoutes } from '../src/docs/routeTable.js';
import { buildOpenApi } from '../src/docs/openapi.js';

const app = createApp();
const spec = buildOpenApi();
const committed = new URL('../../docs/openapi.json', import.meta.url);

describe('OpenAPI description', () => {
  it('is served by the API (outside production)', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(70);
  });

  it('documents every route the app registers (and nothing else)', () => {
    const documented = Object.entries(spec.paths)
      .flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`))
      .sort();
    const registered = collectRoutes()
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(documented).toEqual(registered);
  });

  it('operation ids are unique and every $ref resolves', () => {
    const ids = Object.values(spec.paths).flatMap((ops) =>
      Object.values(ops).map((o) => o.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) =>
      m[1].split('/'),
    );
    for (const parts of refs) {
      const target = parts.reduce((node, k) => node?.[k], spec);
      expect(target).toBeDefined();
    }
  });

  it('describes security accurately', () => {
    const op = (m, p) => spec.paths[`/api/v1${p}`][m];
    expect(op('post', '/auth/login').security).toEqual([]); // public
    expect(op('get', '/tickets').security).toEqual([{ bearerAuth: [] }]);
    expect(op('post', '/auth/refresh').security).toEqual([{ refreshCookie: [] }]);
    expect(op('post', '/auth/refresh').parameters.map((p) => p.name)).toContain('X-Requested-With');
    expect(op('get', '/admin/users').description).toContain('Roles: ADMIN');
    expect(op('post', '/tickets').description).toContain('Roles: CUSTOMER');
    expect(op('get', '/reports/overview').description).toContain('selected project');
  });

  it('derives request shapes from the real validation schemas', () => {
    const create =
      spec.paths['/api/v1/tickets'].post.requestBody.content['multipart/form-data'].schema;
    expect(create.properties.subject).toMatchObject({
      type: 'string',
      minLength: 5,
      maxLength: 200,
    });
    expect(create.properties.files).toMatchObject({ type: 'array', maxItems: 5 });
    const list = spec.paths['/api/v1/tickets'].get.parameters;
    expect(list.map((p) => p.name)).toEqual(
      expect.arrayContaining(['page', 'limit', 'sort', 'dir', 'q', 'status', 'priority']),
    );
    expect(list.find((p) => p.name === 'limit').schema).toMatchObject({ maximum: 100 });
    const login =
      spec.paths['/api/v1/auth/login'].post.requestBody.content['application/json'].schema;
    expect(login.required).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('the committed docs/openapi.json is up to date (run `npm run docs:openapi` if this fails)', () => {
    expect(JSON.parse(fs.readFileSync(committed, 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(spec)),
    );
  });
});

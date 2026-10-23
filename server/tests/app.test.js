import request from 'supertest';
import { z } from 'zod';
import express from 'express';
import { createApp } from '../src/app.js';
import { validate } from '../src/middleware/validate.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { notFound } from '../src/lib/errors.js';
import { asyncHandler } from '../src/utils/asyncHandler.js';

describe('app skeleton', () => {
  const app = createApp();

  it('answers the liveness probe', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns the standard error shape for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String), details: null },
    });
  });

  it('only allows listed CORS origins', async () => {
    const ok = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(app).get('/api/v1/health').set('Origin', 'http://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('validation + error handling', () => {
  const app = express();
  app.use(express.json());
  app.post(
    '/echo',
    validate({ body: z.object({ email: z.string().email(), age: z.coerce.number().int() }) }),
    (req, res) => res.json(req.body),
  );
  app.get(
    '/missing',
    asyncHandler(async () => {
      throw notFound('Ticket not found');
    }),
  );
  app.get(
    '/boom',
    asyncHandler(async () => {
      throw new Error('secret internals');
    }),
  );
  app.use(errorHandler);

  it('rejects invalid bodies with field-level details', async () => {
    const res = await request(app).post('/echo').send({ email: 'nope', age: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path).sort()).toEqual(['age', 'email']);
  });

  it('passes parsed values to the handler', async () => {
    const res = await request(app).post('/echo').send({ email: 'a@b.co', age: '42' });
    expect(res.body).toEqual({ email: 'a@b.co', age: 42 });
  });

  it('maps AppError to its status and code', async () => {
    const res = await request(app).get('/missing');
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Ticket not found',
      details: null,
    });
  });

  it('hides internals of unexpected errors', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret internals');
  });
});

import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const handler = (_req, res) =>
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down', details: null },
  });

const base = { standardHeaders: true, legacyHeaders: false, handler, skip: () => env.isTest };

export const globalLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 300 });

// Stricter limiter for login/register/reset endpoints (wired up in Phase 2).
export const authLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 20 });

// Per-user limiter for content creation (tickets, replies, uploads). Runs after authenticate.
export const writeLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60_000,
  limit: 60,
  keyGenerator: (req) => req.auth?.user?.id ?? 'anonymous',
});

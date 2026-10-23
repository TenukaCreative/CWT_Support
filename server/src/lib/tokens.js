import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Opaque random tokens (refresh, email verification, reset, invite). Only the SHA-256 hash is
// persisted, so a database leak does not hand out usable tokens. High-entropy input means a fast
// hash is fine here (unlike passwords).
export const generateToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

// Access token claims: sub = user id, pid = active project id | 'ALL' | null.
// Role is deliberately NOT trusted from the token; authenticate() reloads it from the database.
const ISSUER = 'supportdesk';
const AUDIENCE = 'supportdesk-api';

export const signAccessToken = ({ userId, activeProjectId }) =>
  jwt.sign({ pid: activeProjectId ?? null }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL,
    algorithm: 'HS256',
    issuer: ISSUER,
    audience: AUDIENCE,
  });

export const verifyAccessToken = (token) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  });

import pino from 'pino';
import { env } from '../config/env.js';

// Tokens travel in URLs for invitations (/auth/invitations/<token>) and may appear as ?token=.
// They are credentials, so request logs must never contain them.
export const redactUrl = (url = '') =>
  url
    .replace(/(\/invitations\/)[^/?#]+/g, '$1[redacted]')
    .replace(/([?&](?:token|code)=)[^&#]*/g, '$1[redacted]');

export const logger = pino({
  level: env.LOG_LEVEL ?? (env.isTest ? 'silent' : env.isProd ? 'info' : 'debug'),
  // Belt and braces: request logs below already omit headers entirely.
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  transport:
    env.isProd || env.isTest ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});

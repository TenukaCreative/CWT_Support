import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default('SupportDesk <no-reply@supportdesk.local>'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  FEATURE_DOMAIN_AUTOJOIN: bool,
  // Largest CSV export in one request; bigger result sets must be narrowed with filters.
  EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(20000),
  // Number of reverse proxies in front of the API (0 = none). Needed for correct client IPs in
  // rate limiting; NEVER set it higher than the real number of proxies (X-Forwarded-For is spoofable).
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  // Directory of the built client (client/dist). When set, the API serves the web app too (same origin).
  CLIENT_DIST: z.string().default(''),
  // Serve /api/v1/openapi.json in production too (always on outside production).
  EXPOSE_API_DOCS: bool,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  // Background jobs (SLA check, auto-close). Disable on all but one instance if you scale out.
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

// Extra rules that only make sense for a real deployment: a misconfigured production server
// should refuse to start rather than run insecurely.
const isLocalUrl = (u) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(u);
const productionRules = schema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  const bad = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (/change-me|example|secret-test/i.test(env[k]))
      bad(k, 'must be a real random secret, not a placeholder');
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET)
    bad('JWT_REFRESH_SECRET', 'must differ from JWT_ACCESS_SECRET');
  if (!env.CLIENT_URL.startsWith('https://') && !isLocalUrl(env.CLIENT_URL))
    bad('CLIENT_URL', 'must be an https:// URL in production (the refresh cookie is Secure)');
  for (const o of env.CORS_ORIGINS.split(',')
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (o === '*' || (!o.startsWith('https://') && !isLocalUrl(o)))
      bad('CORS_ORIGINS', `"${o}" must be an explicit https:// origin`);
  }
});

const parsed = productionRules.safeParse(process.env);

if (!parsed.success) {
  // Fail fast at boot: a misconfigured server should never start half-working.
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${problems.join('\n')}`);
  process.exit(1);
}

const data = parsed.data;

export const env = {
  ...data,
  isProd: data.NODE_ENV === 'production',
  isTest: data.NODE_ENV === 'test',
  corsOrigins: data.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};

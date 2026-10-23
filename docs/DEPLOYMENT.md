# Deployment guide

SupportDesk ships as **one container**: the Express API also serves the built React app, so the browser talks to a single origin (no CORS in practice, and the refresh cookie is same-site). You need PostgreSQL 16 and, for real email, an SMTP account.

## 1. Environment variables

Read once at boot by `server/src/config/env.js` (Zod). The process **refuses to start** on invalid values. In production it additionally refuses placeholder secrets, identical access/refresh secrets, a non-`https` `CLIENT_URL`, and wildcard or non-`https` `CORS_ORIGINS`.

| Variable                   | Required   | Default                                                  | Notes                                                                                                                                             |
| -------------------------- | ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | yes        | `development`                                            | Set `production`. Turns on the production config rules, `Secure` cookies and hides API docs unless `EXPOSE_API_DOCS=true`.                        |
| `PORT`                     | no         | `4000`                                                   |                                                                                                                                                   |
| `DATABASE_URL`             | yes        |                                                          | PostgreSQL connection string.                                                                                                                     |
| `CLIENT_URL`               | yes (prod) | `http://localhost:5173`                                  | Public URL of the app. Must be `https://` in production. Used in email links and for the Origin check on cookie endpoints.                        |
| `CORS_ORIGINS`             | yes (prod) | `http://localhost:5173`                                  | Comma-separated allow-list. Explicit `https://` origins only. With the single-container setup this is just your public URL.                       |
| `JWT_ACCESS_SECRET`        | yes        |                                                          | 32+ random characters (`openssl rand -hex 48`).                                                                                                   |
| `JWT_REFRESH_SECRET`       | yes        |                                                          | 32+ random characters, **different** from the access secret.                                                                                      |
| `ACCESS_TOKEN_TTL`         | no         | `15m`                                                    | Lifetime of the access JWT.                                                                                                                       |
| `REFRESH_TOKEN_TTL_DAYS`   | no         | `14`                                                     | Lifetime of the rotating refresh cookie.                                                                                                          |
| `SMTP_HOST/PORT/USER/PASS` | no         | empty / `587`                                            | Without `SMTP_HOST` no email is delivered (it is only logged), so verification, reset and invitation emails will not arrive. Set it for real use. |
| `MAIL_FROM`                | no         | `SupportDesk <no-reply@...>`                             | Sender address; use one your SMTP provider allows.                                                                                                |
| `UPLOAD_DIR`               | no         | `./uploads` (`/data/uploads` in the image)               | Where attachments are stored. Mount a persistent volume.                                                                                          |
| `MAX_UPLOAD_MB`            | no         | `10`                                                     |                                                                                                                                                   |
| `EXPORT_MAX_ROWS`          | no         | `20000`                                                  | Largest CSV export; bigger requests get a clear 413 and must be narrowed.                                                                         |
| `TRUST_PROXY`              | no         | `0`                                                      | Number of reverse proxies in front of the app. See section 5.                                                                                     |
| `CLIENT_DIST`              | no         | empty (`/app/client/dist` in the image)                  | Directory of the built client. When set, the API serves the web app and falls back to `index.html` for client routes.                             |
| `EXPOSE_API_DOCS`          | no         | `false`                                                  | `true` serves `/api/v1/openapi.json` in production (always available outside production).                                                         |
| `LOG_LEVEL`                | no         | `info` in production (`debug` in dev, `silent` in tests) | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`.                                                                                     |
| `JOBS_ENABLED`             | no         | `true`                                                   | SLA check and auto-close run inside the API process. See section 7.                                                                               |
| `FEATURE_DOMAIN_AUTOJOIN`  | no         | `false`                                                  | Reserved switch for organisation-domain auto-join of customers.                                                                                   |
| `RUN_MIGRATIONS`           | no         | `true`                                                   | Read by `docker/entrypoint.sh` only: set `false` on replicas that must not migrate.                                                               |

A ready-to-copy template is in `server/.env.production.example`. **Never commit real values**; supply them through your platform's secret store or an env file that is not in git.

## 2. Build and run with Docker (recommended)

```bash
docker build -t supportdesk .
```

The multi-stage `Dockerfile` builds the client, installs production dependencies only, generates the Prisma client and runs as the unprivileged `node` user under `tini` (clean SIGTERM handling). It has a health check on `/api/v1/health`.

A complete example stack (app + PostgreSQL + volumes) is in `docker-compose.prod.example.yml`:

```bash
cp server/.env.production.example app.env      # fill in the secrets, CLIENT_URL, CORS_ORIGINS, SMTP_*
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
docker compose -f docker-compose.prod.example.yml up -d --build
```

The container applies pending migrations on start (`prisma migrate deploy`) and then launches the server.

### Without Docker

```bash
npm ci
npm run build                      # builds client/dist
export NODE_ENV=production CLIENT_DIST="$PWD/client/dist" DATABASE_URL=... JWT_ACCESS_SECRET=... # etc.
npm start                          # db:deploy (migrations) then the API
```

Use a process manager (systemd, pm2) and send `SIGTERM` to stop: the server drains connections and closes the database before exiting.

## 3. First admin account

The seed script creates **development** users with a known password and must **never** be run against production. To bootstrap production, create the first admin directly in the database (or run a one-off script of your own), then log in and use _Admin > Users_ to invite everyone else. Hash the password with the same algorithm as `server/src/lib/password.js`.

## 4. Database migrations

- `npx prisma migrate deploy` applies committed migrations and is safe to repeat. Never use `migrate dev` or `migrate reset` in production.
- With several replicas, set `RUN_MIGRATIONS=false` on them and run the migration once as a separate step:
  `docker run --rm --env-file app.env supportdesk npx prisma migrate deploy --schema server/prisma/schema.prisma`
- Back up PostgreSQL before every release (`pg_dump`), and test restores.

## 5. Reverse proxy, TLS and cookies

- Terminate TLS at a reverse proxy or load balancer (nginx, Caddy, Traefik, a cloud LB) and forward to port 4000. The compose example publishes the port on `127.0.0.1` only.
- Set **`TRUST_PROXY`** to the exact number of proxies between the internet and the app (usually `1`). With `0` while behind a proxy, every user shares the proxy's IP in the rate limiter; set too high, clients can spoof their IP with `X-Forwarded-For` and dodge rate limits and lockouts.
- The refresh cookie `sd_refresh` is `httpOnly`, `Secure` (in production), `SameSite=Lax`, path `/api/v1/auth`. It therefore needs HTTPS. The cookie endpoints are additionally protected against CSRF by a required `X-Requested-With: SupportDesk` header plus an Origin allow-list check. The single-container setup keeps app and API on one site; if you ever split them onto different sites you must revisit the cookie settings and CSRF design deliberately.
- Forward the `Host` and `X-Forwarded-*` headers; allow request bodies slightly above `MAX_UPLOAD_MB` (multipart) on the proxy.
- Helmet sets the security headers; the HSTS header is only honoured over HTTPS.

## 6. Storage and backups

- **Database:** regular `pg_dump` or managed-database snapshots.
- **Uploads:** files live on disk in `UPLOAD_DIR` under random names and are only served through the authenticated, scoped API. Back the volume up together with the database (a ticket row without its file, or the reverse, is a broken attachment). For several app servers, switch the storage engine in `middleware/upload.js` and `attachment.service.js` to S3-compatible object storage; nothing else depends on the disk path.

## 7. Background jobs and scaling

The SLA check (every minute) and the auto-close job (hourly) run inside the API process. They use conditional updates, so a second instance cannot double-notify, but it wastes work. When you scale out, run the API replicas with `JOBS_ENABLED=false` and one dedicated instance with `JOBS_ENABLED=true`.

Everything else is stateless (access tokens are verified per request, refresh tokens live in PostgreSQL), so API replicas can sit behind a load balancer without sticky sessions. Rate-limit counters are in memory per process, so with several replicas the effective limits are per replica; use a shared store (for example Redis) if you need exact global limits.

## 8. Logging and monitoring

- Structured JSON logs (Pino) on stdout, one line per request with an `X-Request-Id` that is also returned to the client. Authorization headers, cookies and tokens in URLs (verify, reset, invite) are redacted.
- `GET /api/v1/health` is a liveness check; `GET /api/v1/health/ready` returns **503** when the database is unreachable (use it as the readiness probe).
- Fatal errors and unhandled rejections are logged and the process exits so the orchestrator restarts it.

## 9. Release checklist

1. Secrets set and different; `CLIENT_URL`/`CORS_ORIGINS` are your real `https://` origin.
2. Database backed up; migrations reviewed.
3. `npm run lint`, `npm test`, `npm run build` green on the commit being released.
4. Deploy; confirm `/api/v1/health/ready` is 200 and an admin can log in.
5. Check the logs for the "Invalid environment configuration" message if the container exits at once.
6. Have a rollback: previous image tag plus the pre-release database backup (migrations are forward-only).

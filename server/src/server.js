import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { createApp } from './app.js';
import { startJobs } from './jobs/index.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}/api/v1`);
  if (env.isProd && !env.SMTP_HOST)
    logger.warn('SMTP_HOST is not set: emails are only written to the log, nobody receives them');
  if (env.isProd && env.TRUST_PROXY === 0)
    logger.warn(
      'TRUST_PROXY=0: behind a reverse proxy every client will share the proxy IP for rate limiting',
    );
});

// Slow-client protection (slowloris) and sane connection reuse. Uploads (10 MB) fit well inside 2 minutes.
server.headersTimeout = 20_000;
server.requestTimeout = 120_000;
server.keepAliveTimeout = 65_000; // above the usual 60s load-balancer idle timeout

// Jobs live in the server process (not createApp), so tests never start timers.
const stopJobs = env.JOBS_ENABLED ? startJobs() : () => {};

let closing = false;
const shutdown = (signal, code = 0) => {
  if (closing) return;
  closing = true;
  logger.info(`${signal} received, shutting down`);
  stopJobs();
  // Finish in-flight requests, but never hang a deploy: force-exit after 10 seconds.
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(code);
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// A bug that escapes every handler leaves the process in an unknown state: log it and restart cleanly
// (the container/process manager brings it back) instead of limping on.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});

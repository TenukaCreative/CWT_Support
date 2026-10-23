import cron from 'node-cron';
import { logger } from '../lib/logger.js';
import { runSlaCheck } from './sla.job.js';
import { runAutoClose } from './autoClose.job.js';

// A job that throws must never crash the API or stop its own schedule.
const safe = (name, fn) => async () => {
  try {
    await fn();
  } catch (err) {
    logger.error({ err, job: name }, 'Background job failed');
  }
};

export function startJobs() {
  const tasks = [
    cron.schedule('* * * * *', safe('sla-check', runSlaCheck)), // every minute
    cron.schedule('7 * * * *', safe('auto-close', runAutoClose)), // hourly
  ];
  // Catch up immediately after a restart instead of waiting for the next tick.
  safe('sla-check', runSlaCheck)();
  safe('auto-close', runAutoClose)();
  logger.info('Background jobs started (SLA check every minute, auto-close hourly)');
  return () => tasks.forEach((t) => t.stop());
}

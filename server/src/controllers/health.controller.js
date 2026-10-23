import { checkDatabase } from '../services/health.service.js';

export const liveness = (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
};

// Readiness = "can this instance serve traffic?". When the database is unreachable answer 503 (not
// 500) so load balancers and orchestrators take the instance out of rotation instead of retrying it.
export const readiness = async (_req, res) => {
  try {
    await checkDatabase();
    res.json({ status: 'ok', database: 'up' });
  } catch {
    res.status(503).json({ status: 'unavailable', database: 'down' });
  }
};

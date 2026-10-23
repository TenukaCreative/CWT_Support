const base = 'postgresql://supportdesk:supportdesk@localhost:5432';
export const ADMIN_DB_URL = `${base}/supportdesk?schema=public`;
// Separate database so tests (which truncate everything) never touch dev data.
export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? `${base}/supportdesk_test?schema=public`;

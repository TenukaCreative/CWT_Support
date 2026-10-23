import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { ADMIN_DB_URL, TEST_DB_URL } from './db-urls.js';

// Creates the test database if needed and brings it to the current migration state.
export default async function globalSetup() {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_DB_URL } } });
  const exists =
    await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = 'supportdesk_test'`;
  if (exists.length === 0) await admin.$executeRawUnsafe('CREATE DATABASE supportdesk_test');
  await admin.$disconnect();

  execSync('npx prisma migrate deploy', {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  });
}

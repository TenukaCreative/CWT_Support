import os from 'node:os';
import { TEST_DB_URL } from './db-urls.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DB_URL;
process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret-1234';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-test-refresh-secret-1234';
process.env.UPLOAD_DIR = `${os.tmpdir()}/supportdesk-test-uploads`;
process.env.EXPORT_MAX_ROWS = '8';

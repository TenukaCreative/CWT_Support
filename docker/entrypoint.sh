#!/bin/sh
# Applies pending database migrations, then starts the API (which also serves the web app).
# Running several replicas? Set RUN_MIGRATIONS=false on them and run migrations once as a separate
# step/job:  docker run --rm --env-file ... supportdesk npx prisma migrate deploy --schema server/prisma/schema.prisma
set -e
if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
  echo "Applying database migrations..."
  npx prisma migrate deploy --schema server/prisma/schema.prisma
fi
exec node server/src/server.js

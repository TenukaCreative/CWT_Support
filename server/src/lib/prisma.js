import { PrismaClient } from '@prisma/client';

// One client per process. In Phase 2 this is wrapped by the scoping layer
// (see CLAUDE.md "Tenant isolation") so handlers never use it directly for tenant data.
export const prisma = new PrismaClient();

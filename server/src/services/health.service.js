import { prisma } from '../lib/prisma.js';

export const checkDatabase = async () => {
  await prisma.$queryRaw`SELECT 1`;
  return true;
};

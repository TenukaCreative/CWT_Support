// One-off: create the FIRST admin on an empty database (see docs/DEPLOYMENT.md, section 3).
// Usage (from the server folder):
//   node --env-file=.env scripts/create-admin.js you@company.com "Your Name"
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';

const [email, name] = process.argv.slice(2);
if (!email || !name) {
  console.error('Usage: node scripts/create-admin.js <email> "<full name>"');
  process.exit(1);
}

// Random, so no password is ever typed on the command line (shell history keeps those).
// Loops until it contains a letter and a digit, the same rules the app enforces.
function makePassword() {
  let p;
  do p = randomBytes(12).toString('base64url');
  while (!/\d/.test(p) || !/[A-Za-z]/.test(p));
  return p;
}

const normalised = email.trim().toLowerCase();
const existing = await prisma.user.findUnique({ where: { email: normalised } });
if (existing) {
  console.error(`A user with ${normalised} already exists. Nothing changed.`);
  await prisma.$disconnect();
  process.exit(1);
}

const password = makePassword();
await prisma.user.create({
  data: {
    email: normalised,
    name: name.trim(),
    passwordHash: await hashPassword(password),
    role: 'ADMIN',
    status: 'ACTIVE',
    emailVerifiedAt: new Date(),
  },
});
await prisma.$disconnect();

console.log(`Admin created: ${normalised}`);
console.log(`Temporary password (shown once): ${password}`);
console.log('Log in and change it on the Profile page.');

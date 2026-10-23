import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

const COST = env.isProd ? 12 : env.isTest ? 4 : 10;

export const hashPassword = (plain) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// Compared against when the email is unknown, so "no such user" costs the same time as
// "wrong password" and response timing does not reveal which accounts exist.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);

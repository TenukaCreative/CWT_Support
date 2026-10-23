import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// Tests read sent mail from here (to extract verification/reset links).
export const outbox = [];

// `transport` is injectable so the delivery paths can be tested without a real SMTP server.
// Delivery failure must never fail the request that triggered it (e.g. registration).
export function createMailer({
  transport = null,
  from = env.MAIL_FROM,
  capture = env.isTest,
} = {}) {
  return async function sendMail({ to, subject, text }) {
    try {
      if (capture) {
        outbox.push({ to, subject, text });
      } else if (!transport) {
        logger.info(`[dev mail] to=${to} subject="${subject}"\n${text}`);
      } else {
        await transport.sendMail({ from, to, subject, text });
      }
    } catch (err) {
      logger.error({ err, to, subject }, 'Failed to send email');
    }
  };
}

const smtp = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export const sendMail = createMailer({ transport: smtp });

import { env } from '../config/env.js';
import { sendMail } from '../lib/mailer.js';

const link = (path, token) => `${env.CLIENT_URL}${path}?token=${encodeURIComponent(token)}`;

export const sendVerificationEmail = (user, token) =>
  sendMail({
    to: user.email,
    subject: 'Verify your SupportDesk email',
    text: `Hi ${user.name},\n\nConfirm your email address:\n${link('/verify-email', token)}\n\nThis link expires in 24 hours.`,
  });

export const sendPasswordResetEmail = (user, token) =>
  sendMail({
    to: user.email,
    subject: 'Reset your SupportDesk password',
    text: `Hi ${user.name},\n\nReset your password:\n${link('/reset-password', token)}\n\nThis link expires in 1 hour. If you did not ask for this, ignore this email.`,
  });

export const sendInvitationEmail = ({ email, inviterName, token }) =>
  sendMail({
    to: email,
    subject: 'You have been invited to SupportDesk',
    text: `${inviterName} invited you to SupportDesk.\n\nAccept the invitation:\n${link('/accept-invite', token)}\n\nThis link expires in 7 days.`,
  });

export const sendAccountCreatedEmail = (user, token) =>
  sendMail({
    to: user.email,
    subject: 'Your SupportDesk account is ready',
    text: `Hi ${user.name},\n\nAn administrator created a SupportDesk account for you. Set your password here:\n${link('/reset-password', token)}\n\nThis link expires in 72 hours.`,
  });

export const sendApprovalEmail = (user) =>
  sendMail({
    to: user.email,
    subject: 'Your SupportDesk account was approved',
    text: `Hi ${user.name},\n\nYour account has been approved. You can log in now:\n${env.CLIENT_URL}/login`,
  });

export const sendRejectionEmail = (user, reason) =>
  sendMail({
    to: user.email,
    subject: 'Your SupportDesk registration',
    text: `Hi ${user.name},\n\nWe could not approve your registration.${reason ? `\n\nReason: ${reason}` : ''}\n\nIf you think this is a mistake, contact your account manager.`,
  });

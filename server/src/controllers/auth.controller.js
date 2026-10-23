import { env } from '../config/env.js';
import * as auth from '../services/auth.service.js';
import * as invitations from '../services/invitation.service.js';

const COOKIE = 'sd_refresh';
// Scoped to the auth routes so the browser never attaches it to ordinary API calls.
const cookieOptions = {
  httpOnly: true,
  secure: env.isProd,
  sameSite: 'lax',
  path: '/api/v1/auth',
};

const setRefreshCookie = (res, token) =>
  res.cookie(COOKIE, token, {
    ...cookieOptions,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600_000,
  });

// The refresh token travels only in the cookie, never in the JSON body.
const sendSession = (res, { refreshToken, ...session }, status = 200) => {
  setRefreshCookie(res, refreshToken);
  res.status(status).json(session);
};

const GENERIC = { message: 'If that is possible, an email has been sent.' };

export const listOrganizations = async (_req, res) =>
  res.json({ organizations: await auth.listOrganizations() });

export const register = async (req, res) => {
  await auth.register(req.body);
  res.status(201).json({
    message:
      'Check your email to verify your address. An administrator will then approve your account.',
  });
};

export const verifyEmail = async (req, res) => res.json(await auth.verifyEmail(req.body.token));

export const resendVerification = async (req, res) => {
  await auth.resendVerification(req.body.email);
  res.json(GENERIC);
};

export const login = async (req, res) => sendSession(res, await auth.login(req.body));

export const refresh = async (req, res) => {
  try {
    sendSession(res, await auth.refresh(req.cookies[COOKIE]));
  } catch (err) {
    res.clearCookie(COOKIE, cookieOptions);
    throw err;
  }
};

export const logout = async (req, res) => {
  await auth.logout(req.cookies[COOKIE]);
  res.clearCookie(COOKIE, cookieOptions);
  res.status(204).end();
};

export const me = async (req, res) =>
  res.json(await auth.getSession(req.auth.user, req.auth.scope));

export const selectProject = async (req, res) =>
  res.json(await auth.selectProject(req.auth.user, req.body.projectId));

export const forgotPassword = async (req, res) => {
  await auth.forgotPassword(req.body.email);
  res.json(GENERIC);
};

export const resetPassword = async (req, res) => {
  await auth.resetPassword(req.body);
  res.json({ message: 'Password updated. You can now log in.' });
};

export const previewInvitation = async (req, res) =>
  res.json(await invitations.previewInvitation(req.params.token));

export const acceptInvitation = async (req, res) => {
  await invitations.acceptInvitation(req.body);
  res.status(201).json({ message: 'Account created. You can now log in.' });
};

export { COOKIE };

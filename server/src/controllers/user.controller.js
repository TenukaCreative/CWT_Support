import * as users from '../services/user.service.js';
import { COOKIE } from './auth.controller.js';

export const updateMe = async (req, res) =>
  res.json({ user: await users.updateProfile(req.auth.user.id, req.body) });

export const changePassword = async (req, res) => {
  await users.changePassword(req.auth.user, req.body, req.cookies[COOKIE]);
  res.json({ message: 'Password changed' });
};

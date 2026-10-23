import * as invitations from '../services/invitation.service.js';

export const create = async (req, res) =>
  res.status(201).json({ invitation: await invitations.createInvitation(req.auth.user, req.body) });

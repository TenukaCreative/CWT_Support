import * as orgs from '../services/organization.service.js';
import * as projects from '../services/project.service.js';
import * as users from '../services/adminUser.service.js';
import * as auditView from '../services/auditView.service.js';
import * as config from '../services/adminConfig.service.js';
import * as invitations from '../services/invitation.service.js';

const actor = (req) => req.auth.user;

// organizations
export const listOrgs = async (req, res) => res.json(await orgs.listOrganizations(req.query));
export const getOrg = async (req, res) =>
  res.json({ organization: await orgs.getOrganization(req.params.id) });
export const createOrg = async (req, res) =>
  res.status(201).json({ organization: await orgs.createOrganization(actor(req), req.body) });
export const updateOrg = async (req, res) =>
  res.json({ organization: await orgs.updateOrganization(actor(req), req.params.id, req.body) });

// projects
export const listProjects = async (req, res) => res.json(await projects.listProjects(req.query));
export const getProject = async (req, res) =>
  res.json({ project: await projects.getProject(req.params.id) });
export const createProject = async (req, res) =>
  res.status(201).json({ project: await projects.createProject(actor(req), req.body) });
export const updateProject = async (req, res) =>
  res.json({ project: await projects.updateProject(actor(req), req.params.id, req.body) });
export const addMembers = async (req, res) =>
  res.json({ project: await projects.addMembers(actor(req), req.params.id, req.body.userIds) });
export const removeMember = async (req, res) => {
  await projects.removeMember(actor(req), req.params.id, req.params.userId);
  res.status(204).end();
};

// users
export const listUsers = async (req, res) => res.json(await users.listUsers(req.query));
export const getUser = async (req, res) => res.json({ user: await users.getUser(req.params.id) });
export const createUser = async (req, res) =>
  res.status(201).json({ user: await users.createUser(actor(req), req.body) });
export const updateUser = async (req, res) =>
  res.json({ user: await users.updateUser(actor(req), req.params.id, req.body) });
export const deactivateUser = async (req, res) =>
  res.json({ user: await users.deactivateUser(actor(req), req.params.id) });
export const reactivateUser = async (req, res) =>
  res.json({ user: await users.reactivateUser(actor(req), req.params.id) });
export const unlockUser = async (req, res) =>
  res.json({ user: await users.unlockUser(actor(req), req.params.id) });
export const setUserProjects = async (req, res) => {
  await projects.setUserProjects(actor(req), req.params.id, req.body.projectIds);
  res.json({ user: await users.getUser(req.params.id) });
};
export const approveUser = async (req, res) =>
  res.json({ user: await users.approveUser(actor(req), req.params.id, req.body.projectIds) });
export const rejectUser = async (req, res) =>
  res.json({ user: await users.rejectUser(actor(req), req.params.id, req.body.reason) });

// invitations
export const listInvitations = async (req, res) =>
  res.json(await invitations.listInvitations(req.query));
export const revokeInvitation = async (req, res) => {
  await invitations.revokeInvitation(actor(req), req.params.id);
  res.status(204).end();
};

// categories & SLA
export const listCategories = async (_req, res) => res.json(await config.listCategories());
export const createCategory = async (req, res) =>
  res.status(201).json(await config.createCategory(actor(req), req.body));
export const updateCategory = async (req, res) =>
  res.json(await config.updateCategory(actor(req), req.params.id, req.body));
export const listSla = async (_req, res) => res.json(await config.listSlaPolicies());
export const upsertSla = async (req, res) =>
  res.json(await config.upsertSlaPolicy(actor(req), req.body));
export const deleteSla = async (req, res) => {
  await config.deleteSlaOverride(actor(req), req.params.id);
  res.status(204).end();
};

// audit trail (read-only)
export const listAudit = async (req, res) => res.json(await auditView.listAuditLogs(req.query));
export const auditFilters = async (_req, res) => res.json(await auditView.auditFilters());

import * as reports from '../services/report.service.js';

const ctx = (req) => ({ scope: req.auth.scope, userId: req.auth.user.id });

export const overview = async (req, res) => res.json(await reports.overview(ctx(req), req.query));
export const csat = async (req, res) => res.json(await reports.csat(ctx(req), req.query));
export const deflection = async (req, res) =>
  res.json(await reports.deflection(ctx(req), req.query, req.db));
export const me = async (req, res) => res.json(await reports.myStats(ctx(req), req.query));

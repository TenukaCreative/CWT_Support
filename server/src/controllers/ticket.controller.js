import fs from 'node:fs';
import { once } from 'node:events';
import * as tickets from '../services/ticket.service.js';
import * as exporter from '../services/ticketExport.service.js';
import { BOM } from '../lib/csv.js';
import * as canned from '../services/cannedReply.service.js';
import { getAttachment, getAttachmentFile } from '../services/attachment.service.js';

const ctx = (req) => ({ db: req.db, scope: req.auth.scope, user: req.auth.user });

export const list = async (req, res) => res.json(await tickets.listTickets(ctx(req), req.query));
export const create = async (req, res) =>
  res.status(201).json({ ticket: await tickets.createTicket(ctx(req), req.body, req.files) });
export const get = async (req, res) => res.json(await tickets.getTicket(ctx(req), req.params.id));
export const addMessage = async (req, res) =>
  res
    .status(201)
    .json({ message: await tickets.addMessage(ctx(req), req.params.id, req.body, req.files) });
export const changeStatus = async (req, res) =>
  res.json({ ticket: await tickets.changeStatus(ctx(req), req.params.id, req.body) });
export const update = async (req, res) =>
  res.json({ ticket: await tickets.updateDetails(ctx(req), req.params.id, req.body) });
export const assign = async (req, res) =>
  res.json({ ticket: await tickets.assign(ctx(req), req.params.id, req.body) });
export const feedback = async (req, res) =>
  res
    .status(201)
    .json({ feedback: await tickets.submitFeedback(ctx(req), req.params.id, req.body) });
export const bulkAssign = async (req, res) =>
  res.json(await tickets.bulkAssign(ctx(req), req.body));
export const merge = async (req, res) =>
  res.json({ ticket: await tickets.mergeTicket(ctx(req), req.params.id, req.body) });
export const assignees = async (req, res) =>
  res.json(await tickets.listAssignees(ctx(req), req.query.projectId));
export const categories = async (req, res) => res.json(await tickets.listCategories(req.db));

export const attachment = async (req, res) =>
  res.json({ attachment: await getAttachment(req.db, req.params.id) });
export const downloadAttachment = async (req, res) => {
  const f = await getAttachmentFile(req.db, req.params.id);
  // Always a download, never rendered inline: an uploaded file must not execute in our origin.
  res.attachment(f.filename);
  res.type(f.mimeType);
  res.set({
    'Content-Length': f.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  fs.createReadStream(f.filePath)
    .on('error', () => res.destroy())
    .pipe(res);
};

export const listCanned = async (req, res) => res.json(await canned.listCannedReplies(req.db));
export const createCanned = async (req, res) =>
  res.status(201).json(await canned.createCannedReply(ctx(req), req.body));
export const updateCanned = async (req, res) =>
  res.json(await canned.updateCannedReply(ctx(req), req.params.id, req.body));
export const deleteCanned = async (req, res) => {
  await canned.deleteCannedReply(ctx(req), req.params.id);
  res.status(204).end();
};

// Streams the CSV in batches. The size check runs first (413 as normal JSON), then the file is
// written chunk by chunk with backpressure; every export leaves an audit entry.
export const exportCsv = async (req, res) => {
  const { where, count } = await exporter.prepareExport(ctx(req), req.query);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="tickets-${new Date().toISOString().slice(0, 10)}.csv"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.write(BOM + exporter.header());
  for await (const chunk of exporter.exportChunks(ctx(req), where)) {
    if (res.destroyed) return; // the client went away
    if (!res.write(chunk)) await once(res, 'drain');
  }
  res.end();
  const { createdFrom, createdTo, ...filters } = req.query;
  await exporter.auditExport(req.auth.user, { ...filters, createdFrom, createdTo }, count);
};

import fs from 'node:fs';
import path from 'node:path';
import { notFound } from '../lib/errors.js';
import { UPLOAD_ROOT } from '../middleware/upload.js';

const meta = {
  id: true,
  ticketId: true,
  messageId: true,
  filename: true,
  mimeType: true,
  size: true,
  createdAt: true,
};

// Metadata only. storedName (the on-disk name) is never exposed.
export async function getAttachment(db, id) {
  const a = await db.attachment.findUnique({ where: { id }, select: meta });
  if (!a) throw notFound('Attachment not found');
  return a;
}

// Resolve a downloadable file. Scope (project + internal-note rules) is enforced by the scoped
// lookup; the path is built from our own random stored name inside the upload root only.
export async function getAttachmentFile(db, id) {
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a) throw notFound('Attachment not found');
  const filePath = path.join(UPLOAD_ROOT, path.basename(a.storedName));
  if (!fs.existsSync(filePath)) throw notFound('The file is no longer available');
  return { filePath, filename: a.filename, mimeType: a.mimeType, size: a.size };
}

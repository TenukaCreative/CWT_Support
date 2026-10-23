import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

// Attachment hardening, in layers:
//  1. allow-list of extension AND declared MIME type (images, PDF, txt, docx, xlsx, zip)
//  2. size / count caps (multer limits)
//  3. random on-disk names (never derived from user input) in a directory that is NOT served statically
//  4. magic-byte sniffing, so a renamed .exe cannot pass as .png
//  5. files from a request that ends in an error are deleted
export const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ALLOWED = {
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.txt': ['text/plain'],
  '.docx': [DOCX],
  '.xlsx': [XLSX],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
};
export const MAX_FILES = 5;

const bad = (message) => new AppError(400, 'UNSUPPORTED_FILE_TYPE', message);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true, mode: 0o750 }); // owner + group only
    cb(null, UPLOAD_ROOT);
  },
  filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
});

const parser = multer({
  storage,
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: MAX_FILES,
    fields: 20,
    fieldSize: 64 * 1024,
  },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimes = ALLOWED[ext];
    if (!mimes || !mimes.includes(file.mimetype)) {
      return cb(
        bad(
          `"${file.originalname}" is not an allowed file type (images, PDF, txt, docx, xlsx, zip)`,
        ),
      );
    }
    cb(null, true);
  },
}).array('files', MAX_FILES);

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

// Does the content match what the extension claims?
export function sniffMatches(ext, head) {
  switch (ext) {
    case '.png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47]);
    case '.jpg':
    case '.jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case '.gif':
      return startsWith(head, [0x47, 0x49, 0x46, 0x38]);
    case '.webp':
      return (
        startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case '.pdf':
      return startsWith(head, [0x25, 0x50, 0x44, 0x46]);
    case '.docx':
    case '.xlsx':
    case '.zip':
      return (
        startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])
      );
    case '.txt':
      return !head.includes(0); // text has no NUL bytes
    default:
      return false;
  }
}

export const removeFiles = (files = []) =>
  Promise.all(files.map((f) => fs.promises.unlink(f.path).catch(() => {})));

function readHead(file) {
  const fd = fs.openSync(file.path, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

// Express middleware: parse multipart (field "files"), verify content, clean up on failure.
export const uploadFiles = Object.assign(
  (req, res, next) => {
    parser(req, res, async (err) => {
      if (err) {
        await removeFiles(req.files);
        return next(err);
      }
      req.files ??= [];
      // A later validation/handler failure must not leave orphaned files on disk.
      res.on('finish', () => {
        if (res.statusCode >= 400) removeFiles(req.files);
      });
      for (const f of req.files) {
        const ext = path.extname(f.originalname).toLowerCase();
        if (!sniffMatches(ext, readHead(f))) {
          await removeFiles(req.files);
          return next(bad(`"${f.originalname}" does not look like a real ${ext} file`));
        }
      }
      next();
    });
  },
  { meta: { multipart: true } },
);

// Display name only (never used for paths): strip directories and control characters.
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f"\\/]/g; // eslint-disable-line no-control-regex
export const safeFilename = (name) =>
  path.basename(name).replace(UNSAFE_NAME_CHARS, '_').slice(0, 200) || 'file';

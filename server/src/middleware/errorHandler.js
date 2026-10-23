import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

const body = (code, message, details) => ({ error: { code, message, details: details ?? null } });

export const notFoundHandler = (req, res) => {
  res.status(404).json(body('NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

export const errorHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json(body(err.code, err.message, err.details));
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return res.status(400).json(body('VALIDATION_ERROR', 'Request validation failed', details));
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json(body('CONFLICT', 'A record with these values already exists'));
    }
    if (err.code === 'P2025') {
      return res.status(404).json(body('NOT_FOUND', 'Resource not found'));
    }
  }

  // multer (file uploads)
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE')
      return res
        .status(413)
        .json(body('FILE_TOO_LARGE', `Files must be ${env.MAX_UPLOAD_MB} MB or smaller`));
    return res
      .status(400)
      .json(
        body(
          'UPLOAD_ERROR',
          err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Too many files (maximum 5)'
            : 'Upload failed',
        ),
      );
  }

  // CORS rejection / unsupported content from body parsers
  if (err.status === 400 && err.type) {
    return res.status(400).json(body('BAD_REQUEST', 'Malformed request'));
  }

  // Malformed JSON from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json(body('BAD_REQUEST', 'Malformed JSON body'));
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json(body('PAYLOAD_TOO_LARGE', 'Request body too large'));
  }

  // Unknown: log everything, tell the client nothing.
  (req.log ?? logger).error({ err }, 'Unhandled error');
  return res.status(500).json(body('INTERNAL_ERROR', 'Something went wrong'));
};

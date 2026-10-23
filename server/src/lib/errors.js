// Every expected failure is thrown as an AppError; the central error handler turns it into
// { error: { code, message, details } }. Anything else is treated as a 500.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Bad request', details) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do that') =>
  new AppError(403, 'FORBIDDEN', message);
// Out-of-scope resources are reported as 404, never 403, so IDs cannot be probed.
export const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message = 'Conflict', details) =>
  new AppError(409, 'CONFLICT', message, details);

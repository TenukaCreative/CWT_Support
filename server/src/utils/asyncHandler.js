// Express 4 does not forward rejected promises to next(); this wrapper does.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

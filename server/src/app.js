import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger, redactUrl } from './lib/logger.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';
import { mountClient } from './spa.js';

// Every request gets an id (shared with the logs and returned as X-Request-Id) so a user's
// "it failed at 10:42" can be matched to one log line. A caller-supplied id is accepted only if it
// is short and boring, so it cannot be used for log injection.
const requestId = (req, res, next) => {
  const supplied = req.get('x-request-id');
  req.id = supplied && /^[\w-]{8,64}$/.test(supplied) ? supplied : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
};

// `clientDist` lets tests (and embedders) choose the built web app to serve; default comes from CLIENT_DIST.
export const createApp = ({ clientDist = env.CLIENT_DIST } = {}) => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY); // see env.js: only as many hops as really exist

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      // Headers (cookies, tokens) and bodies are never logged; URLs are scrubbed of tokens.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: redactUrl(req.url) }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      credentials: true, // needed for the httpOnly refresh cookie
      maxAge: 600, // cache preflights for 10 minutes
      origin(origin, cb) {
        // Non-browser clients (curl, server-to-server) send no Origin header.
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // API responses carry personal data: never let browsers or proxies cache them.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/v1', globalLimiter, routes);

  if (clientDist) mountClient(app, clientDist);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

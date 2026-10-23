import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

// Optional: serve the built web app from the API (set CLIENT_DIST=../client/dist). One origin means
// no CORS and a same-site refresh cookie by construction. The security headers (helmet, incl. CSP)
// already apply to these responses.
export function mountClient(app, dist) {
  const root = path.resolve(dist);
  const indexFile = path.join(root, 'index.html');
  if (!fs.existsSync(indexFile))
    throw new Error(`CLIENT_DIST "${root}" has no index.html. Run "npm run build" first.`);

  // Vite fingerprints everything in /assets, so it can be cached for a year. A MISSING asset must
  // be a real 404, never index.html (that would hand the browser HTML where it expects JS/CSS).
  app.use(
    '/assets',
    express.static(path.join(root, 'assets'), {
      immutable: true,
      maxAge: '1y',
      index: false,
      redirect: false,
    }),
  );
  app.use('/assets', (_req, res) => res.status(404).type('text/plain').send('Not found'));

  app.use(express.static(root, { index: false, maxAge: 0, redirect: false }));

  // Client-side routes (/app/tickets/123, /login ...) all get the app shell. Never for /api, and
  // never for something that looks like a file (favicon.ico, robots.txt): those are 404s.
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    if (path.extname(req.path)) return next();
    res.set('Cache-Control', 'no-cache').sendFile(indexFile);
  });
}

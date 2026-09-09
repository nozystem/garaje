import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleRequest } from '../server/lib/router.ts';

function originalPath(req: IncomingMessage): string {
  const header = req.headers['x-vercel-original-path'];
  const value = Array.isArray(header) ? header[0] : header;
  return value || req.url || '/';
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  req.url = originalPath(req);

  try {
    await handleRequest(req, res);
  } catch (error) {
    console.error('Unhandled error:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

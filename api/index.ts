import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleRequest } from '../server/lib/router.ts';

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
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

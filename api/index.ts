import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleRequest } from '../server/lib/router.ts';

/**
 * Punto de entrada de la API en Vercel.
 *
 * Vercel enruta aquí todo `/api/*` por convención de carpeta, sin necesidad de
 * reescrituras. El manejador es el mismo que usa `server.ts` en local, así que
 * no hay dos caminos de código que puedan divergir.
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    await handleRequest(req, res);
  } catch (error) {
    console.error('Error no controlado:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ error: 'Error interno del servidor' }));
  }
}

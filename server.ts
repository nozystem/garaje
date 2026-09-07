import { createServer } from 'node:http';

import { handleRequest } from './server/lib/router.ts';

/**
 * Servidor de la API del garaje.
 *
 * Vercel detecta este fichero por su nombre y lo convierte en una función, de
 * modo que el mismo código corre en local con `npm run api` y en producción
 * sin cambios. El puerto solo se usa en local.
 */
const server = createServer((req, res) => {
  handleRequest(req, res).catch((error: unknown) => {
    console.error('Error no controlado:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ error: 'Error interno del servidor' }));
  });
});

server.listen(Number(process.env['PORT'] ?? 3210));

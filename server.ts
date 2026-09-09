import { createServer } from 'node:http';

import { handleRequest } from './server/lib/router.ts';

/**
 * Servidor de la API del garaje.
 *
 * Vercel detecta este fichero por su nombre y lo convierte en una función, de
 * modo que el mismo código corre en local con `npm run api` y en producción
 * sin cambios. El puerto solo se usa en local.
 */
/**
 * Comprobación de configuración al arrancar.
 *
 * Faltar una variable de entorno es un error de despliegue, no de una
 * petición concreta: es mejor decirlo al arrancar que devolver un 500 opaco
 * en el primer registro.
 */
const missing = ['POSTGRES_URL', 'AUTH_SECRET'].filter(
  (name) => !process.env[name]
);

if (missing.length) {
  console.error(
    `\nFaltan variables de entorno: ${missing.join(', ')}\n\n` +
      'La aplicación necesita una base de datos para las cuentas. En local:\n\n' +
      '  POSTGRES_URL="postgres://usuario@localhost:5432/garaje" \\\n' +
      '  AUTH_SECRET="$(openssl rand -base64 48)" \\\n' +
      '  npm run api\n\n' +
      'O guárdalas en un archivo .env.local y usa: npm run api:env\n'
  );
  process.exit(1);
}

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

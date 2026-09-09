import { createServer } from 'node:http';

import { handleRequest } from './server/lib/router.ts';

const missing = ['POSTGRES_URL', 'AUTH_SECRET'].filter(
  (name) => !process.env[name]
);

if (missing.length) {
  console.error(
    `\nMissing environment variables: ${missing.join(', ')}\n\n` +
      'The application needs a database for accounts. Locally:\n\n' +
      '  POSTGRES_URL="postgres://user@localhost:5432/garage" \\\n' +
      '  AUTH_SECRET="$(openssl rand -base64 48)" \\\n' +
      '  npm run api\n\n' +
      'Or store them in a .env.local file and run: npm run api:env\n'
  );
  process.exit(1);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error: unknown) => {
    console.error('Unhandled error:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ error: 'Internal server error' }));
  });
});

server.listen(Number(process.env['PORT'] ?? 3210));

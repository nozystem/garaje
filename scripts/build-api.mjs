import { build } from 'esbuild';

await build({
  entryPoints: ['server/entry/vercel.ts'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['pg'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

console.log('api/index.js built');

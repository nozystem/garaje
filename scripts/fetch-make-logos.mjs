/**
 * Descarga el logo de cada marca del catálogo desde
 * filippofilip95/car-logos-dataset y los deja en src/assets/logos.
 *
 * Como el catálogo, se ejecuta a mano: los logos se sirven desde nuestro
 * propio dominio y el despliegue no depende de GitHub.
 *
 *   node scripts/fetch-make-logos.mjs
 *
 * Escribe también src/app/core/data/make-logos.ts con las marcas que tienen
 * logo, para que el cliente no pida imágenes que no existen.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE =
  'https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos';
const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'src', 'assets', 'logos');
const MANIFEST = join(ROOT, 'src', 'app', 'core', 'data', 'make-logos.ts');

/** El mismo slugify que server/lib/catalog.ts. */
function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Slugs del catálogo: los de open-vehicle-db más las marcas locales. De
 * momento la app es solo para coches, así que solo las marcas con coches.
 */
function catalogSlugs() {
  const external = JSON.parse(
    readFileSync(join(ROOT, 'server', 'data', 'open-vehicle-db.json'), 'utf8')
  );
  const local = readFileSync(join(ROOT, 'server', 'lib', 'catalog.ts'), 'utf8');
  const localNames = [...local.matchAll(/\{ name: '([^']+)', type: 'car'/g)].map((m) => m[1]);

  const externalSlugs = external.makes
    .filter((make) => make.models.some((model) => model.type === 'car'))
    .map((make) => make.slug);

  return new Set([...externalSlugs, ...localNames.map(slugify)]);
}

const dataset = await fetch(`${BASE}/data.json`).then((r) => r.json());
const available = new Set(dataset.map((logo) => logo.slug));

mkdirSync(OUT, { recursive: true });

const found = [];
const missing = [];

for (const slug of [...catalogSlugs()].sort()) {
  // El dataset separa las palabras con guiones; el catálogo, con guiones bajos.
  const remote = slug.replace(/_/g, '-');
  if (!available.has(remote)) {
    missing.push(slug);
    continue;
  }

  const response = await fetch(`${BASE}/thumb/${remote}.png`);
  if (!response.ok) {
    missing.push(slug);
    continue;
  }
  writeFileSync(join(OUT, `${slug}.png`), Buffer.from(await response.arrayBuffer()));
  found.push(slug);
}

writeFileSync(
  MANIFEST,
  `// Generado por scripts/fetch-make-logos.mjs. No editar a mano.\n` +
    `export const MAKE_LOGOS: ReadonlySet<string> = new Set([\n` +
    found.map((slug) => `  '${slug}',`).join('\n') +
    `\n]);\n`
);

console.log(`${found.length} logos descargados.`);
console.log(`Sin logo (${missing.length}): ${missing.join(', ')}`);

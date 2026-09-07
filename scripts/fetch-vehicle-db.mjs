/**
 * Descarga el catálogo de plowman/open-vehicle-db y lo deja listo para la API.
 *
 * Se ejecuta a mano, no en cada arranque: el catálogo cambia pocas veces al
 * año y no queremos que el despliegue dependa de que GitHub responda.
 *
 *   node scripts/fetch-vehicle-db.mjs
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE =
  'https://raw.githubusercontent.com/plowman/open-vehicle-db/master/data';
const OUT = join(import.meta.dirname, '..', 'server', 'data');

/** Parser de CSV con soporte para comillas: los años vienen como "1987,2001". */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const [header, ...body] = rows;
  return body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function get(file) {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

/** El tipo del dataset no coincide con el nuestro: mpv y truck son van. */
function toVehicleType(raw) {
  switch (raw) {
    case 'truck': return 'van';
    case 'mpv': return 'car';
    default: return 'car';
  }
}

const makes = await get('makes.csv');
const models = await get('models.csv');

const byMake = new Map();
for (const m of models) {
  if (!byMake.has(m.make_slug)) byMake.set(m.make_slug, []);
  byMake.get(m.make_slug).push({
    name: m.model_name,
    type: toVehicleType(m.vehicle_type),
    years: m.years,
  });
}

const catalog = makes
  .map((make) => ({
    slug: make.make_slug,
    name: make.make_name,
    firstYear: Number(make.first_year) || undefined,
    lastYear: Number(make.last_year) || undefined,
    models: (byMake.get(make.make_slug) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
  }))
  .filter((make) => make.models.length > 0)
  .sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(
  join(OUT, 'open-vehicle-db.json'),
  JSON.stringify({ source: BASE, fetchedAt: new Date().toISOString(), makes: catalog }, null, 0)
);

console.log(
  `Guardadas ${catalog.length} marcas y ` +
  `${catalog.reduce((n, m) => n + m.models.length, 0)} modelos.`
);

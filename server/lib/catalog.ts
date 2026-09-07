import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Catálogo de marcas y modelos.
 *
 * Combina dos fuentes:
 *
 *  - **open-vehicle-db** (github.com/plowman/open-vehicle-db): 70 marcas y
 *    1.678 modelos, actualizado en 2026. Cubre bien el mercado estadounidense.
 *  - **Catálogo propio para España**: el dataset anterior no incluye SEAT,
 *    Cupra, Dacia, Škoda, Citroën, Opel, Volkswagen ni MG, y de Renault solo
 *    trae los cinco modelos que se vendieron en EE.UU. en los ochenta. Tampoco
 *    tiene marcas de moto más allá de Honda, Suzuki y BMW.
 *
 * Al fusionarlas, cada marca indica su origen para que la interfaz pueda
 * mostrarlo. Los datos externos se descargan con `scripts/fetch-vehicle-db.mjs`
 * y se sirven desde el repositorio: así el despliegue no depende de que GitHub
 * responda.
 */

export type CatalogSource = 'open-vehicle-db' | 'local';

export interface CatalogModel {
  name: string;
  type: string;
  years?: string;
}

export interface CatalogMake {
  slug: string;
  name: string;
  models: CatalogModel[];
  sources: CatalogSource[];
}

interface ExternalFile {
  source: string;
  fetchedAt: string;
  makes: {
    slug: string;
    name: string;
    firstYear?: number;
    lastYear?: number;
    models: CatalogModel[];
  }[];
}

/**
 * Marcas y modelos habituales en España que faltan en el dataset externo o
 * están mal cubiertos. Los modelos son las series comunes del parque actual.
 */
const SPAIN: { name: string; type: string; models: string[] }[] = [
  { name: 'SEAT', type: 'car', models: ['Ibiza', 'León', 'Arona', 'Ateca', 'Tarraco', 'Toledo', 'Altea', 'Córdoba', 'Exeo', 'Mii'] },
  { name: 'Cupra', type: 'car', models: ['Formentor', 'León', 'Ateca', 'Born', 'Terramar', 'Tavascan'] },
  { name: 'Volkswagen', type: 'car', models: ['Golf', 'Polo', 'Passat', 'Tiguan', 'T-Roc', 'T-Cross', 'Touran', 'Arteon', 'ID.3', 'ID.4', 'Caddy', 'Transporter', 'Crafter'] },
  { name: 'Škoda', type: 'car', models: ['Octavia', 'Fabia', 'Karoq', 'Kodiaq', 'Superb', 'Scala', 'Kamiq', 'Enyaq'] },
  { name: 'Dacia', type: 'car', models: ['Sandero', 'Duster', 'Jogger', 'Logan', 'Spring', 'Bigster'] },
  { name: 'Citroën', type: 'car', models: ['C3', 'C3 Aircross', 'C4', 'C5 Aircross', 'C5 X', 'Berlingo', 'Jumpy', 'Jumper', 'Ami'] },
  { name: 'Opel', type: 'car', models: ['Corsa', 'Astra', 'Mokka', 'Crossland', 'Grandland', 'Combo', 'Vivaro', 'Movano'] },
  { name: 'MG', type: 'car', models: ['MG3', 'ZS', 'HS', 'MG4', 'MG5', 'Marvel R'] },
  { name: 'Renault', type: 'car', models: ['Clio', 'Mégane', 'Captur', 'Kadjar', 'Scénic', 'Austral', 'Arkana', 'Zoe', 'Twingo', 'Kangoo', 'Trafic', 'Master'] },
  { name: 'Peugeot', type: 'car', models: ['208', '2008', '308', '3008', '408', '5008', '508', 'Partner', 'Rifter', 'Expert', 'Boxer'] },
  { name: 'Iveco', type: 'van', models: ['Daily'] },

  // Motos: el dataset externo no cubre prácticamente ninguna.
  { name: 'Honda', type: 'motorcycle', models: ['CB125R', 'CB500F', 'CB650R', 'CBR600RR', 'CRF300L', 'Africa Twin', 'Forza 125', 'PCX 125', 'NC750X', 'Transalp'] },
  { name: 'Yamaha', type: 'motorcycle', models: ['MT-03', 'MT-07', 'MT-09', 'R1', 'R7', 'Tracer 7', 'Ténéré 700', 'XMAX 125', 'NMAX 125', 'TMAX'] },
  { name: 'Kawasaki', type: 'motorcycle', models: ['Z650', 'Z900', 'Ninja 400', 'Ninja 650', 'Versys 650', 'Vulcan S', 'Eliminator'] },
  { name: 'Suzuki', type: 'motorcycle', models: ['GSX-S750', 'GSX-R600', 'V-Strom 650', 'V-Strom 800', 'SV650', 'Burgman 125'] },
  { name: 'BMW', type: 'motorcycle', models: ['R 1250 GS', 'F 900 R', 'S 1000 RR', 'G 310 R', 'C 400 X', 'R nineT'] },
  { name: 'KTM', type: 'motorcycle', models: ['Duke 125', 'Duke 390', 'Duke 790', '890 Adventure', '1290 Super Duke', 'RC 390'] },
  { name: 'Ducati', type: 'motorcycle', models: ['Monster', 'Panigale V2', 'Panigale V4', 'Multistrada', 'Scrambler', 'DesertX'] },
  { name: 'Triumph', type: 'motorcycle', models: ['Street Triple', 'Speed Triple', 'Bonneville', 'Tiger 900', 'Trident 660'] },
  { name: 'Piaggio', type: 'motorcycle', models: ['Vespa Primavera', 'Vespa GTS', 'Liberty 125', 'Beverly 300', 'MP3'] },
  { name: 'Aprilia', type: 'motorcycle', models: ['RS 660', 'Tuono 660', 'SR GT 125', 'RSV4'] },
  { name: 'SYM', type: 'motorcycle', models: ['Symphony 125', 'Jet 14', 'Cruisym 300'] },
  { name: 'Kymco', type: 'motorcycle', models: ['Agility 125', 'People S 125', 'AK 550', 'X-Town 300'] },
  { name: 'Royal Enfield', type: 'motorcycle', models: ['Classic 350', 'Meteor 350', 'Himalayan', 'Interceptor 650'] },
  { name: 'Harley-Davidson', type: 'motorcycle', models: ['Sportster S', 'Nightster', 'Street Bob', 'Pan America'] },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

let cache: CatalogMake[] | null = null;

/** Fusiona las dos fuentes. El resultado se cachea entre invocaciones. */
export function loadCatalog(): CatalogMake[] {
  if (cache) return cache;

  const merged = new Map<string, CatalogMake>();

  // 1. El dataset externo, si está descargado.
  try {
    const file = join(import.meta.dirname, '..', 'data', 'open-vehicle-db.json');
    const external = JSON.parse(readFileSync(file, 'utf8')) as ExternalFile;

    for (const make of external.makes) {
      merged.set(make.slug, {
        slug: make.slug,
        name: titleCase(make.name),
        models: make.models,
        sources: ['open-vehicle-db'],
      });
    }
  } catch {
    // Sin el fichero, el catálogo se queda con las marcas locales. La app
    // sigue funcionando: es un desplegable, no un requisito.
  }

  // 2. El catálogo español encima, que completa y corrige al anterior.
  for (const entry of SPAIN) {
    const slug = slugify(entry.name);
    const existing = merged.get(slug);
    const models: CatalogModel[] = entry.models.map((name) => ({
      name,
      type: entry.type,
    }));

    if (!existing) {
      merged.set(slug, { slug, name: entry.name, models, sources: ['local'] });
      continue;
    }

    // Añadir solo lo que no esté ya, comparando sin distinguir mayúsculas.
    const known = new Set(existing.models.map((m) => m.name.toLowerCase()));
    for (const model of models) {
      if (!known.has(model.name.toLowerCase())) {
        existing.models.push(model);
      }
    }
    existing.models.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (!existing.sources.includes('local')) existing.sources.push('local');
    // El nombre local manda: viene acentuado y con la grafía correcta.
    existing.name = entry.name;
  }

  cache = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return cache;
}

/** MERCEDES-BENZ -> Mercedes-Benz */
function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-záéíóúñ])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

/** Marcas que tienen al menos un modelo del tipo pedido. */
export function makesForType(type: string): CatalogMake[] {
  return loadCatalog()
    .map((make) => ({
      ...make,
      models: make.models.filter((m) => m.type === type),
    }))
    .filter((make) => make.models.length > 0);
}

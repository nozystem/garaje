/**
 * Valores disponibles para el formulario guiado (modelos, carrocerías,
 * combustibles, cambios y motores), tirando de /v2/carfacets de API Ninjas.
 *
 * Es el único endpoint de la Cars API incluido en el plan gratuito. La clave
 * vive solo en el servidor: el navegador nunca la ve.
 */

export interface FacetValue {
  value: string;
  count: number;
}

export type Facets = Partial<Record<FacetName, FacetValue[]>>;

const FACETS = ['model', 'body', 'fuel', 'transmission', 'badge'] as const;
type FacetName = (typeof FACETS)[number];

const FILTERS = ['make', 'model', 'body', 'fuel', 'year'] as const;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;
const MAX_VALUES = 60;

const cache = new Map<string, { facets: Facets | null; expiresAt: number }>();

export function isConfigured(): boolean {
  return Boolean(process.env['API_NINJAS_KEY']);
}

/** La API no reconoce tildes: "Škoda" y "León" devuelven listas vacías. */
function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Traduce la petición del cliente a una de API Ninjas, aceptando solo los
 * filtros y facetas conocidos. Devuelve null si la petición no es válida.
 */
export function buildQuery(input: URLSearchParams): URLSearchParams | null {
  const facets = (input.get('facets') ?? '')
    .split(',')
    .filter((f): f is FacetName => (FACETS as readonly string[]).includes(f));
  const make = plain(input.get('make') ?? '');
  if (!facets.length || !make || make.length > 60) return null;

  const query = new URLSearchParams({ facets: [...new Set(facets)].sort().join(',') });

  for (const name of FILTERS) {
    const value = plain(input.get(name) ?? '');
    if (!value || value.length > 60) continue;

    if (name === 'year') {
      // `year` en la API es el año de lanzamiento de cada versión; el rango
      // incluye también las que seguían fabricándose ese año.
      if (!/^\d{4}$/.test(value)) return null;
      query.set('min_year', value);
      query.set('max_year', value);
    } else {
      query.set(name, value.toLowerCase());
    }
  }
  return query;
}

export async function carFacets(query: URLSearchParams): Promise<Facets | null> {
  const apiKey = process.env['API_NINJAS_KEY'];
  if (!apiKey) return null;

  const key = query.toString();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.facets;

  try {
    const res = await fetch(`https://api.api-ninjas.com/v2/carfacets?${key}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`API Ninjas answered ${res.status}`);

    const body = (await res.json()) as Record<string, unknown>;
    const facets: Facets = {};
    for (const name of FACETS) {
      const values = body[name];
      if (!Array.isArray(values)) continue;
      facets[name] = values
        .filter((v): v is FacetValue => v && v.value !== undefined)
        .slice(0, MAX_VALUES)
        .map((v) => ({ value: String(v.value), count: Number(v.count) || 0 }));
    }

    cache.set(key, { facets, expiresAt: Date.now() + CACHE_TTL_MS });
    return facets;
  } catch {
    cache.set(key, { facets: null, expiresAt: Date.now() + MISS_TTL_MS });
    return null;
  }
}

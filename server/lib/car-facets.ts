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

const FACETS = ['model', 'generation', 'body', 'fuel', 'transmission', 'badge', 'year'] as const;
type FacetName = (typeof FACETS)[number];

// No se filtra por año: la API ignora min_year/max_year en carfacets y su
// `year` es solo el año de lanzamiento de cada versión. La generación es lo
// que acota de verdad el coche.
const FILTERS = ['make', 'model', 'generation', 'body', 'fuel'] as const;

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
    if (value && value.length <= 60) query.set(name, value.toLowerCase());
  }
  return query;
}

export interface Generation {
  /** Tal como la nombra la API, p. ej. "2 generation facelift". */
  value: string;
  from: number;
  /** Año en que empieza la siguiente; null si es la última. */
  to: number | null;
}

/**
 * Generaciones de un modelo con sus años. La API no da el rango: el inicio
 * es el año en que se lanzaron más versiones de esa generación y el final,
 * el inicio de la siguiente. No se usa el año mínimo porque la API tiene
 * versiones mal fechadas (un Golf Mk2 de 1974, un Corolla E120 de 1992).
 */
export async function generationsFor(make: string, model: string): Promise<Generation[] | null> {
  const base = buildQuery(new URLSearchParams({ make, model, facets: 'generation' }));
  if (!base) return null;

  const list = await carFacets(base);
  if (!list) return null;

  const starts = await Promise.all(
    (list.generation ?? []).map(async ({ value }) => {
      const query = buildQuery(new URLSearchParams({ make, model, generation: value, facets: 'year' }));
      const years = query ? (await carFacets(query))?.year : undefined;
      const launch = [...(years ?? [])].sort((a, b) => b.count - a.count)[0];
      const from = Number(launch?.value);
      return Number.isFinite(from) ? { value, from } : null;
    })
  );

  const sorted = starts
    .filter((g): g is { value: string; from: number } => g !== null)
    .sort((a, b) => a.from - b.from);

  return sorted.map((g, i) => ({ ...g, to: sorted[i + 1]?.from ?? null }));
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

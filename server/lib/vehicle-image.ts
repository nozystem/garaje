export interface VehicleImageQuery {
  make: string;
  model: string;
  year: number;
  type: string;
}

interface CachedImage {
  url: string | null;
  expiresAt: number;
}

const cache = new Map<string, CachedImage>();

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;

function keyOf(q: VehicleImageQuery): string {
  return `${q.type}|${q.make}|${q.model}|${q.year}`.toLowerCase();
}

export function isConfigured(): boolean {
  return Boolean(process.env['CAR_IMAGES_API_KEY']);
}

export async function stockImageUrl(
  q: VehicleImageQuery
): Promise<string | null> {
  const apiKey = process.env['CAR_IMAGES_API_KEY'];
  if (!apiKey) return null;

  const key = keyOf(q);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.url;

  const params = new URLSearchParams({
    api_key: apiKey,
    make: q.make,
    model: q.model,
    year: String(q.year),
    type: q.type === 'motorcycle' ? 'moto' : 'car',
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const res = await fetch(
      `https://carimagesapi.com/api/v1/signed-url?${params}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (!res.ok) {
      cache.set(key, { url: null, expiresAt: Date.now() + MISS_TTL_MS });
      return null;
    }

    const body = (await res.json()) as { url?: string };
    const url = typeof body.url === 'string' ? body.url : null;

    cache.set(key, {
      url,
      expiresAt: Date.now() + (url ? CACHE_TTL_MS : MISS_TTL_MS),
    });
    return url;
  } catch {
    cache.set(key, { url: null, expiresAt: Date.now() + MISS_TTL_MS });
    return null;
  }
}

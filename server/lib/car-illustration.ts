/**
 * Ilustración lateral de cada coche generada con Gemini.
 *
 * Tarda unos segundos y cuesta dinero por imagen, así que se genera una vez
 * y se guarda con el vehículo. La clave vive solo en el servidor.
 */

export interface IllustrationQuery {
  make: string;
  model: string;
  year: number;
  body?: string;
  color?: string;
}

const MODEL = 'gemini-3.1-flash-image';
const REQUEST_TIMEOUT_MS = 90_000;

/** Los colores del formulario, con un nombre que el modelo entienda. */
const COLOR_NAMES: Record<string, string> = {
  '#e74c3c': 'bright red',
  '#4d9de0': 'sky blue',
  '#2ec27e': 'emerald green',
  '#f5a623': 'amber yellow',
  '#9b59b6': 'purple',
  '#16a085': 'teal',
  '#5d6d7e': 'slate grey',
  '#e67e22': 'orange',
};

export function isConfigured(): boolean {
  return Boolean(process.env['GEMINI_API_KEY']);
}

function promptFor(q: IllustrationQuery): string {
  const color = (q.color && COLOR_NAMES[q.color.toLowerCase()]) ?? 'silver';
  const body = q.body ? ` ${q.body.toLowerCase()}` : '';

  return [
    `A clean vector-style illustration of a ${q.year} ${q.make} ${q.model}${body},`,
    `painted ${color}, seen exactly from the side (pure side profile), front facing left.`,
    'Accurate proportions and details for that exact model and generation.',
    'Crisp outlines, soft glossy shading, alloy wheels, tinted windows.',
    'Plain white background, a thin soft shadow under the wheels,',
    'no text, no logos, no watermark, no people, the whole car in frame.',
  ].join(' ');
}

/** Busca la primera imagen en la respuesta, sea cual sea su anidamiento. */
function findImage(node: unknown): { data: string; mimeType: string } | null {
  if (!node || typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;

  const data = record['data'];
  const mimeType = record['mime_type'] ?? record['mimeType'];
  if (typeof data === 'string' && typeof mimeType === 'string' && mimeType.startsWith('image/')) {
    return { data, mimeType };
  }

  for (const value of Object.values(record)) {
    const found = findImage(value);
    if (found) return found;
  }
  return null;
}

/** Devuelve la ilustración como data URL, o null si no se pudo generar. */
export async function generateIllustration(q: IllustrationQuery): Promise<string | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) return null;

  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        input: [{ type: 'text', text: promptFor(q) }],
        response_format: {
          type: 'image',
          mime_type: 'image/jpeg',
          aspect_ratio: '16:9',
          image_size: '1K',
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`Gemini answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }

    const image = findImage(await res.json());
    return image ? `data:${image.mimeType};base64,${image.data}` : null;
  } catch (error) {
    console.error('Gemini illustration failed:', error);
    return null;
  }
}

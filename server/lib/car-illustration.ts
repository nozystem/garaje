/**
 * Ilustración lateral de cada coche generada con Gemini.
 *
 * Cuesta unos céntimos por imagen y tarda unos segundos, así que se genera
 * una vez y se guarda con el vehículo. La clave vive solo en el servidor.
 */

export interface IllustrationQuery {
  make: string;
  model: string;
  year: number;
  generation?: string;
  body?: string;
  color?: string;
}

/** La mitad de precio que gemini-3.1-flash-image y acierta igual el modelo. */
const MODEL = 'gemini-3.1-flash-lite-image';
const REQUEST_TIMEOUT_MS = 90_000;

/** Precio oficial de una imagen 1K de ese modelo, para el panel de admin. */
export const COST_PER_IMAGE_USD = 0.0336;

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

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];

/** Minúsculas, sin tildes ni espacios sobrantes: "León" y "leon " son lo mismo. */
function plain(text: string | undefined): string {
  return (text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/**
 * Identifica lo que se ve en la ilustración, para reutilizarla entre coches
 * iguales. Con generación el año sobra: dentro de ella el coche no cambia.
 */
export function illustrationKey(q: IllustrationQuery): string {
  return [
    plain(q.make),
    plain(q.model),
    plain(q.generation) || String(q.year),
    plain(q.body) || 'car',
    plain(q.color) || 'silver',
  ].join('|');
}

export function isConfigured(): boolean {
  return Boolean(process.env['GEMINI_API_KEY']);
}

/**
 * El año solo no basta para que el modelo acierte la generación. API Ninjas
 * la nombra a veces por número ("2 generation facelift", que pasa a "second
 * generation (Mk2) facelift") y a veces por código de chasis ("E46", "Mk5/A5").
 */
function generationText(generation: string | undefined): string {
  const value = generation?.trim();
  if (!value) return '';

  const match = /^(\d+) generation( facelift)?/i.exec(value);
  if (!match) return `, ${value} generation`;

  const n = Number(match[1]);
  const ordinal = ORDINALS[n - 1] ?? `${n}th`;
  return `, ${ordinal} generation (Mk${n})${match[2] ? ' facelift' : ''}`;
}

function promptFor(q: IllustrationQuery): string {
  const color = (q.color && COLOR_NAMES[q.color.toLowerCase()]) ?? 'silver';
  const body = q.body?.toLowerCase() ?? 'car';

  return [
    `Side view illustration of a ${q.year} ${q.make} ${q.model}${generationText(q.generation)},`,
    `${body}, painted ${color}. Accurate shape and details for that exact model and generation.`,
    'Pure 90-degree side profile, the whole car visible, front of the car pointing left.',
    'Clean vector art style, crisp outlines, glossy shading, alloy wheels, tinted windows.',
    'Plain white background, thin soft shadow under the wheels.',
    'No text, no logos, no watermark.',
  ].join(' ');
}

/**
 * Busca la primera imagen en la respuesta. Hoy llega en
 * steps[].content[] con { type: 'image', mime_type, data }, pero el formato
 * de la API es reciente y así no depende de su anidamiento exacto.
 */
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

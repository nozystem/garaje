/**
 * Lectura de un ticket o una factura de taller con Gemini: de una foto saca
 * lo que hace falta para apuntar el mantenimiento (qué se hizo, cuándo, con
 * cuántos kilómetros, cuánto costó y dónde), para que el usuario solo tenga
 * que revisarlo.
 */

export interface ScannedReceipt {
  title: string | null;
  category: string;
  date: string | null;
  mileage: number | null;
  cost: number | null;
  workshop: string | null;
  parts: string | null;
}

export type ScanLang = 'en' | 'es';

const MODEL = 'gemini-3.8-flash';
const REQUEST_TIMEOUT_MS = 60_000;

/** Precio por millón de tokens hasta el 31/12/2026; el razonamiento cuenta como salida. */
const USD_PER_M_INPUT = 0.75;
const USD_PER_M_OUTPUT = 3.75;

const CATEGORIES = [
  'oil', 'filters', 'brakes', 'tires', 'battery',
  'coolant', 'timing-belt', 'inspection', 'insurance', 'other',
];

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: ['string', 'null'] },
    category: { type: 'string', enum: CATEGORIES },
    date: { type: ['string', 'null'] },
    mileage: { type: ['integer', 'null'] },
    cost: { type: ['number', 'null'] },
    workshop: { type: ['string', 'null'] },
    parts: { type: ['string', 'null'] },
  },
  required: ['title', 'category', 'date', 'mileage', 'cost', 'workshop', 'parts'],
};

const LANGUAGE_NAMES: Record<ScanLang, string> = { en: 'English', es: 'Spanish' };

export function isConfigured(): boolean {
  return Boolean(process.env['GEMINI_API_KEY']);
}

function promptFor(lang: ScanLang): string {
  return [
    'This is a photo of a receipt or invoice from a car workshop, a tyre shop or an ITV station.',
    'Extract what is needed to log the maintenance in a car maintenance app:',
    `- title: what was done, in at most 6 words, in ${LANGUAGE_NAMES[lang]} (e.g. "Oil and filter change");`,
    '- category: the one that best fits the main job;',
    '- date: the date of the service as YYYY-MM-DD;',
    '- mileage: the odometer reading in km written on it, if any;',
    '- cost: the total paid, taxes included, as a number;',
    '- workshop: the name of the business;',
    `- parts: the parts and fluids replaced, comma separated, with references if printed, in ${LANGUAGE_NAMES[lang]}.`,
    'Use null for anything that is not on the document. Do not guess.',
  ].join('\n');
}

/** Descarta lo que no encaje: la respuesta viene de un modelo, no de una fuente fiable. */
export function sanitizeReceipt(raw: unknown): ScannedReceipt {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
  const number = (value: unknown, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;

  const date = typeof r['date'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r['date'])
    && !Number.isNaN(new Date(r['date']).getTime())
    ? r['date']
    : null;

  return {
    title: text(r['title'], 120),
    category: CATEGORIES.includes(r['category'] as string) ? (r['category'] as string) : 'other',
    date,
    mileage: number(r['mileage'], 3_000_000) === null ? null : Math.round(r['mileage'] as number),
    cost: number(r['cost'], 1_000_000),
    workshop: text(r['workshop'], 80),
    parts: text(r['parts'], 500),
  };
}

/** El texto con el JSON pedido, esté donde esté en la respuesta. */
function findJson(node: unknown): string | null {
  if (typeof node === 'string') return node.trim().startsWith('{') ? node : null;
  if (!node || typeof node !== 'object') return null;
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = findJson(value);
    if (found) return found;
  }
  return null;
}

/** Lo leído del ticket y lo que ha costado, o null si no se pudo leer. */
export async function scanReceipt(
  image: string,
  lang: ScanLang
): Promise<{ receipt: ScannedReceipt; costUsd: number } | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image);
  if (!apiKey || !match) return null;

  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { type: 'text', text: promptFor(lang) },
          { type: 'image', data: match[2], mime_type: match[1] },
        ],
        response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`Gemini answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }

    const body = (await res.json()) as {
      usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number };
    };
    const json = findJson(body);
    if (!json) return null;

    const usage = body.usage ?? {};
    const costUsd =
      ((usage.total_input_tokens ?? 0) * USD_PER_M_INPUT +
        ((usage.total_output_tokens ?? 0) + (usage.total_thought_tokens ?? 0)) * USD_PER_M_OUTPUT) /
      1_000_000;

    return { receipt: sanitizeReceipt(JSON.parse(json)), costUsd };
  } catch (error) {
    console.error('Gemini receipt scan failed:', error);
    return null;
  }
}

/**
 * Plan de mantenimiento propuesto por Gemini para un coche concreto,
 * siguiendo el calendario del fabricante para su motor y generación.
 *
 * Los intervalos no dependen de los kilómetros de cada coche, así que el plan
 * se guarda por modelo y se reutiliza: los kilómetros los aplica la app al
 * enseñarlo.
 */

export interface PlanQuery {
  make: string;
  model: string;
  year: number;
  generation?: string;
  body?: string;
  fuel: string;
  transmission?: string;
  engine?: string;
}

export interface SuggestedTask {
  category: string;
  title: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  why: string;
}

export type PlanLang = 'en' | 'es';

const MODEL = 'gemini-3.8-flash';
const REQUEST_TIMEOUT_MS = 90_000;

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
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          title: { type: 'string' },
          intervalKm: { type: ['integer', 'null'] },
          intervalMonths: { type: ['integer', 'null'] },
          why: { type: 'string' },
        },
        required: ['category', 'title', 'intervalKm', 'intervalMonths', 'why'],
      },
    },
  },
  required: ['tasks'],
};

const LANGUAGE_NAMES: Record<PlanLang, string> = { en: 'English', es: 'Spanish' };

/** Minúsculas y sin tildes, como la clave de las ilustraciones. */
function plain(text: string | undefined): string {
  return (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/** Lo que cambia el plan: el coche, su motor y el idioma de los textos. */
export function planKey(q: PlanQuery, lang: PlanLang): string {
  return [
    'v1',
    lang,
    plain(q.make),
    plain(q.model),
    plain(q.generation) || String(q.year),
    plain(q.fuel),
    plain(q.engine),
    plain(q.transmission),
  ].join('|');
}

export function isConfigured(): boolean {
  return Boolean(process.env['GEMINI_API_KEY']);
}

function describe(q: PlanQuery): string {
  return [
    `${q.year} ${q.make} ${q.model}`,
    q.generation && `generation: ${q.generation}`,
    q.body && `body: ${q.body}`,
    `fuel: ${q.fuel}`,
    q.engine && `engine: ${q.engine}`,
    q.transmission && `gearbox: ${q.transmission.replace(/_/g, ' ')}`,
  ]
    .filter(Boolean)
    .join(', ');
}

function promptFor(q: PlanQuery, lang: PlanLang): string {
  return [
    "You are an expert car mechanic. Build the recommended maintenance schedule for this exact car,",
    "following the manufacturer's service schedule for its engine and generation.",
    `Car: ${describe(q)}. Market: Spain.`,
    'Include every recurring item that applies to this car (engine oil and filter, air, fuel and',
    'cabin filters, brake pads and fluid, coolant, timing belt or chain, spark or glow plugs,',
    'gearbox oil, auxiliary belt, battery, tyres, ITV roadworthiness test...), and nothing that',
    'does not apply (for example no oil changes on an electric car).',
    'Give intervals in km and/or months as the manufacturer recommends; use null when one does not apply.',
    `Write the titles (max 6 words) and the short 'why' (max 12 words) in ${LANGUAGE_NAMES[lang]}.`,
  ].join(' ');
}

/** Descarta lo que no encaje: la respuesta viene de un modelo, no de una fuente fiable. */
function sanitize(raw: unknown): SuggestedTask[] {
  const tasks = (raw as { tasks?: unknown })?.tasks;
  if (!Array.isArray(tasks)) return [];

  const interval = (value: unknown, max: number) =>
    Number.isInteger(value) && (value as number) > 0 && (value as number) <= max
      ? (value as number)
      : null;

  return tasks
    .map((t: Record<string, unknown>) => ({
      category: CATEGORIES.includes(t['category'] as string) ? (t['category'] as string) : 'other',
      title: String(t['title'] ?? '').trim().slice(0, 120),
      intervalKm: interval(t['intervalKm'], 1_000_000),
      intervalMonths: interval(t['intervalMonths'], 240),
      why: String(t['why'] ?? '').trim().slice(0, 200),
    }))
    .filter((t) => t.title && (t.intervalKm || t.intervalMonths))
    .slice(0, 30);
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

/** Devuelve las tareas y lo que ha costado pedirlas, o null si no se pudo. */
export async function suggestPlan(
  q: PlanQuery,
  lang: PlanLang
): Promise<{ tasks: SuggestedTask[]; costUsd: number } | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) return null;

  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        input: promptFor(q, lang),
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
    const tasks = json ? sanitize(JSON.parse(json)) : [];
    if (!tasks.length) return null;

    const usage = body.usage ?? {};
    const costUsd =
      ((usage.total_input_tokens ?? 0) * USD_PER_M_INPUT +
        ((usage.total_output_tokens ?? 0) + (usage.total_thought_tokens ?? 0)) * USD_PER_M_OUTPUT) /
      1_000_000;

    return { tasks, costUsd };
  } catch (error) {
    console.error('Gemini maintenance plan failed:', error);
    return null;
  }
}

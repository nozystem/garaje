/**
 * Ilustración lateral de cada coche generada con Workers AI de Cloudflare
 * (FLUX.2 klein), dentro del cupo diario gratuito.
 *
 * Tarda unos segundos, así que se genera una vez y se guarda con el
 * vehículo. El token vive solo en el servidor.
 */

export interface IllustrationQuery {
  make: string;
  model: string;
  year: number;
  generation?: string;
  body?: string;
  color?: string;
}

/** Clava mucho mejor cada modelo, pero su cupo gratuito da para pocas al día. */
const ACCURATE_MODEL = '@cf/black-forest-labs/flux-2-klein-9b';
/** Menos fiel, pero el cupo gratuito da para cientos al día. */
const CHEAP_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
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

function credentials(): { account: string; token: string } | null {
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const token = process.env['CLOUDFLARE_AI_TOKEN'];
  return account && token ? { account, token } : null;
}

export function isConfigured(): boolean {
  return credentials() !== null;
}

/** Código de Workers AI cuando su filtro rechaza la imagen generada. */
const FLAGGED = 3030;

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];

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

/** Con `generic` se describe el coche sin marca ni modelo. */
function promptFor(q: IllustrationQuery, generic = false): string {
  const color = (q.color && COLOR_NAMES[q.color.toLowerCase()]) ?? 'silver';
  const body = q.body?.toLowerCase() ?? 'car';

  const subject = generic
    ? `Side view illustration of a modern ${q.year} ${body}, painted ${color}.`
    : `Side view illustration of a ${q.year} ${q.make} ${q.model}${generationText(q.generation)} ` +
      `${body}, painted ${color}. ` +
      'Accurate shape and details for that exact model and generation.';

  return [
    subject,
    'Pure 90-degree side profile, the whole car visible, front of the car pointing left.',
    'Clean vector art style, crisp outlines, glossy shading, alloy wheels, tinted windows.',
    'Plain white background, thin soft shadow under the wheels.',
    'No text, no logos, no watermark.',
  ].join(' ');
}

/**
 * Devuelve la ilustración como data URL, o null si no se pudo generar.
 *
 * Empieza por el modelo más fiel. Si se agota su cupo o el filtro de
 * Workers AI rechaza la imagen, pasa al modelo pequeño. El filtro rechaza
 * siempre algunas marcas (BMW y Mercedes-Benz, y Audi con el modelo grande);
 * para esas queda un coche genérico de su año, carrocería y color.
 */
export async function generateIllustration(q: IllustrationQuery): Promise<string | null> {
  const attempts: [string, boolean][] = [
    [ACCURATE_MODEL, false],
    [CHEAP_MODEL, false],
    [CHEAP_MODEL, true],
  ];

  for (const [model, generic] of attempts) {
    const result = await draw(model, promptFor(q, generic));
    if (result === 'flagged') continue;
    if (result) return result;
    // Un fallo que no es del filtro (cupo agotado, caída) no se arregla
    // quitando la marca: basta con probar el modelo pequeño una vez.
    if (model === CHEAP_MODEL) return null;
  }
  return null;
}

async function draw(model: string, prompt: string): Promise<string | null | 'flagged'> {
  const auth = credentials();
  if (!auth) return null;

  // Estos modelos solo aceptan multipart, no JSON.
  const form = new FormData();
  form.set('prompt', prompt);
  form.set('width', '1024');
  form.set('height', '576');

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${auth.account}/ai/run/${model}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}` },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );

    const body = (await res.json()) as {
      result?: { image?: unknown };
      errors?: { code?: number; message?: string }[];
    };

    if (!res.ok) {
      if (body.errors?.some((e) => e.code === FLAGGED)) return 'flagged';
      console.error(`Workers AI answered ${res.status}: ${body.errors?.[0]?.message ?? ''}`);
      return null;
    }

    const image = body.result?.image;
    return typeof image === 'string' ? `data:image/jpeg;base64,${image}` : null;
  } catch (error) {
    console.error('Workers AI illustration failed:', error);
    return null;
  }
}

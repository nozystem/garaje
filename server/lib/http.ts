import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * Identifica el garaje sin obligar a registrarse.
 *
 * El cliente genera un id aleatorio la primera vez y lo envía en esta
 * cabecera. No es autenticación —quien conozca el id ve ese garaje— y la app
 * lo advierte en la interfaz. A cambio, cualquiera puede probar el proyecto
 * sin crear una cuenta, que es lo que interesa en un portfolio.
 */
const OWNER_HEADER = 'x-garage-id';

export function ownerFrom(req: IncomingMessage): string | null {
  const raw = req.headers[OWNER_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value || !/^[a-z0-9-]{8,64}$/i.test(value)) {
    return null;
  }
  return value;
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Los datos del garaje no se cachean; quien quiera otra cosa (el catálogo)
  // pone su propia cabecera antes de llamar aquí.
  if (!res.hasHeader('Cache-Control')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(JSON.stringify(body));
}

export function badRequest(res: ServerResponse, errors: string[]): void {
  json(res, 400, { error: 'Datos inválidos', details: errors });
}

export function unauthorized(res: ServerResponse): void {
  json(res, 401, { error: `Falta la cabecera ${OWNER_HEADER}` });
}

export function notFound(res: ServerResponse): void {
  json(res, 404, { error: 'No encontrado' });
}

export function methodNotAllowed(res: ServerResponse, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '));
  json(res, 405, { error: 'Método no permitido' });
}

/** Lee y parsea el cuerpo JSON, con un límite para no tragar cualquier cosa. */
export async function readJson(req: IncomingMessage): Promise<unknown> {
  // Suficiente para un vehículo con foto ya reducida en el cliente.
  const MAX_BYTES = 400_000;
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BYTES) throw new Error('Cuerpo demasiado grande');
    chunks.push(chunk as Buffer);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('JSON mal formado');
  }
}

export function newId(): string {
  return randomUUID();
}

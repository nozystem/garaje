import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!res.hasHeader('Cache-Control')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(JSON.stringify(body));
}

export function badRequest(res: ServerResponse, errors: string[]): void {
  json(res, 400, { error: 'Invalid data', details: errors });
}

export function unauthorized(res: ServerResponse): void {
  json(res, 401, { error: 'Not signed in' });
}

export function notFound(res: ServerResponse): void {
  json(res, 404, { error: 'Not found' });
}

export function methodNotAllowed(res: ServerResponse, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '));
  json(res, 405, { error: 'Method not allowed' });
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const MAX_BYTES = 400_000;
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BYTES) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Malformed JSON');
  }
}

export function newId(): string {
  return randomUUID();
}

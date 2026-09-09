import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

/** promisify pierde la sobrecarga que acepta opciones; se tipa a mano. */
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * Parámetros de scrypt. N=16384 es el mínimo recomendado por OWASP para uso
 * interactivo: tarda ~100 ms, suficiente para encarecer un ataque por fuerza
 * bruta sin que el login se note lento.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/**
 * Deriva el hash de una contraseña.
 *
 * Se usa scrypt del propio Node en lugar de bcrypt para no añadir una
 * dependencia nativa, que en serverless complica el despliegue. Cada hash
 * lleva su sal, así que dos contraseñas iguales producen hashes distintos.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * Comprueba una contraseña contra su hash.
 *
 * La comparación es en tiempo constante: comparar con === filtraría, por el
 * tiempo de respuesta, cuántos bytes coinciden.
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');

  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.length, SCRYPT);
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/* --- Tokens de sesión ------------------------------------------------------ */

interface TokenPayload {
  /** Id del usuario. */
  sub: string;
  /** Emisión y caducidad, en segundos desde epoch. */
  iat: number;
  exp: number;
}

const TOKEN_TTL_DAYS = 30;

function secret(): string {
  const value = process.env['AUTH_SECRET'];

  if (!value || value.length < 32) {
    // Sin secreto, cualquiera podría firmar tokens válidos. Es preferible no
    // arrancar a arrancar con una seguridad aparente.
    throw new Error(
      'Falta AUTH_SECRET (mínimo 32 caracteres). Genera uno con: openssl rand -base64 48'
    );
  }
  return value;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sign(data: string): string {
  return base64url(createHmac('sha256', secret()).update(data).digest());
}

/**
 * Emite un token de sesión.
 *
 * Es un JWT firmado con HMAC-SHA256, escrito a mano para no añadir una
 * dependencia por 30 líneas. No lleva datos sensibles: solo el id del usuario
 * y las fechas, porque el contenido de un JWT es legible por cualquiera.
 */
export function issueToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: userId,
    iat: now,
    exp: now + TOKEN_TTL_DAYS * 86400,
  };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

/** Devuelve el id del usuario si el token es válido y no ha caducado. */
export function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;

  // Comparación en tiempo constante también aquí.
  const expected = sign(`${header}.${body}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    ) as TokenPayload;

    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export function newId(): string {
  return randomUUID();
}

export const TOKEN_MAX_AGE_SECONDS = TOKEN_TTL_DAYS * 86400;

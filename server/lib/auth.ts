import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  TOKEN_MAX_AGE_SECONDS,
  hashPassword,
  issueToken,
  newId,
  verifyPassword,
  verifyToken,
} from './crypto.ts';
import { badRequest, json, readJson } from './http.ts';
import { createUser, findUserByEmail, findUserById } from './store.ts';
import type { PublicUser, StoredUser } from './types.ts';

const COOKIE = 'garaje_session';

/**
 * La sesión viaja en una cookie httpOnly, no en localStorage: así el token no
 * es accesible desde JavaScript y un XSS no puede robarlo. SameSite=Lax evita
 * que se envíe en peticiones desde otros sitios.
 */
function sessionCookie(token: string, maxAge: number): string {
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  // En producción la cookie solo debe viajar por HTTPS.
  if (process.env['NODE_ENV'] === 'production') parts.push('Secure');
  return parts.join('; ');
}

function tokenFrom(req: IncomingMessage): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;

  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

/** Id del usuario autenticado, o null si la sesión no es válida. */
export function userIdFrom(req: IncomingMessage): string | null {
  const token = tokenFrom(req);
  return token ? verifyToken(token) : null;
}

function toPublic(user: StoredUser): PublicUser {
  // El hash de la contraseña nunca sale de la API.
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}

/* --- Validación ------------------------------------------------------------ */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;

interface Credentials {
  email: string;
  password: string;
  name?: string;
}

function readCredentials(
  body: unknown,
  withName: boolean
): { ok: true; value: Credentials } | { ok: false; errors: string[] } {
  const data = (typeof body === 'object' && body ? body : {}) as Record<string, unknown>;
  const errors: string[] = [];

  const email = typeof data['email'] === 'string' ? data['email'].trim() : '';
  const password = typeof data['password'] === 'string' ? data['password'] : '';
  const name = typeof data['name'] === 'string' ? data['name'].trim() : '';

  if (!EMAIL.test(email) || email.length > 254) {
    errors.push('El correo no es válido');
  }
  if (password.length < MIN_PASSWORD) {
    errors.push(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
  }
  if (password.length > 200) {
    errors.push('La contraseña es demasiado larga');
  }
  if (withName && (name.length < 2 || name.length > 60)) {
    errors.push('El nombre debe tener entre 2 y 60 caracteres');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { email, password, name: name || undefined } };
}

/* --- Rutas ----------------------------------------------------------------- */

export async function handleRegister(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (error) {
    return badRequest(res, [(error as Error).message]);
  }

  const parsed = readCredentials(body, true);
  if (!parsed.ok) return badRequest(res, parsed.errors);

  const { email, password, name } = parsed.value;

  if (await findUserByEmail(email)) {
    return json(res, 409, { error: 'Ya existe una cuenta con ese correo' });
  }

  const user: StoredUser = {
    id: newId(),
    email,
    passwordHash: await hashPassword(password),
    name: name as string,
    createdAt: new Date().toISOString(),
  };

  try {
    await createUser(user);
  } catch {
    // El índice único puede saltar si dos registros llegan a la vez.
    return json(res, 409, { error: 'Ya existe una cuenta con ese correo' });
  }

  res.setHeader('Set-Cookie', sessionCookie(issueToken(user.id), TOKEN_MAX_AGE_SECONDS));
  json(res, 201, { user: toPublic(user) });
}

export async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (error) {
    return badRequest(res, [(error as Error).message]);
  }

  const parsed = readCredentials(body, false);
  if (!parsed.ok) return badRequest(res, parsed.errors);

  const user = await findUserByEmail(parsed.value.email);

  // Mismo mensaje tanto si el correo no existe como si la contraseña falla:
  // distinguirlos permitiría averiguar qué correos están registrados.
  const invalid = () =>
    json(res, 401, { error: 'Correo o contraseña incorrectos' });

  if (!user) {
    // Se calcula un hash igualmente para que el tiempo de respuesta no
    // delate si el correo existe.
    await hashPassword(parsed.value.password);
    return invalid();
  }

  if (!(await verifyPassword(parsed.value.password, user.passwordHash))) {
    return invalid();
  }

  res.setHeader('Set-Cookie', sessionCookie(issueToken(user.id), TOKEN_MAX_AGE_SECONDS));
  json(res, 200, { user: toPublic(user) });
}

export function handleLogout(res: ServerResponse): void {
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  json(res, 200, { ok: true });
}

export async function handleMe(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const userId = userIdFrom(req);
  if (!userId) return json(res, 401, { error: 'No has iniciado sesión' });

  const user = await findUserById(userId);
  if (!user) {
    // La cuenta se borró pero el token sigue vivo: se cierra la sesión.
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return json(res, 401, { error: 'La cuenta ya no existe' });
  }

  json(res, 200, { user: toPublic(user) });
}

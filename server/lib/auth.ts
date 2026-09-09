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

function sessionCookie(token: string, maxAge: number): string {
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
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

export function userIdFrom(req: IncomingMessage): string | null {
  const token = tokenFrom(req);
  return token ? verifyToken(token) : null;
}

function toPublic(user: StoredUser): PublicUser {
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
    errors.push('Invalid email address');
  }
  if (password.length < MIN_PASSWORD) {
    errors.push(`Password must be at least ${MIN_PASSWORD} characters`);
  }
  if (password.length > 200) {
    errors.push('Password is too long');
  }
  if (withName && (name.length < 2 || name.length > 60)) {
    errors.push('Name must be between 2 and 60 characters');
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
    return json(res, 409, { error: 'An account with that email already exists' });
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
    return json(res, 409, { error: 'An account with that email already exists' });
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

  const invalid = () =>
    json(res, 401, { error: 'Incorrect email or password' });

  if (!user) {
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
  if (!userId) return json(res, 401, { error: 'Not signed in' });

  const user = await findUserById(userId);
  if (!user) {
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return json(res, 401, { error: 'This account no longer exists' });
  }

  json(res, 200, { user: toPublic(user) });
}

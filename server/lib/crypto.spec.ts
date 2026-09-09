import { beforeAll, describe, expect, it } from 'vitest';

import {
  hashPassword,
  issueToken,
  verifyPassword,
  verifyToken,
} from './crypto.ts';

beforeAll(() => {
  process.env['AUTH_SECRET'] = 'un-secreto-de-pruebas-suficientemente-largo-1234';
});

describe('hashPassword y verifyPassword', () => {
  it('verifica la contraseña correcta', async () => {
    const hash = await hashPassword('mi-contraseña-segura');
    expect(await verifyPassword('mi-contraseña-segura', hash)).toBe(true);
  });

  it('rechaza una contraseña incorrecta', async () => {
    const hash = await hashPassword('mi-contraseña-segura');
    expect(await verifyPassword('otra-contraseña', hash)).toBe(false);
  });

  it('nunca guarda la contraseña en claro', async () => {
    const hash = await hashPassword('secreto123');
    expect(hash).not.toContain('secreto123');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('genera hashes distintos para la misma contraseña', async () => {
    // Cada hash lleva su propia sal: si no, dos usuarios con la misma
    // contraseña serían identificables en una filtración.
    const a = await hashPassword('igual');
    const b = await hashPassword('igual');
    expect(a).not.toBe(b);
    expect(await verifyPassword('igual', a)).toBe(true);
    expect(await verifyPassword('igual', b)).toBe(true);
  });

  it('no revienta con un hash corrupto', async () => {
    expect(await verifyPassword('x', 'basura')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'md5$abc$def')).toBe(false);
  });
});

describe('tokens de sesión', () => {
  it('emite un token que se puede verificar', () => {
    const token = issueToken('usuario-1');
    expect(verifyToken(token)).toBe('usuario-1');
  });

  it('rechaza un token manipulado', () => {
    const token = issueToken('usuario-1');
    const [h, b, s] = token.split('.');

    // Cambiar el usuario en el cuerpo invalida la firma.
    const otro = Buffer.from(JSON.stringify({
      sub: 'usuario-2',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');

    expect(verifyToken(`${h}.${otro}.${s}`)).toBeNull();
  });

  it('rechaza una firma falsa', () => {
    const [h, b] = issueToken('usuario-1').split('.');
    expect(verifyToken(`${h}.${b}.firmaInventada`)).toBeNull();
  });

  it('rechaza tokens mal formados', () => {
    expect(verifyToken('')).toBeNull();
    expect(verifyToken('abc')).toBeNull();
    expect(verifyToken('a.b')).toBeNull();
  });

  it('rechaza un token caducado', () => {
    // Se construye a mano uno con exp en el pasado, firmado correctamente.
    const { createHmac } = require('node:crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
      sub: 'usuario-1', iat: 1000, exp: 2000,
    })).toString('base64url');
    const sig = createHmac('sha256', process.env['AUTH_SECRET'])
      .update(`${header}.${body}`).digest('base64url');

    expect(verifyToken(`${header}.${body}.${sig}`)).toBeNull();
  });
});

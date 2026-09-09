import { beforeAll, describe, expect, it } from 'vitest';

import {
  hashPassword,
  issueToken,
  verifyPassword,
  verifyToken,
} from './crypto.ts';

beforeAll(() => {
  process.env['AUTH_SECRET'] = 'a-test-secret-that-is-long-enough-1234567890';
});

describe('hashPassword y verifyPassword', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword('my-secure-password');
    expect(await verifyPassword('my-secure-password', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('my-secure-password');
    expect(await verifyPassword('another-password', hash)).toBe(false);
  });

  it('never stores the password in plain text', async () => {
    const hash = await hashPassword('secret123');
    expect(hash).not.toContain('secret123');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('produces different hashes for the same password', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('survives a corrupted hash', async () => {
    expect(await verifyPassword('x', 'basura')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'md5$abc$def')).toBe(false);
  });
});

describe('session tokens', () => {
  it('issues a token that verifies', () => {
    const token = issueToken('user-1');
    expect(verifyToken(token)).toBe('user-1');
  });

  it('rejects a tampered token', () => {
    const token = issueToken('user-1');
    const [h, b, s] = token.split('.');

    const otro = Buffer.from(JSON.stringify({
      sub: 'user-2',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');

    expect(verifyToken(`${h}.${otro}.${s}`)).toBeNull();
  });

  it('rejects a forged signature', () => {
    const [h, b] = issueToken('user-1').split('.');
    expect(verifyToken(`${h}.${b}.firmaInventada`)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyToken('')).toBeNull();
    expect(verifyToken('abc')).toBeNull();
    expect(verifyToken('a.b')).toBeNull();
  });

  it('rejects an expired token', () => {
    const { createHmac } = require('node:crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
      sub: 'user-1', iat: 1000, exp: 2000,
    })).toString('base64url');
    const sig = createHmac('sha256', process.env['AUTH_SECRET'])
      .update(`${header}.${body}`).digest('base64url');

    expect(verifyToken(`${header}.${body}.${sig}`)).toBeNull();
  });
});

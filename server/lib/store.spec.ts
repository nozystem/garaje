import { describe, expect, it } from 'vitest';

import { connectionString, sslFor } from './store.ts';

describe('sslFor', () => {
  it('disables SSL for a local Postgres', () => {
    expect(sslFor('postgres://user@localhost:5432/garaje')).toBe(false);
    expect(sslFor('postgres://user@127.0.0.1:5432/garaje')).toBe(false);
    expect(sslFor('postgres://user:pass@[::1]:5432/garaje')).toBe(false);
  });

  it('honours sslmode=disable even on a remote host', () => {
    expect(sslFor('postgres://user@db.ejemplo.com/garaje?sslmode=disable')).toBe(false);
  });

  it('enables SSL for a cloud provider', () => {
    expect(sslFor('postgres://user:pass@ep-cool.neon.tech/garaje')).toEqual({
      rejectUnauthorized: false,
    });
    expect(sslFor('postgres://user:pass@db.supabase.co:5432/postgres')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('does not mistake a host that merely contains "localhost"', () => {
    expect(sslFor('postgres://user@localhost.ejemplo.com/garaje')).toEqual({
      rejectUnauthorized: false,
    });
  });
});

describe('connectionString', () => {
  it('rewrites sslmode=require so pg does not warn about verify-full', () => {
    expect(
      connectionString('postgresql://u:p@host/db?sslmode=require&channel_binding=require')
    ).toBe('postgresql://u:p@host/db?sslmode=no-verify&channel_binding=require');
  });

  it('leaves a connection string without sslmode untouched', () => {
    const url = 'postgres://user@127.0.0.1:5432/garage';
    expect(connectionString(url)).toBe(url);
  });

  it('does not touch sslmode=disable', () => {
    const url = 'postgres://user@host/db?sslmode=disable';
    expect(connectionString(url)).toBe(url);
  });
});

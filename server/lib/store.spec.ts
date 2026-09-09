import { describe, expect, it } from 'vitest';

import { sslFor } from './store.ts';

/**
 * La elección de SSL es la que decide si el proyecto arranca contra una base
 * de datos. Los proveedores en la nube lo exigen; un Postgres local no lo
 * soporta y la conexión falla con "The server does not support SSL".
 */
describe('sslFor', () => {
  it('desactiva SSL contra un Postgres local', () => {
    expect(sslFor('postgres://user@localhost:5432/garaje')).toBe(false);
    expect(sslFor('postgres://user@127.0.0.1:5432/garaje')).toBe(false);
    expect(sslFor('postgres://user:pass@[::1]:5432/garaje')).toBe(false);
  });

  it('respeta sslmode=disable aunque el host sea remoto', () => {
    expect(sslFor('postgres://user@db.ejemplo.com/garaje?sslmode=disable')).toBe(false);
  });

  it('activa SSL contra un proveedor en la nube', () => {
    expect(sslFor('postgres://user:pass@ep-cool.neon.tech/garaje')).toEqual({
      rejectUnauthorized: false,
    });
    expect(sslFor('postgres://user:pass@db.supabase.co:5432/postgres')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('no confunde un host que solo contenga "localhost" en el nombre', () => {
    expect(sslFor('postgres://user@localhost.ejemplo.com/garaje')).toEqual({
      rejectUnauthorized: false,
    });
  });
});

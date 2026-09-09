import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * PostgreSQL efímero para los tests.
 *
 * Desde que hay cuentas, la base de datos no es opcional, así que los tests
 * corren contra un Postgres real en vez de simulacros: se prueban también el
 * esquema, las claves foráneas y los índices únicos, que es donde suelen estar
 * los fallos.
 */

const PORT = 54329;
const BIN = '/usr/lib/postgresql/16/bin';

let dir: string | null = null;

export function startTestDb(): string {
  dir = mkdtempSync(join(tmpdir(), 'garaje-pg-'));

  execFileSync(join(BIN, 'initdb'), ['-D', dir, '-U', 'garaje', '--auth=trust'], {
    stdio: 'ignore',
  });
  execFileSync(
    join(BIN, 'pg_ctl'),
    ['-D', dir, '-o', `-p ${PORT} -h 127.0.0.1 -k ${dir}`, '-l', join(dir, 'log'), 'start'],
    { stdio: 'ignore' }
  );
  execFileSync(
    join(BIN, 'psql'),
    ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'garaje', '-d', 'postgres',
     '-c', 'CREATE DATABASE garaje'],
    { stdio: 'ignore' }
  );

  return `postgres://garaje@127.0.0.1:${PORT}/garaje`;
}

export async function stopTestDb(): Promise<void> {
  if (!dir) return;

  // Cerrar el pool antes de parar el servidor: si no, pg emite un error no
  // capturado al cortarse la conexión de golpe.
  const { closePool } = await import('./store.ts');
  await closePool();

  try {
    execFileSync(join(BIN, 'pg_ctl'), ['-D', dir, 'stop', '-m', 'immediate'], {
      stdio: 'ignore',
    });
  } catch {
    // Si ya estaba parado, no hay nada que hacer.
  }
  rmSync(dir, { recursive: true, force: true });
  dir = null;
}

/** Deja las tablas vacías entre tests, sin recrear el esquema. */
export async function truncateAll(): Promise<void> {
  const { getPool } = await import('./store.ts');
  const pool = await getPool();
  // users basta: el resto cuelga de él por clave foránea.
  await pool.query('TRUNCATE users CASCADE');
}

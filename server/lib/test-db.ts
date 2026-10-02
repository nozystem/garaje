import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 54329;
// PG_BIN apunta a otros binarios de PostgreSQL, p. ej. en macOS.
const BIN = process.env['PG_BIN'] ?? '/usr/lib/postgresql/16/bin';

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
  // Sin psql (algunas distribuciones solo traen el servidor) se usa la base
  // que initdb crea siempre: es igual de nueva y se borra al terminar.
  if (!existsSync(join(BIN, 'psql'))) return `postgres://garaje@127.0.0.1:${PORT}/postgres`;

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

  const { closePool } = await import('./store.ts');
  await closePool();

  try {
    execFileSync(join(BIN, 'pg_ctl'), ['-D', dir, 'stop', '-m', 'immediate'], {
      stdio: 'ignore',
    });
  } catch {
  }
  rmSync(dir, { recursive: true, force: true });
  dir = null;
}

export async function truncateAll(): Promise<void> {
  const { getPool } = await import('./store.ts');
  const pool = await getPool();
  await pool.query('TRUNCATE users CASCADE');
}

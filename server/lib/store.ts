import type {
  GarageSnapshot,
  StoredPlan,
  StoredRecord,
  StoredUser,
  StoredVehicle,
} from './types.ts';

let pool: import('pg').Pool | null = null;
let schemaReady = false;

export function sslFor(url: string): false | { rejectUnauthorized: boolean } {
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(url);
  const wantsNoSsl = /[?&]sslmode=disable/.test(url);
  return isLocal || wantsNoSsl ? false : { rejectUnauthorized: false };
}

export function connectionString(url: string): string {
  return url.replace(/([?&])sslmode=(require|prefer|verify-ca)\b/, '$1sslmode=no-verify');
}

export async function getPool(): Promise<import('pg').Pool> {
  const url = process.env['POSTGRES_URL'];

  if (!url) {
    throw new Error(
      'POSTGRES_URL is missing. The application needs a database for accounts.'
    );
  }

  if (!pool) {
    const { Pool } = await import('pg');
    pool = new Pool({
      connectionString: connectionString(url),
      ssl: sslFor(url),
      max: 1,
    });
  }

  if (!schemaReady) {
    await ensureSchema(pool);
    schemaReady = true;
  }
  return pool;
}

async function ensureSchema(p: import('pg').Pool): Promise<void> {
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- El email identifica la cuenta: se compara siempre en minúsculas, así
    -- que el índice único va sobre su versión normalizada.
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      data JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      vehicle_id TEXT NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
      data JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      vehicle_id TEXT NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
      data JSONB NOT NULL
    );

    CREATE INDEX IF NOT EXISTS vehicles_user ON vehicles (user_id);
    CREATE INDEX IF NOT EXISTS records_user ON records (user_id);
    CREATE INDEX IF NOT EXISTS plans_user ON plans (user_id);
  `);
}

/* --- Usuarios -------------------------------------------------------------- */

export async function createUser(user: StoredUser): Promise<void> {
  const p = await getPool();
  await p.query(
    `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`,
    [user.id, user.email, user.passwordHash, user.name]
  );
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const p = await getPool();
  const result = await p.query(
    `SELECT id, email, password_hash, name, created_at
     FROM users WHERE lower(email) = lower($1)`,
    [email]
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function findUserById(id: string): Promise<StoredUser | null> {
  const p = await getPool();
  const result = await p.query(
    `SELECT id, email, password_hash, name, created_at FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function deleteUser(id: string): Promise<void> {
  const p = await getPool();
  await p.query('DELETE FROM users WHERE id = $1', [id]);
}

function toUser(row: Record<string, unknown>): StoredUser {
  return {
    id: row['id'] as string,
    email: row['email'] as string,
    passwordHash: row['password_hash'] as string,
    name: row['name'] as string,
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}

/* --- Garaje ---------------------------------------------------------------- */

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    schemaReady = false;
  }
}

export type Table = 'vehicles' | 'records' | 'plans';

export async function loadSnapshot(userId: string): Promise<GarageSnapshot> {
  const p = await getPool();

  const [vehicles, records, plans] = await Promise.all([
    p.query('SELECT data FROM vehicles WHERE user_id = $1', [userId]),
    p.query('SELECT data FROM records WHERE user_id = $1', [userId]),
    p.query('SELECT data FROM plans WHERE user_id = $1', [userId]),
  ]);

  return {
    vehicles: vehicles.rows.map((r) => r['data'] as StoredVehicle),
    records: records.rows.map((r) => r['data'] as StoredRecord),
    plans: plans.rows.map((r) => r['data'] as StoredPlan),
  };
}

export async function findById<T>(
  table: Table,
  userId: string,
  id: string
): Promise<T | null> {
  const p = await getPool();
  const result = await p.query(
    `SELECT data FROM ${table} WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return (result.rows[0]?.['data'] as T) ?? null;
}

export async function upsert(
  table: Table,
  userId: string,
  id: string,
  data: unknown,
  vehicleId?: string
): Promise<void> {
  const p = await getPool();

  if (table === 'vehicles') {
    await p.query(
      `INSERT INTO vehicles (id, user_id, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [id, userId, JSON.stringify(data)]
    );
    return;
  }

  await p.query(
    `INSERT INTO ${table} (id, user_id, vehicle_id, data) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [id, userId, vehicleId, JSON.stringify(data)]
  );
}

export async function remove(
  table: Table,
  userId: string,
  id: string
): Promise<boolean> {
  const p = await getPool();
  const result = await p.query(
    `DELETE FROM ${table} WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function removeVehicleCascade(
  userId: string,
  vehicleId: string
): Promise<boolean> {
  return remove('vehicles', userId, vehicleId);
}

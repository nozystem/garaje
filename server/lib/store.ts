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

    -- Ilustraciones compartidas entre todos los usuarios: dos coches con la
    -- misma marca, modelo, generación, carrocería y color reutilizan la misma
    -- imagen en vez de pagar otra.
    CREATE TABLE IF NOT EXISTS illustrations (
      key TEXT PRIMARY KEY,
      image TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Planes de mantenimiento propuestos por la IA, por modelo de coche e
    -- idioma: los intervalos no dependen de los kilómetros de cada uno.
    CREATE TABLE IF NOT EXISTS ai_plans (
      key TEXT PRIMARY KEY,
      tasks JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Una fila por llamada a un servicio externo, para el panel de admin.
    -- Sobrevive al borrado del usuario para que las cifras de gasto cuadren.
    CREATE TABLE IF NOT EXISTS usage_events (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
      service TEXT NOT NULL,
      outcome TEXT NOT NULL,
      cost_usd NUMERIC(10, 5) NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS usage_events_at ON usage_events (at);
    CREATE INDEX IF NOT EXISTS vehicles_user ON vehicles (user_id);
    CREATE INDEX IF NOT EXISTS records_user ON records (user_id);
    CREATE INDEX IF NOT EXISTS plans_user ON plans (user_id);
  `);
}

/* --- Ilustraciones --------------------------------------------------------- */

export async function findIllustration(key: string): Promise<string | null> {
  const p = await getPool();
  const result = await p.query('SELECT image FROM illustrations WHERE key = $1', [key]);
  return (result.rows[0]?.['image'] as string | undefined) ?? null;
}

/** Guarda la ilustración de ese coche, sustituyendo la anterior si la había. */
export async function saveIllustration(key: string, image: string): Promise<void> {
  const p = await getPool();
  await p.query(
    `INSERT INTO illustrations (key, image) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET image = EXCLUDED.image, created_at = now()`,
    [key, image]
  );
}

/* --- Planes de mantenimiento de la IA ------------------------------------- */

export async function findAiPlan<T>(key: string): Promise<T | null> {
  const p = await getPool();
  const result = await p.query('SELECT tasks FROM ai_plans WHERE key = $1', [key]);
  return (result.rows[0]?.['tasks'] as T | undefined) ?? null;
}

export async function saveAiPlan(key: string, tasks: unknown): Promise<void> {
  const p = await getPool();
  await p.query(
    `INSERT INTO ai_plans (key, tasks) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET tasks = EXCLUDED.tasks, created_at = now()`,
    [key, JSON.stringify(tasks)]
  );
}

/* --- Uso de servicios externos -------------------------------------------- */

export type UsageService =
  | 'gemini'
  | 'illustration-cache'
  | 'gemini-plan'
  | 'plan-cache'
  | 'api-ninjas';
export type UsageOutcome = 'ok' | 'error';

export interface UsageEvent {
  userId: string | null;
  service: UsageService;
  outcome: UsageOutcome;
  costUsd?: number;
}

/**
 * Apunta una llamada para el panel de admin. Nunca rompe la petición que la
 * origina: si falla el registro, se pierde esa fila y nada más.
 */
export async function recordUsage(event: UsageEvent): Promise<void> {
  try {
    const p = await getPool();
    await p.query(
      `INSERT INTO usage_events (user_id, service, outcome, cost_usd) VALUES ($1, $2, $3, $4)`,
      [event.userId, event.service, event.outcome, event.costUsd ?? 0]
    );
  } catch (error) {
    console.error('Could not record usage:', error);
  }
}

export interface UsageWindow {
  service: UsageService;
  outcome: UsageOutcome;
  today: number;
  week: number;
  month: number;
  total: number;
  costMonth: number;
  costTotal: number;
}

export interface AdminStats {
  users: { total: number; week: number; month: number };
  vehicles: number;
  storedIllustrations: number;
  usage: UsageWindow[];
  /** Últimos 14 días, del más antiguo al más reciente, sin huecos. */
  daily: { day: string; gemini: number; cacheHits: number; apiNinjas: number }[];
  topMakes: { make: string; count: number }[];
  people: {
    id: string;
    email: string;
    name: string;
    createdAt: string;
    vehicles: number;
    images: number;
    costUsd: number;
    lastActivity: string | null;
  }[];
}

export async function adminStats(): Promise<AdminStats> {
  const p = await getPool();

  const [users, vehicles, illustrations, usage, daily, makes, people] = await Promise.all([
    p.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week,
             count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS month
      FROM users`),
    p.query('SELECT count(*)::int AS n FROM vehicles'),
    p.query('SELECT count(*)::int AS n FROM illustrations'),
    p.query(`
      SELECT service, outcome,
             count(*) FILTER (WHERE at >= date_trunc('day', now()))::int AS today,
             count(*) FILTER (WHERE at > now() - interval '7 days')::int AS week,
             count(*) FILTER (WHERE at > now() - interval '30 days')::int AS month,
             count(*)::int AS total,
             coalesce(sum(cost_usd) FILTER (WHERE at > now() - interval '30 days'), 0)::float AS cost_month,
             coalesce(sum(cost_usd), 0)::float AS cost_total
      FROM usage_events GROUP BY service, outcome`),
    p.query(`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
             count(e.id) FILTER (WHERE e.service = 'gemini' AND e.outcome = 'ok')::int AS gemini,
             count(e.id) FILTER (WHERE e.service = 'illustration-cache')::int AS cache_hits,
             count(e.id) FILTER (WHERE e.service = 'api-ninjas')::int AS api_ninjas
      FROM generate_series(date_trunc('day', now()) - interval '13 days',
                           date_trunc('day', now()), interval '1 day') AS d(day)
      LEFT JOIN usage_events e ON date_trunc('day', e.at) = d.day
      GROUP BY d.day ORDER BY d.day`),
    p.query(`
      SELECT data->>'make' AS make, count(*)::int AS count
      FROM vehicles GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`),
    p.query(`
      SELECT u.id, u.email, u.name, u.created_at,
             (SELECT count(*) FROM vehicles v WHERE v.user_id = u.id)::int AS vehicles,
             count(e.id) FILTER (WHERE e.service = 'gemini' AND e.outcome = 'ok')::int AS images,
             coalesce(sum(e.cost_usd), 0)::float AS cost_usd,
             max(e.at) AS last_activity
      FROM users u LEFT JOIN usage_events e ON e.user_id = u.id
      GROUP BY u.id ORDER BY u.created_at DESC`),
  ]);

  return {
    users: users.rows[0],
    vehicles: vehicles.rows[0]['n'],
    storedIllustrations: illustrations.rows[0]['n'],
    usage: usage.rows.map((r) => ({
      service: r['service'],
      outcome: r['outcome'],
      today: r['today'],
      week: r['week'],
      month: r['month'],
      total: r['total'],
      costMonth: r['cost_month'],
      costTotal: r['cost_total'],
    })),
    daily: daily.rows.map((r) => ({
      day: r['day'],
      gemini: r['gemini'],
      cacheHits: r['cache_hits'],
      apiNinjas: r['api_ninjas'],
    })),
    topMakes: makes.rows,
    people: people.rows.map((r) => ({
      id: r['id'],
      email: r['email'],
      name: r['name'],
      createdAt: (r['created_at'] as Date).toISOString(),
      vehicles: r['vehicles'],
      images: r['images'],
      costUsd: r['cost_usd'],
      lastActivity: r['last_activity'] ? (r['last_activity'] as Date).toISOString() : null,
    })),
  };
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

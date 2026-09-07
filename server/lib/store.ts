import type { GarageSnapshot, StoredPlan, StoredRecord, StoredVehicle } from './types.ts';

/**
 * Almacenamiento del garaje.
 *
 * Usa Postgres cuando hay `POSTGRES_URL`, y memoria cuando no la hay. Lo
 * segundo no es un descuido: permite clonar el repo y levantar la API sin
 * montar una base de datos, que es lo que hace falta para que alguien pruebe
 * el proyecto en dos minutos. En producción la variable es obligatoria y la
 * app lo indica en la interfaz.
 */

const memory: GarageSnapshot = { vehicles: [], records: [], plans: [] };

let pool: import('pg').Pool | null = null;
let schemaReady = false;

export function isPersistent(): boolean {
  return Boolean(process.env['POSTGRES_URL']);
}

async function getPool(): Promise<import('pg').Pool | null> {
  if (!isPersistent()) return null;

  if (!pool) {
    const { Pool } = await import('pg');
    pool = new Pool({
      connectionString: process.env['POSTGRES_URL'],
      ssl: { rejectUnauthorized: false },
      max: 1, // Serverless: una conexión por instancia; el pooler hace el resto.
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
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vehicles_owner ON vehicles (owner_id);
    CREATE INDEX IF NOT EXISTS records_owner ON records (owner_id);
    CREATE INDEX IF NOT EXISTS plans_owner ON plans (owner_id);
  `);
}

export type Table = 'vehicles' | 'records' | 'plans';

export async function loadSnapshot(ownerId: string): Promise<GarageSnapshot> {
  const p = await getPool();

  if (!p) {
    return {
      vehicles: memory.vehicles.filter((v) => v.ownerId === ownerId),
      records: memory.records.filter((r) => r.ownerId === ownerId),
      plans: memory.plans.filter((pl) => pl.ownerId === ownerId),
    };
  }

  const [vehicles, records, plans] = await Promise.all([
    p.query('SELECT data FROM vehicles WHERE owner_id = $1', [ownerId]),
    p.query('SELECT data FROM records WHERE owner_id = $1', [ownerId]),
    p.query('SELECT data FROM plans WHERE owner_id = $1', [ownerId]),
  ]);

  return {
    vehicles: vehicles.rows.map((r) => r['data'] as StoredVehicle),
    records: records.rows.map((r) => r['data'] as StoredRecord),
    plans: plans.rows.map((r) => r['data'] as StoredPlan),
  };
}

export async function findById<T extends { id: string; ownerId: string }>(
  table: Table,
  ownerId: string,
  id: string
): Promise<T | null> {
  const p = await getPool();

  if (!p) {
    const list = memory[table] as unknown as T[];
    return list.find((i) => i.id === id && i.ownerId === ownerId) ?? null;
  }

  const result = await p.query(
    `SELECT data FROM ${table} WHERE id = $1 AND owner_id = $2`,
    [id, ownerId]
  );
  return (result.rows[0]?.['data'] as T) ?? null;
}

export async function upsert(
  table: Table,
  ownerId: string,
  id: string,
  data: { id: string; ownerId: string },
  vehicleId?: string
): Promise<void> {
  const p = await getPool();

  if (!p) {
    const list = memory[table] as unknown as { id: string }[];
    const index = list.findIndex((item) => item.id === id);
    if (index >= 0) {
      list[index] = data;
    } else {
      list.push(data);
    }
    return;
  }

  if (table === 'vehicles') {
    await p.query(
      `INSERT INTO vehicles (id, owner_id, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [id, ownerId, JSON.stringify(data)]
    );
    return;
  }

  await p.query(
    `INSERT INTO ${table} (id, owner_id, vehicle_id, data) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [id, ownerId, vehicleId, JSON.stringify(data)]
  );
}

export async function remove(
  table: Table,
  ownerId: string,
  id: string
): Promise<boolean> {
  const p = await getPool();

  if (!p) {
    const list = memory[table] as unknown as { id: string; ownerId: string }[];
    const index = list.findIndex((i) => i.id === id && i.ownerId === ownerId);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  }

  const result = await p.query(
    `DELETE FROM ${table} WHERE id = $1 AND owner_id = $2`,
    [id, ownerId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Borrar un vehículo se lleva por delante su historial y sus planes. */
export async function removeVehicleCascade(
  ownerId: string,
  vehicleId: string
): Promise<boolean> {
  const p = await getPool();

  if (!p) {
    memory.records = memory.records.filter(
      (r) => !(r.vehicleId === vehicleId && r.ownerId === ownerId)
    );
    memory.plans = memory.plans.filter(
      (pl) => !(pl.vehicleId === vehicleId && pl.ownerId === ownerId)
    );
    return remove('vehicles', ownerId, vehicleId);
  }

  await p.query('DELETE FROM records WHERE vehicle_id = $1 AND owner_id = $2', [vehicleId, ownerId]);
  await p.query('DELETE FROM plans WHERE vehicle_id = $1 AND owner_id = $2', [vehicleId, ownerId]);
  return remove('vehicles', ownerId, vehicleId);
}

/** Solo para los tests: deja el almacén en memoria como estaba. */
export function resetMemory(): void {
  memory.vehicles = [];
  memory.records = [];
  memory.plans = [];
}

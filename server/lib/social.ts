/**
 * La parte social: cada cuenta tiene un perfil público con un @usuario y sus
 * coches, se puede seguir a otros y dar me gusta a sus coches.
 *
 * Todos los perfiles son públicos salvo que su dueño los oculte, y de cada
 * coche solo se enseña su imagen, marca, modelo y año: nunca la matrícula, los
 * kilómetros, el historial, los gastos, el nombre real ni el email.
 */
import { getPool } from './store.ts';
import type { StoredVehicle } from './types.ts';

export interface Profile {
  userId: string;
  username: string;
  hidden: boolean;
}

/** Lo que cualquiera puede ver de un coche ajeno. */
export interface PublicVehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  color?: string;
  /** Enlace a la foto o a la ilustración; null si no tiene ninguna. */
  image: string | null;
  imageKind: 'photo' | 'illustration' | null;
  illustrationVersion?: number;
  owner: { username: string };
  likes: number;
  likedByMe: boolean;
  createdAt: string;
}

export interface PublicProfile {
  username: string;
  vehicles: PublicVehicle[];
  followers: number;
  following: number;
  isFollowing: boolean;
  isMe: boolean;
  hidden: boolean;
}

export const USERNAME = /^[a-z0-9_.]{3,20}$/;

/** Un @usuario de partida a partir del nombre, para quien aún no tiene uno. */
export function suggestUsername(name: string, id: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 14);
  return `${base || 'garaje'}${id.replace(/-/g, '').slice(0, 4)}`;
}

/**
 * El perfil de una cuenta, creándolo si aún no existe: todas las cuentas
 * tienen uno, también las que se registraron antes de que existieran.
 */
export async function ensureProfile(userId: string): Promise<Profile> {
  const p = await getPool();
  const found = await p.query('SELECT user_id, username, hidden FROM profiles WHERE user_id = $1', [userId]);
  if (found.rows[0]) return toProfile(found.rows[0]);

  const user = await p.query('SELECT name FROM users WHERE id = $1', [userId]);
  const username = suggestUsername(user.rows[0]?.['name'] ?? '', userId);
  await p.query(
    `INSERT INTO profiles (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
    [userId, username]
  );
  return ensureProfile(userId);
}

/** Cambia el @usuario o la visibilidad. Lanza 'taken' si el nombre ya es de otro. */
export async function updateProfile(
  userId: string,
  changes: { username?: string; hidden?: boolean }
): Promise<Profile> {
  const current = await ensureProfile(userId);
  const p = await getPool();
  try {
    await p.query('UPDATE profiles SET username = $2, hidden = $3 WHERE user_id = $1', [
      userId,
      changes.username ?? current.username,
      changes.hidden ?? current.hidden,
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('taken');
    throw error;
  }
  return ensureProfile(userId);
}

/** Los coches que se enseñan: de perfiles visibles y que su dueño no ha ocultado. */
const VISIBLE = `
  FROM vehicles v
  JOIN profiles pr ON pr.user_id = v.user_id
  WHERE NOT pr.hidden AND coalesce((v.data->>'socialHidden')::boolean, false) = false`;

/** Las columnas de un coche público; `viewer` es el parámetro ($n) con quien mira, para sus me gusta. */
function publicColumns(viewer: string): string {
  return `v.data, pr.username,
    (SELECT count(*) FROM likes l WHERE l.vehicle_id = v.id)::int AS likes,
    EXISTS (SELECT 1 FROM likes l WHERE l.vehicle_id = v.id AND l.user_id = ${viewer}) AS liked`;
}

function toPublic(row: Record<string, unknown>): PublicVehicle {
  const v = row['data'] as StoredVehicle;
  const imageKind = v.photo ? 'photo' : v.illustration ? 'illustration' : null;
  const version = encodeURIComponent((v.photo ? String(v.photo.length) : v.illustrationAt) ?? '0');
  return {
    id: v.id,
    make: v.make,
    model: v.model,
    year: v.year,
    color: v.color,
    image: imageKind ? `/api/social/vehicles/${v.id}/image?v=${version}` : null,
    imageKind,
    illustrationVersion: v.illustrationVersion,
    owner: { username: row['username'] as string },
    likes: row['likes'] as number,
    likedByMe: row['liked'] as boolean,
    createdAt: v.createdAt,
  };
}

/** El perfil de @usuario visto por `viewer`; null si no existe o está oculto (salvo el propio). */
export async function profileByUsername(viewer: string, username: string): Promise<PublicProfile | null> {
  await ensureProfile(viewer);
  const p = await getPool();
  const found = await p.query(
    'SELECT user_id, username, hidden FROM profiles WHERE lower(username) = lower($1)',
    [username]
  );
  const row = found.rows[0];
  if (!row) return null;
  const profile = toProfile(row);
  const isMe = profile.userId === viewer;
  if (profile.hidden && !isMe) return null;

  // El propio dueño ve todos sus coches en su perfil, también los que oculta.
  const vehicles = await p.query(
    `SELECT ${publicColumns('$2')}
     FROM vehicles v JOIN profiles pr ON pr.user_id = v.user_id
     WHERE v.user_id = $1 ${isMe ? '' : "AND coalesce((v.data->>'socialHidden')::boolean, false) = false"}
     ORDER BY v.data->>'createdAt' DESC`,
    [profile.userId, viewer]
  );
  const counts = await p.query(
    `SELECT
       (SELECT count(*) FROM follows WHERE followee_id = $1)::int AS followers,
       (SELECT count(*) FROM follows WHERE follower_id = $1)::int AS following,
       EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1) AS is_following`,
    [profile.userId, viewer]
  );

  return {
    username: profile.username,
    vehicles: vehicles.rows.map(toPublic),
    followers: counts.rows[0]['followers'],
    following: counts.rows[0]['following'],
    isFollowing: counts.rows[0]['is_following'],
    isMe,
    hidden: profile.hidden,
  };
}

/** Seguir o dejar de seguir a @usuario. Devuelve false si no existe o es uno mismo. */
export async function setFollow(viewer: string, username: string, follow: boolean): Promise<boolean> {
  const p = await getPool();
  const found = await p.query(
    'SELECT user_id, hidden FROM profiles WHERE lower(username) = lower($1)',
    [username]
  );
  const target = found.rows[0];
  if (!target || target['user_id'] === viewer || (follow && target['hidden'])) return false;

  if (follow) {
    await p.query(
      'INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [viewer, target['user_id']]
    );
  } else {
    await p.query('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [viewer, target['user_id']]);
  }
  return true;
}

/** Buscar perfiles visibles por @usuario. */
export async function searchProfiles(
  viewer: string,
  query: string
): Promise<{ username: string; vehicles: number; isFollowing: boolean }[]> {
  await ensureProfile(viewer);
  const p = await getPool();
  const pattern = `%${query.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const result = await p.query(
    `SELECT pr.username,
       (SELECT count(*) FROM vehicles v WHERE v.user_id = pr.user_id
          AND coalesce((v.data->>'socialHidden')::boolean, false) = false)::int AS vehicles,
       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = pr.user_id) AS is_following
     FROM profiles pr
     WHERE NOT pr.hidden AND pr.user_id <> $1 AND lower(pr.username) LIKE $2
     ORDER BY length(pr.username), pr.username
     LIMIT 30`,
    [viewer, pattern]
  );
  return result.rows.map((r) => ({
    username: r['username'],
    vehicles: r['vehicles'],
    isFollowing: r['is_following'],
  }));
}

/** Los coches más recientes de todos, o de una marca. */
export async function explore(viewer: string, make?: string): Promise<PublicVehicle[]> {
  await ensureProfile(viewer);
  const p = await getPool();
  const result = await p.query(
    `SELECT ${publicColumns('$2')} ${VISIBLE}
       AND ($1::text IS NULL OR lower(v.data->>'make') = lower($1))
     ORDER BY v.data->>'createdAt' DESC LIMIT 60`,
    [make || null, viewer]
  );
  return result.rows.map(toPublic);
}

/** Las marcas que hay entre los coches visibles, de la más común a la menos. */
export async function popularMakes(): Promise<{ make: string; count: number }[]> {
  const p = await getPool();
  const result = await p.query(
    `SELECT v.data->>'make' AS make, count(*)::int AS count ${VISIBLE}
     GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 15`
  );
  return result.rows as { make: string; count: number }[];
}

/** Los coches de la gente a la que sigues, del más reciente al más antiguo. */
export async function feed(viewer: string): Promise<PublicVehicle[]> {
  const p = await getPool();
  const result = await p.query(
    `SELECT ${publicColumns('$1')} ${VISIBLE}
       AND v.user_id IN (SELECT followee_id FROM follows WHERE follower_id = $1)
     ORDER BY v.data->>'createdAt' DESC LIMIT 60`,
    [viewer]
  );
  return result.rows.map(toPublic);
}

/** Un coche visible para cualquiera, o null. */
export async function visibleVehicle(vehicleId: string): Promise<StoredVehicle | null> {
  const p = await getPool();
  const result = await p.query(`SELECT v.data ${VISIBLE} AND v.id = $1`, [vehicleId]);
  return (result.rows[0]?.['data'] as StoredVehicle | undefined) ?? null;
}

export async function setLike(viewer: string, vehicleId: string, like: boolean): Promise<{ likes: number } | null> {
  if (like && !(await visibleVehicle(vehicleId))) return null;
  const p = await getPool();
  if (like) {
    await p.query('INSERT INTO likes (user_id, vehicle_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [viewer, vehicleId]);
  } else {
    await p.query('DELETE FROM likes WHERE user_id = $1 AND vehicle_id = $2', [viewer, vehicleId]);
  }
  const count = await p.query('SELECT count(*)::int AS n FROM likes WHERE vehicle_id = $1', [vehicleId]);
  return { likes: count.rows[0]['n'] };
}

function toProfile(row: Record<string, unknown>): Profile {
  return { userId: row['user_id'] as string, username: row['username'] as string, hidden: row['hidden'] as boolean };
}

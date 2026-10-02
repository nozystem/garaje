/**
 * Planes: quedadas que un usuario pone en el mapa (una ruta, una
 * concentración, un café con coches) con su sitio, día y hora, y a las que
 * los demás se apuntan.
 *
 * Como los perfiles, son públicos: se ven con el @usuario de quien los crea,
 * nunca con su nombre real o su email, y no salen los de perfiles ocultos.
 */
import { newId } from './http.ts';
import { ensureProfile } from './social.ts';
import { getPool } from './store.ts';

export interface MeetupInput {
  title: string;
  description?: string;
  startsAt: string;
  latitude: number;
  longitude: number;
  place?: string;
}

export interface PublicMeetup {
  id: string;
  title: string;
  description?: string;
  startsAt: string;
  latitude: number;
  longitude: number;
  place?: string;
  host: { username: string };
  attendees: number;
  /** Los primeros que se han apuntado, para enseñarlos en la ficha. */
  attendeeNames: string[];
  joinedByMe: boolean;
  isMine: boolean;
  createdAt: string;
}

type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Un plan puede tener lugar desde dentro de una hora hasta dentro de un año. */
const MAX_AHEAD_MS = 366 * 86_400_000;

export function validateMeetup(input: unknown, now = Date.now()): Validation<MeetupInput> {
  const body = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;

  const title = text(body['title'], 80);
  const startsAt = typeof body['startsAt'] === 'string' ? new Date(body['startsAt']) : null;
  const latitude = typeof body['latitude'] === 'number' ? body['latitude'] : NaN;
  const longitude = typeof body['longitude'] === 'number' ? body['longitude'] : NaN;

  if (!title) errors.push('Title is required');
  if (!startsAt || Number.isNaN(startsAt.getTime())) errors.push('Invalid date');
  else if (startsAt.getTime() < now - 3_600_000 || startsAt.getTime() > now + MAX_AHEAD_MS) {
    errors.push('The plan must be within the next year');
  }
  if (!(latitude >= -90 && latitude <= 90) || !(longitude >= -180 && longitude <= 180)) {
    errors.push('Invalid location');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title: title as string,
      description: text(body['description'], 1000) ?? undefined,
      startsAt: (startsAt as Date).toISOString(),
      latitude,
      longitude,
      place: text(body['place'], 120) ?? undefined,
    },
  };
}

const COLUMNS = (viewer: string) => `
  m.id, m.data, pr.username AS host,
  (SELECT count(*) FROM meetup_attendees a WHERE a.meetup_id = m.id)::int AS attendees,
  ARRAY(SELECT p2.username FROM meetup_attendees a JOIN profiles p2 ON p2.user_id = a.user_id
        WHERE a.meetup_id = m.id AND NOT p2.hidden ORDER BY a.created_at LIMIT 8) AS attendee_names,
  EXISTS (SELECT 1 FROM meetup_attendees a WHERE a.meetup_id = m.id AND a.user_id = ${viewer}) AS joined,
  m.user_id = ${viewer} AS mine`;

function toPublic(row: Record<string, unknown>): PublicMeetup {
  const data = row['data'] as MeetupInput & { createdAt: string };
  return {
    id: row['id'] as string,
    title: data.title,
    description: data.description,
    startsAt: data.startsAt,
    latitude: data.latitude,
    longitude: data.longitude,
    place: data.place,
    host: { username: row['host'] as string },
    attendees: row['attendees'] as number,
    attendeeNames: row['attendee_names'] as string[],
    joinedByMe: row['joined'] as boolean,
    isMine: row['mine'] as boolean,
    createdAt: data.createdAt,
  };
}

/** Los planes que no han pasado, del más cercano en el tiempo al más lejano. */
export async function listMeetups(viewer: string): Promise<PublicMeetup[]> {
  await ensureProfile(viewer);
  const p = await getPool();
  const result = await p.query(
    `SELECT ${COLUMNS('$1')}
     FROM meetups m JOIN profiles pr ON pr.user_id = m.user_id
     WHERE (NOT pr.hidden OR m.user_id = $1) AND m.starts_at > now() - interval '3 hours'
     ORDER BY m.starts_at LIMIT 300`,
    [viewer]
  );
  return result.rows.map(toPublic);
}

export async function findMeetup(viewer: string, id: string): Promise<PublicMeetup | null> {
  const p = await getPool();
  const result = await p.query(
    `SELECT ${COLUMNS('$2')}
     FROM meetups m JOIN profiles pr ON pr.user_id = m.user_id
     WHERE m.id = $1 AND (NOT pr.hidden OR m.user_id = $2)`,
    [id, viewer]
  );
  return result.rows[0] ? toPublic(result.rows[0]) : null;
}

export async function createMeetup(viewer: string, input: MeetupInput): Promise<PublicMeetup> {
  await ensureProfile(viewer);
  const p = await getPool();
  const id = newId();
  await p.query(
    `INSERT INTO meetups (id, user_id, starts_at, data) VALUES ($1, $2, $3, $4)`,
    [id, viewer, input.startsAt, JSON.stringify({ ...input, createdAt: new Date().toISOString() })]
  );
  // Quien lo organiza va.
  await p.query('INSERT INTO meetup_attendees (meetup_id, user_id) VALUES ($1, $2)', [id, viewer]);
  return (await findMeetup(viewer, id)) as PublicMeetup;
}

/** Solo quien lo creó. Devuelve false si no existe o no es suyo. */
export async function deleteMeetup(viewer: string, id: string): Promise<boolean> {
  const p = await getPool();
  const result = await p.query('DELETE FROM meetups WHERE id = $1 AND user_id = $2', [id, viewer]);
  return (result.rowCount ?? 0) > 0;
}

/** Apuntarse o desapuntarse. Null si el plan no existe o no se ve. */
export async function setAttendance(viewer: string, id: string, going: boolean): Promise<PublicMeetup | null> {
  if (!(await findMeetup(viewer, id))) return null;
  await ensureProfile(viewer);
  const p = await getPool();
  if (going) {
    await p.query(
      'INSERT INTO meetup_attendees (meetup_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, viewer]
    );
  } else {
    await p.query('DELETE FROM meetup_attendees WHERE meetup_id = $1 AND user_id = $2', [id, viewer]);
  }
  return findMeetup(viewer, id);
}

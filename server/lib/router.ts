import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  badRequest,
  json,
  methodNotAllowed,
  newId,
  notFound,
  readJson,
  unauthorized,
} from './http.ts';
import {
  handleLogin,
  handleLogout,
  handleMe,
  handleRegister,
  isAdmin,
  userIdFrom,
} from './auth.ts';
import {
  buildQuery as buildFacetQuery,
  carFacets,
  generationsFor,
  isConfigured as isFacetsConfigured,
} from './car-facets.ts';
import {
  COST_PER_IMAGE_USD,
  ILLUSTRATION_VERSION,
  generateIllustration,
  illustrationKey,
  isConfigured as isIllustrationConfigured,
} from './car-illustration.ts';
import { loadCatalog, makesForType } from './catalog.ts';
import {
  deleteUser,
  findById,
  adminStats,
  findIllustration,
  findUserById,
  getPool,
  loadSnapshot,
  remove,
  removeVehicleCascade,
  recordUsage,
  saveIllustration,
  upsert,
} from './store.ts';
import type { StoredPlan, StoredRecord, StoredVehicle } from './types.ts';
import { validatePlan, validateRecord, validateVehicle } from './validate.ts';

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  if (path === '/api/health') {
    try {
      const pool = await getPool();
      await pool.query('SELECT 1');
      json(res, 200, { status: 'ok', database: true, time: new Date().toISOString() });
    } catch (error) {
      json(res, 503, {
        status: 'error',
        database: false,
        error: (error as Error).message,
      });
    }
    return;
  }

  if (path === '/api/auth/register') {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);
    return handleRegister(req, res);
  }

  if (path === '/api/auth/login') {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);
    return handleLogin(req, res);
  }

  if (path === '/api/auth/logout') {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);
    return handleLogout(res);
  }

  if (path === '/api/auth/me') {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handleMe(req, res);
  }

  if (path === '/api/catalog') {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);

    const type = url.searchParams.get('type');
    const makes = type ? makesForType(type) : loadCatalog();

    res.setHeader('Cache-Control', 'public, max-age=86400');
    json(res, 200, {
      count: makes.length,
      modelCount: makes.reduce((n, m) => n + m.models.length, 0),
      makes,
    });
    return;
  }

  if (!path.startsWith('/api/')) {
    notFound(res);
    return;
  }

  const userId = userIdFrom(req);
  if (!userId) {
    unauthorized(res);
    return;
  }

  // Ilustración ya guardada de un coche igual, para enseñarla en el formulario
  // antes de crear el vehículo. Solo lee la caché: nunca genera ni gasta.
  if (path === '/api/illustrations') {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
    const q = url.searchParams;
    const image = await findIllustration(
      illustrationKey({
        make: q.get('make') ?? '',
        model: q.get('model') ?? '',
        year: Number(q.get('year')) || 0,
        generation: q.get('generation') ?? undefined,
        body: q.get('body') ?? undefined,
      })
    );
    return sendIllustration(res, { illustration: image ?? undefined }, 'private, max-age=3600');
  }

  if (path === '/api/admin/stats') {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
    const user = await findUserById(userId);
    if (!user || !isAdmin(user.email)) {
      json(res, 403, { error: 'Admins only' });
      return;
    }
    json(res, 200, await adminStats());
    return;
  }

  // Se esperan antes de responder: en Vercel la función puede congelarse en
  // cuanto sale la respuesta y un registro pendiente se perdería.
  const pendingUsage: Promise<void>[] = [];
  const trackNinjas = (ok: boolean) =>
    pendingUsage.push(recordUsage({ userId, service: 'api-ninjas', outcome: ok ? 'ok' : 'error' }));

  // Detrás del login: cada consulta gasta cuota de API Ninjas.
  if (path === '/api/catalog/generations') {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
    if (!isFacetsConfigured()) {
      json(res, 503, { error: 'Car data is not configured' });
      return;
    }

    const make = url.searchParams.get('make') ?? '';
    const model = url.searchParams.get('model') ?? '';
    if (!make.trim() || !model.trim()) return badRequest(res, ['Make and model are required']);

    const generations = await generationsFor(make, model, trackNinjas);
    await Promise.all(pendingUsage);
    if (!generations) {
      json(res, 502, { error: 'Car data is not available right now' });
      return;
    }

    res.setHeader('Cache-Control', 'private, max-age=86400');
    json(res, 200, { generations });
    return;
  }

  if (path === '/api/catalog/facets') {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
    if (!isFacetsConfigured()) {
      json(res, 503, { error: 'Car data is not configured' });
      return;
    }

    const query = buildFacetQuery(url.searchParams);
    if (!query) return badRequest(res, ['Invalid facet query']);

    const facets = await carFacets(query, trackNinjas);
    await Promise.all(pendingUsage);
    if (!facets) {
      json(res, 502, { error: 'Car data is not available right now' });
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=86400');
    json(res, 200, { facets });
    return;
  }

  let body: unknown = {};
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    try {
      body = await readJson(req);
    } catch (error) {
      badRequest(res, [(error as Error).message]);
      return;
    }
  }

  const segments = path.split('/').filter(Boolean).slice(1);
  const [resource, id, action] = segments;

  switch (resource) {
    case 'garage': {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);

      const snapshot = await loadSnapshot(userId);
      json(res, 200, { ...snapshot, vehicles: snapshot.vehicles.map(forClient) });
      return;
    }

    case 'account':
      if (method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);
      await deleteUser(userId);
      res.setHeader('Set-Cookie', 'garaje_session=; Path=/; HttpOnly; Max-Age=0');
      json(res, 200, { deleted: true });
      return;

    case 'vehicles':
      return handleVehicles(res, method, userId, id, action, body);

    case 'records':
      return handleRecords(res, method, userId, id, body);

    case 'plans':
      return handlePlans(res, method, userId, id, body);

    default:
      notFound(res);
  }
}

async function handleVehicles(
  res: ServerResponse,
  method: string,
  userId: string,
  id: string | undefined,
  action: string | undefined,
  body: unknown
): Promise<void> {
  if (!id) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);

    const parsed = validateVehicle(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const now = new Date().toISOString();
    const vehicle: StoredVehicle = {
      ...parsed.value,
      id: newId(),
      userId,
      mileageUpdatedAt: now,
      createdAt: now,
    };

    await upsert('vehicles', userId, vehicle.id, vehicle);
    json(res, 201, forClient(vehicle));
    return;
  }

  const existing = await findById<StoredVehicle>('vehicles', userId, id);
  if (!existing) return notFound(res);

  if (action === 'illustration' && method === 'GET') {
    return sendIllustration(res, existing);
  }

  if (action === 'illustration') {
    if (method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);

    // `fresh` pide una distinta a la guardada ("New illustration"); sin él
    // se reutiliza la de cualquier coche igual y no se paga otra imagen.
    const fresh = (body as { fresh?: unknown } | null)?.fresh === true;
    const key = illustrationKey(existing);
    let illustration = fresh ? null : await findIllustration(key);

    if (illustration) {
      await recordUsage({ userId, service: 'illustration-cache', outcome: 'ok' });
    } else {
      if (!isIllustrationConfigured()) {
        json(res, 503, { error: 'Illustrations are not configured' });
        return;
      }

      illustration = await generateIllustration(existing);
      await recordUsage({
        userId,
        service: 'gemini',
        outcome: illustration ? 'ok' : 'error',
        costUsd: illustration ? COST_PER_IMAGE_USD : 0,
      });
      if (!illustration) {
        json(res, 502, { error: 'The illustration could not be created' });
        return;
      }
      await saveIllustration(key, illustration);
    }

    const updated: StoredVehicle = {
      ...existing,
      illustration,
      illustrationAt: new Date().toISOString(),
      illustrationVersion: ILLUSTRATION_VERSION,
    };
    await upsert('vehicles', userId, id, updated);
    json(res, 200, forClient(updated));
    return;
  }
  if (action) return notFound(res);

  if (method === 'GET') {
    json(res, 200, forClient(existing));
    return;
  }

  if (method === 'PUT') {
    const parsed = validateVehicle(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const identityChanged =
      parsed.value.make !== existing.make ||
      parsed.value.model !== existing.model ||
      parsed.value.year !== existing.year ||
      parsed.value.type !== existing.type;

    // La ilustración muestra el coche y su carrocería; el color no, porque la
    // app la recolorea al mostrarla.
    const looksChanged =
      identityChanged ||
      parsed.value.generation !== existing.generation ||
      parsed.value.body !== existing.body;

    const updated: StoredVehicle = {
      ...existing,
      ...parsed.value,
      illustration: looksChanged ? undefined : existing.illustration,
      illustrationAt: looksChanged ? undefined : existing.illustrationAt,
      illustrationVersion: looksChanged ? undefined : existing.illustrationVersion,
      mileageUpdatedAt:
        parsed.value.mileage !== existing.mileage
          ? new Date().toISOString()
          : existing.mileageUpdatedAt,
    };

    await upsert('vehicles', userId, id, updated);
    json(res, 200, forClient(updated));
    return;
  }

  if (method === 'DELETE') {
    await removeVehicleCascade(userId, id);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
}

async function handleRecords(
  res: ServerResponse,
  method: string,
  userId: string,
  id: string | undefined,
  body: unknown
): Promise<void> {
  if (!id) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);

    const parsed = validateRecord(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const vehicle = await findById<StoredVehicle>('vehicles', userId, parsed.value.vehicleId);
    if (!vehicle) return badRequest(res, ['El vehículo no existe']);

    const record: StoredRecord = {
      ...parsed.value,
      id: newId(),
      userId,
      createdAt: new Date().toISOString(),
    };

    await upsert('records', userId, record.id, record, record.vehicleId);

    if (record.mileage > vehicle.mileage) {
      await upsert('vehicles', userId, vehicle.id, {
        ...vehicle,
        mileage: record.mileage,
        mileageUpdatedAt: record.date,
      });
    }

    if (record.planId) {
      const plan = await findById<StoredPlan>('plans', userId, record.planId);
      if (plan) {
        await upsert('plans', userId, plan.id, {
          ...plan,
          lastServiceMileage: record.mileage,
          lastServiceDate: record.date,
        }, plan.vehicleId);
      }
    }

    json(res, 201, record);
    return;
  }

  if (method === 'DELETE') {
    const deleted = await remove('records', userId, id);
    if (!deleted) return notFound(res);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['POST', 'DELETE']);
}

async function handlePlans(
  res: ServerResponse,
  method: string,
  userId: string,
  id: string | undefined,
  body: unknown
): Promise<void> {
  if (!id) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);

    const parsed = validatePlan(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const vehicle = await findById<StoredVehicle>('vehicles', userId, parsed.value.vehicleId);
    if (!vehicle) return badRequest(res, ['El vehículo no existe']);

    const plan: StoredPlan = {
      ...parsed.value,
      id: newId(),
      userId,
      createdAt: new Date().toISOString(),
    };

    await upsert('plans', userId, plan.id, plan, plan.vehicleId);
    json(res, 201, plan);
    return;
  }

  const existing = await findById<StoredPlan>('plans', userId, id);
  if (!existing) return notFound(res);

  if (method === 'PUT') {
    const parsed = validatePlan(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const updated: StoredPlan = { ...existing, ...parsed.value };
    await upsert('plans', userId, id, updated, updated.vehicleId);
    json(res, 200, updated);
    return;
  }

  if (method === 'DELETE') {
    await remove('plans', userId, id);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['PUT', 'DELETE']);
}

/**
 * Las ilustraciones pesan cientos de KB cada una: dentro del JSON del garaje
 * lo harían crecer con cada coche hasta pasar el límite de respuesta de
 * Vercel. El cliente recibe un enlace versionado y el navegador descarga y
 * guarda en caché cada imagen por separado.
 */
function forClient(vehicle: StoredVehicle): StoredVehicle {
  if (!vehicle.illustration) return vehicle;
  const version = encodeURIComponent(vehicle.illustrationAt ?? '0');
  return {
    ...vehicle,
    illustration: `/api/vehicles/${vehicle.id}/illustration?v=${version}`,
  };
}

/**
 * Por defecto la URL lleva versión y cambia con cada ilustración nueva, así
 * que puede cachearse para siempre.
 */
function sendIllustration(
  res: ServerResponse,
  vehicle: Pick<StoredVehicle, 'illustration'>,
  cacheControl = 'private, max-age=31536000, immutable'
): void {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(vehicle.illustration ?? '');
  if (!match) return notFound(res);

  res.statusCode = 200;
  res.setHeader('Content-Type', match[1]);
  res.setHeader('Cache-Control', cacheControl);
  res.end(Buffer.from(match[2], 'base64'));
}

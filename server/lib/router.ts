import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  badRequest,
  json,
  methodNotAllowed,
  newId,
  notFound,
  ownerFrom,
  readJson,
  unauthorized,
} from './http.ts';
import { loadCatalog, makesForType } from './catalog.ts';
import {
  findById,
  isPersistent,
  loadSnapshot,
  remove,
  removeVehicleCascade,
  upsert,
} from './store.ts';
import type { StoredPlan, StoredRecord, StoredVehicle } from './types.ts';
import { validatePlan, validateRecord, validateVehicle } from './validate.ts';

/**
 * Enrutado de la API.
 *
 * Se resuelve a mano en vez de con Express: son ocho rutas y así el servidor
 * no arrastra dependencias ni middleware que no se usa. La firma es la de
 * Node, de modo que el mismo código corre en local y como función en Vercel.
 */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  // Comprobación de vida: no necesita garaje y sirve para monitorización.
  if (path === '/api/health') {
    json(res, 200, {
      status: 'ok',
      persistent: isPersistent(),
      time: new Date().toISOString(),
    });
    return;
  }

  // El catálogo es público y de solo lectura: no necesita garaje.
  if (path === '/api/catalog') {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);

    const type = url.searchParams.get('type');
    const makes = type ? makesForType(type) : loadCatalog();

    // Cambia pocas veces al año: se puede cachear con tranquilidad.
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

  const ownerId = ownerFrom(req);
  if (!ownerId) {
    unauthorized(res);
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

  const segments = path.split('/').filter(Boolean).slice(1); // quita 'api'
  const [resource, id] = segments;

  switch (resource) {
    case 'garage':
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      json(res, 200, await loadSnapshot(ownerId));
      return;

    case 'vehicles':
      return handleVehicles(res, method, ownerId, id, body);

    case 'records':
      return handleRecords(res, method, ownerId, id, body);

    case 'plans':
      return handlePlans(res, method, ownerId, id, body);

    default:
      notFound(res);
  }
}

async function handleVehicles(
  res: ServerResponse,
  method: string,
  ownerId: string,
  id: string | undefined,
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
      ownerId,
      mileageUpdatedAt: now,
      createdAt: now,
    };

    await upsert('vehicles', ownerId, vehicle.id, vehicle);
    json(res, 201, vehicle);
    return;
  }

  const existing = await findById<StoredVehicle>('vehicles', ownerId, id);
  if (!existing) return notFound(res);

  if (method === 'GET') {
    json(res, 200, existing);
    return;
  }

  if (method === 'PUT') {
    const parsed = validateVehicle(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const updated: StoredVehicle = {
      ...existing,
      ...parsed.value,
      // El sello solo cambia si el kilometraje realmente se movió.
      mileageUpdatedAt:
        parsed.value.mileage !== existing.mileage
          ? new Date().toISOString()
          : existing.mileageUpdatedAt,
    };

    await upsert('vehicles', ownerId, id, updated);
    json(res, 200, updated);
    return;
  }

  if (method === 'DELETE') {
    await removeVehicleCascade(ownerId, id);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
}

async function handleRecords(
  res: ServerResponse,
  method: string,
  ownerId: string,
  id: string | undefined,
  body: unknown
): Promise<void> {
  if (!id) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);

    const parsed = validateRecord(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const vehicle = await findById<StoredVehicle>('vehicles', ownerId, parsed.value.vehicleId);
    if (!vehicle) return badRequest(res, ['El vehículo no existe']);

    const record: StoredRecord = {
      ...parsed.value,
      id: newId(),
      ownerId,
      createdAt: new Date().toISOString(),
    };

    await upsert('records', ownerId, record.id, record, record.vehicleId);

    // Anotar un mantenimiento posterior al último dato conocido también
    // actualiza el cuentakilómetros: evita tener que corregirlo a mano.
    if (record.mileage > vehicle.mileage) {
      await upsert('vehicles', ownerId, vehicle.id, {
        ...vehicle,
        mileage: record.mileage,
        mileageUpdatedAt: record.date,
      });
    }

    // Si el registro cierra una tarea planificada, la tarea se reprograma.
    if (record.planId) {
      const plan = await findById<StoredPlan>('plans', ownerId, record.planId);
      if (plan) {
        await upsert('plans', ownerId, plan.id, {
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
    const deleted = await remove('records', ownerId, id);
    if (!deleted) return notFound(res);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['POST', 'DELETE']);
}

async function handlePlans(
  res: ServerResponse,
  method: string,
  ownerId: string,
  id: string | undefined,
  body: unknown
): Promise<void> {
  if (!id) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);

    const parsed = validatePlan(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const vehicle = await findById<StoredVehicle>('vehicles', ownerId, parsed.value.vehicleId);
    if (!vehicle) return badRequest(res, ['El vehículo no existe']);

    const plan: StoredPlan = {
      ...parsed.value,
      id: newId(),
      ownerId,
      createdAt: new Date().toISOString(),
    };

    await upsert('plans', ownerId, plan.id, plan, plan.vehicleId);
    json(res, 201, plan);
    return;
  }

  const existing = await findById<StoredPlan>('plans', ownerId, id);
  if (!existing) return notFound(res);

  if (method === 'PUT') {
    const parsed = validatePlan(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const updated: StoredPlan = { ...existing, ...parsed.value };
    await upsert('plans', ownerId, id, updated, updated.vehicleId);
    json(res, 200, updated);
    return;
  }

  if (method === 'DELETE') {
    await remove('plans', ownerId, id);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['PUT', 'DELETE']);
}

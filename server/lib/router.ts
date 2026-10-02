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
  isConfigured as isPlanConfigured,
  planKey,
  suggestPlan,
  type PlanLang,
  type SuggestedTask,
} from './maintenance-plan.ts';
import { isConfigured as isScanConfigured, scanReceipt } from './receipt-scan.ts';
import {
  USERNAME,
  ensureProfile,
  explore,
  feed,
  popularMakes,
  profileByUsername,
  searchProfiles,
  setFollow,
  setLike,
  updateProfile,
  visibleVehicle,
} from './social.ts';
import {
  accessVehicle,
  addMember,
  deleteUser,
  findById,
  findChild,
  adminStats,
  findAiPlan,
  findIllustration,
  findUserByEmail,
  findUserById,
  getPool,
  listMembers,
  loadSnapshot,
  remove,
  removeById,
  removeMember,
  removeVehicleCascade,
  recordUsage,
  saveAiPlan,
  saveIllustration,
  upsert,
} from './store.ts';
import type {
  DocumentKind,
  MemberRole,
  StoredDocument,
  StoredFuel,
  StoredPlan,
  StoredRecord,
  StoredVehicle,
  StoredWorkshop,
} from './types.ts';
import {
  validateDocument,
  validateFuel,
  validatePlan,
  validateRecord,
  validateVehicle,
  validateWorkshop,
} from './validate.ts';

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
  const [resource, id, action, extra] = segments;

  switch (resource) {
    case 'garage': {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);

      const snapshot = await loadSnapshot(userId);
      json(res, 200, {
        ...snapshot,
        vehicles: snapshot.vehicles.map(forClient),
        records: snapshot.records.map((r) => withPhotoLink(r, 'records')),
        documents: snapshot.documents.map((d) => withPhotoLink(d, 'documents')),
      });
      return;
    }

    case 'account':
      if (method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);
      await deleteUser(userId);
      res.setHeader('Set-Cookie', 'garaje_session=; Path=/; HttpOnly; Max-Age=0');
      json(res, 200, { deleted: true });
      return;

    case 'vehicles':
      return handleVehicles(res, method, userId, id, action, extra, body);

    case 'records':
      if (id === 'scan') return handleScan(res, method, userId, body);
      return handleRecords(res, method, userId, id, action, body);

    case 'plans':
      return handlePlans(res, method, userId, id, body);

    case 'documents':
      return handleDocuments(res, method, userId, id, action, body);

    case 'fuel':
      return handleFuel(res, method, userId, id, body);

    case 'workshops':
      return handleWorkshops(res, method, userId, id, body);

    case 'social':
      return handleSocial(res, method, userId, segments.slice(1), url.searchParams, body);

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
  extra: string | undefined,
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

  // El dueño y aquellos con quien lo comparte ven y editan el coche; solo el
  // dueño lo borra o decide con quién compartirlo.
  const access = await accessVehicle(userId, id);
  if (!access) return notFound(res);
  const { vehicle: existing, role } = access;
  const ownerId = existing.userId;

  if (action === 'members') return handleMembers(res, method, userId, existing, role, extra, body);

  if (action === 'maintenance-plan') {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);
    const lang: PlanLang = (body as { lang?: unknown } | null)?.lang === 'es' ? 'es' : 'en';
    const key = planKey(existing, lang);

    // Un plan por modelo e idioma: el mismo coche no vuelve a costar nada.
    const cached = await findAiPlan<SuggestedTask[]>(key);
    if (cached) {
      await recordUsage({ userId, service: 'plan-cache', outcome: 'ok' });
      json(res, 200, { tasks: cached });
      return;
    }
    if (!isPlanConfigured()) {
      json(res, 503, { error: 'Maintenance plans are not configured' });
      return;
    }

    const plan = await suggestPlan(existing, lang);
    await recordUsage({
      userId,
      service: 'gemini-plan',
      outcome: plan ? 'ok' : 'error',
      costUsd: plan?.costUsd ?? 0,
    });
    if (!plan) {
      json(res, 502, { error: 'The maintenance plan could not be created' });
      return;
    }
    await saveAiPlan(key, plan.tasks);
    json(res, 200, { tasks: plan.tasks });
    return;
  }

  if (action === 'illustration' && method === 'GET') {
    return sendIllustration(res, existing);
  }

  if (action === 'illustration') {
    if (method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);

    // Siempre se reutiliza la de un coche igual si existe: no hay forma de
    // pedir otra distinta, para que nadie genere (y pague) imágenes en bucle.
    const key = illustrationKey(existing);
    let illustration = await findIllustration(key);

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
    await upsert('vehicles', ownerId, id, updated);
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
    // app la recolorea al mostrarla. Rellenar la generación o la carrocería
    // cuando estaban vacías no cambia el coche, solo lo concreta: un León de
    // 2001 al que se le pone "Mk1" sigue siendo el mismo dibujo.
    const reshaped = (before: string | undefined, after: string | undefined) =>
      Boolean(before) && before !== after;
    const looksChanged =
      identityChanged ||
      reshaped(existing.generation, parsed.value.generation) ||
      reshaped(existing.body, parsed.value.body);

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

    await upsert('vehicles', ownerId, id, updated);

    // Si se concretó la generación o la carrocería, la misma ilustración vale
    // también para quien busque el coche así descrito.
    const keyChanged = illustrationKey(existing) !== illustrationKey(updated);
    if (!looksChanged && keyChanged && updated.illustration &&
        (updated.illustrationVersion ?? 0) >= ILLUSTRATION_VERSION) {
      await saveIllustration(illustrationKey(updated), updated.illustration);
    }

    json(res, 200, forClient(updated));
    return;
  }

  if (method === 'DELETE') {
    if (role !== 'owner') {
      json(res, 403, { error: 'Only the owner can delete the vehicle' });
      return;
    }
    await removeVehicleCascade(userId, id);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
}

/**
 * Con quién se comparte un coche. Lo ven todos los que lo comparten; solo el
 * dueño invita o quita a alguien, y cada uno puede dejar de compartirlo.
 */
async function handleMembers(
  res: ServerResponse,
  method: string,
  userId: string,
  vehicle: StoredVehicle,
  role: MemberRole,
  memberId: string | undefined,
  body: unknown
): Promise<void> {
  if (!memberId && method === 'GET') {
    json(res, 200, { members: await listMembers(vehicle) });
    return;
  }

  if (!memberId && method === 'POST') {
    if (role !== 'owner') {
      json(res, 403, { error: 'Only the owner can share the vehicle' });
      return;
    }
    const email = (body as { email?: unknown } | null)?.email;
    if (typeof email !== 'string' || !email.trim()) return badRequest(res, ['Invalid email address']);

    const invited = await findUserByEmail(email.trim());
    if (!invited) {
      json(res, 404, { error: 'There is no account with that email' });
      return;
    }
    if (invited.id === vehicle.userId) return badRequest(res, ['That account already owns the vehicle']);

    await addMember(vehicle.id, invited.id);
    json(res, 201, { members: await listMembers(vehicle) });
    return;
  }

  if (memberId && method === 'DELETE') {
    if (role !== 'owner' && memberId !== userId) {
      json(res, 403, { error: 'Only the owner can remove someone' });
      return;
    }
    const removed = await removeMember(vehicle.id, memberId);
    if (!removed) return notFound(res);
    json(res, 200, { members: await listMembers(vehicle) });
    return;
  }

  methodNotAllowed(res, memberId ? ['DELETE'] : ['GET', 'POST']);
}

/** Lee un ticket con la IA; no guarda nada: el usuario revisa y luego guarda. */
async function handleScan(res: ServerResponse, method: string, userId: string, body: unknown): Promise<void> {
  if (method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { image, lang } = (body ?? {}) as { image?: unknown; lang?: unknown };
  const errors: string[] = [];
  const photo = typeof image === 'string' ? image : '';
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) {
    errors.push('The photo format is not supported');
  }
  if (errors.length) return badRequest(res, errors);
  if (!isScanConfigured()) {
    json(res, 503, { error: 'Receipt scanning is not configured' });
    return;
  }

  const scanned = await scanReceipt(photo, lang === 'es' ? 'es' : 'en');
  await recordUsage({
    userId,
    service: 'gemini-scan',
    outcome: scanned ? 'ok' : 'error',
    costUsd: scanned?.costUsd ?? 0,
  });
  if (!scanned) {
    json(res, 502, { error: 'The receipt could not be read' });
    return;
  }
  json(res, 200, { receipt: scanned.receipt });
}

/** Sube los kilómetros del coche si lo apuntado es más reciente. */
async function raiseOdometer(vehicle: StoredVehicle, mileage: number, date: string): Promise<void> {
  if (mileage <= vehicle.mileage) return;
  await upsert('vehicles', vehicle.userId, vehicle.id, {
    ...vehicle,
    mileage,
    mileageUpdatedAt: date,
  });
}

async function handleRecords(
  res: ServerResponse,
  method: string,
  userId: string,
  id: string | undefined,
  action: string | undefined,
  body: unknown
): Promise<void> {
  if (!id) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);

    const parsed = validateRecord(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const access = await accessVehicle(userId, parsed.value.vehicleId);
    if (!access) return badRequest(res, ['The vehicle does not exist']);
    const { vehicle } = access;

    const record: StoredRecord = {
      ...parsed.value,
      id: newId(),
      userId: vehicle.userId,
      createdBy: userId !== vehicle.userId ? userId : undefined,
      createdAt: new Date().toISOString(),
    };

    await upsert('records', vehicle.userId, record.id, record, record.vehicleId);
    await raiseOdometer(vehicle, record.mileage, record.date);

    if (record.planId) {
      const found = await findChild<StoredPlan>('plans', userId, record.planId);
      if (found && found.item.vehicleId === vehicle.id) {
        await upsert('plans', vehicle.userId, found.item.id, {
          ...found.item,
          lastServiceMileage: record.mileage,
          lastServiceDate: record.date,
        }, vehicle.id);
      }
    }

    json(res, 201, withPhotoLink(record, 'records'));
    return;
  }

  const found = await findChild<StoredRecord>('records', userId, id);
  if (!found) return notFound(res);

  if (action === 'photo') {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
    return sendDataUrl(res, found.item.photo);
  }
  if (action) return notFound(res);

  if (method === 'DELETE') {
    await removeById('records', id);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['DELETE']);
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

    const access = await accessVehicle(userId, parsed.value.vehicleId);
    if (!access) return badRequest(res, ['The vehicle does not exist']);

    const plan: StoredPlan = {
      ...parsed.value,
      id: newId(),
      userId: access.vehicle.userId,
      createdAt: new Date().toISOString(),
    };

    await upsert('plans', plan.userId, plan.id, plan, plan.vehicleId);
    json(res, 201, plan);
    return;
  }

  const found = await findChild<StoredPlan>('plans', userId, id);
  if (!found) return notFound(res);
  const existing = found.item;

  if (method === 'PUT') {
    const parsed = validatePlan(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);
    // Una tarea no se cambia de coche.
    if (parsed.value.vehicleId !== existing.vehicleId) return badRequest(res, ['The vehicle does not exist']);

    const updated: StoredPlan = { ...existing, ...parsed.value };
    await upsert('plans', existing.userId, id, updated, updated.vehicleId);
    json(res, 200, updated);
    return;
  }

  if (method === 'DELETE') {
    await removeById('plans', id);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['PUT', 'DELETE']);
}

async function handleDocuments(
  res: ServerResponse,
  method: string,
  userId: string,
  id: string | undefined,
  action: string | undefined,
  body: unknown
): Promise<void> {
  if (!id) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);

    const parsed = validateDocument(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const access = await accessVehicle(userId, parsed.value.vehicleId);
    if (!access) return badRequest(res, ['The vehicle does not exist']);

    const document: StoredDocument = {
      ...parsed.value,
      kind: parsed.value.kind as DocumentKind,
      id: newId(),
      userId: access.vehicle.userId,
      createdAt: new Date().toISOString(),
    };

    await upsert('documents', document.userId, document.id, document, document.vehicleId);
    json(res, 201, withPhotoLink(document, 'documents'));
    return;
  }

  const found = await findChild<StoredDocument>('documents', userId, id);
  if (!found) return notFound(res);
  const existing = found.item;

  if (action === 'photo') {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
    return sendDataUrl(res, existing.photo);
  }
  if (action) return notFound(res);

  if (method === 'PUT') {
    const parsed = validateDocument(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);
    if (parsed.value.vehicleId !== existing.vehicleId) return badRequest(res, ['The vehicle does not exist']);

    // La foto no viaja de vuelta en cada edición: si no llega, se conserva.
    const keepPhoto = (body as { keepPhoto?: unknown } | null)?.keepPhoto === true;
    const updated: StoredDocument = {
      ...existing,
      ...parsed.value,
      kind: parsed.value.kind as DocumentKind,
      photo: parsed.value.photo ?? (keepPhoto ? existing.photo : undefined),
    };
    await upsert('documents', existing.userId, id, updated, updated.vehicleId);
    json(res, 200, withPhotoLink(updated, 'documents'));
    return;
  }

  if (method === 'DELETE') {
    await removeById('documents', id);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['PUT', 'DELETE']);
}

async function handleFuel(
  res: ServerResponse,
  method: string,
  userId: string,
  id: string | undefined,
  body: unknown
): Promise<void> {
  if (!id) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);

    const parsed = validateFuel(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const access = await accessVehicle(userId, parsed.value.vehicleId);
    if (!access) return badRequest(res, ['The vehicle does not exist']);
    const { vehicle } = access;

    const fuel: StoredFuel = {
      ...parsed.value,
      id: newId(),
      userId: vehicle.userId,
      createdBy: userId !== vehicle.userId ? userId : undefined,
      createdAt: new Date().toISOString(),
    };

    await upsert('fuel_logs', vehicle.userId, fuel.id, fuel, fuel.vehicleId);
    await raiseOdometer(vehicle, fuel.mileage, fuel.date);
    json(res, 201, fuel);
    return;
  }

  const found = await findChild<StoredFuel>('fuel_logs', userId, id);
  if (!found) return notFound(res);

  if (method === 'DELETE') {
    await removeById('fuel_logs', id);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['DELETE']);
}

/** Los talleres son de cada persona: no se comparten con el coche. */
async function handleWorkshops(
  res: ServerResponse,
  method: string,
  userId: string,
  id: string | undefined,
  body: unknown
): Promise<void> {
  if (!id) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);

    const parsed = validateWorkshop(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const workshop: StoredWorkshop = {
      ...parsed.value,
      id: newId(),
      userId,
      createdAt: new Date().toISOString(),
    };
    await upsert('workshops', userId, workshop.id, workshop);
    json(res, 201, workshop);
    return;
  }

  const existing = await findById<StoredWorkshop>('workshops', userId, id);
  if (!existing) return notFound(res);

  if (method === 'PUT') {
    const parsed = validateWorkshop(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);

    const updated: StoredWorkshop = { ...existing, ...parsed.value };
    await upsert('workshops', userId, id, updated);
    json(res, 200, updated);
    return;
  }

  if (method === 'DELETE') {
    await remove('workshops', userId, id);
    json(res, 200, { deleted: id });
    return;
  }

  methodNotAllowed(res, ['PUT', 'DELETE']);
}

/**
 * La parte social (ver social.ts):
 *   GET/PUT  /api/social/me                       tu perfil: @usuario y si se oculta
 *   PUT      /api/social/vehicles/:id             mostrar u ocultar un coche tuyo
 *   GET      /api/social/vehicles/:id/image       la foto o ilustración de un coche visible
 *   POST/DELETE /api/social/vehicles/:id/like
 *   GET      /api/social/profiles/:username
 *   POST/DELETE /api/social/profiles/:username/follow
 *   GET      /api/social/search?q=   /explore?make=   /feed   /makes
 */
async function handleSocial(
  res: ServerResponse,
  method: string,
  userId: string,
  [section, id, action]: string[],
  params: URLSearchParams,
  body: unknown
): Promise<void> {
  const data = (body ?? {}) as Record<string, unknown>;

  switch (section) {
    case 'me': {
      if (method === 'GET') {
        const { username, hidden } = await ensureProfile(userId);
        json(res, 200, { profile: { username, hidden } });
        return;
      }
      if (method !== 'PUT') return methodNotAllowed(res, ['GET', 'PUT']);

      const username = typeof data['username'] === 'string' ? data['username'].trim().toLowerCase() : undefined;
      if (username !== undefined && !USERNAME.test(username)) {
        return badRequest(res, ['Usernames have 3 to 20 letters, numbers, dots or underscores']);
      }
      const hidden = typeof data['hidden'] === 'boolean' ? data['hidden'] : undefined;
      try {
        const profile = await updateProfile(userId, { username, hidden });
        json(res, 200, { profile: { username: profile.username, hidden: profile.hidden } });
      } catch (error) {
        if ((error as Error).message !== 'taken') throw error;
        json(res, 409, { error: 'That username is taken' });
      }
      return;
    }

    case 'vehicles': {
      if (!id) return notFound(res);

      if (action === 'image') {
        if (method !== 'GET') return methodNotAllowed(res, ['GET']);
        const vehicle = (await visibleVehicle(id)) ?? (await accessVehicle(userId, id))?.vehicle;
        if (!vehicle) return notFound(res);
        return sendDataUrl(res, vehicle.photo ?? vehicle.illustration);
      }

      if (action === 'like') {
        if (method !== 'POST' && method !== 'DELETE') return methodNotAllowed(res, ['POST', 'DELETE']);
        const result = await setLike(userId, id, method === 'POST');
        if (!result) return notFound(res);
        json(res, 200, result);
        return;
      }
      if (action) return notFound(res);

      if (method !== 'PUT') return methodNotAllowed(res, ['PUT']);
      const access = await accessVehicle(userId, id);
      if (!access) return notFound(res);
      if (access.role !== 'owner') {
        json(res, 403, { error: 'Only the owner can do that' });
        return;
      }
      const updated: StoredVehicle = { ...access.vehicle, socialHidden: data['hidden'] === true };
      await upsert('vehicles', userId, id, updated);
      json(res, 200, forClient(updated));
      return;
    }

    case 'profiles': {
      if (!id) return notFound(res);
      if (action === 'follow') {
        if (method !== 'POST' && method !== 'DELETE') return methodNotAllowed(res, ['POST', 'DELETE']);
        if (!(await setFollow(userId, id, method === 'POST'))) return notFound(res);
      } else if (action) {
        return notFound(res);
      } else if (method !== 'GET') {
        return methodNotAllowed(res, ['GET']);
      }
      const profile = await profileByUsername(userId, id);
      if (!profile) return notFound(res);
      json(res, 200, { profile });
      return;
    }

    case 'search':
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      json(res, 200, { profiles: await searchProfiles(userId, (params.get('q') ?? '').trim().slice(0, 40)) });
      return;

    case 'explore':
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      json(res, 200, { vehicles: await explore(userId, params.get('make')?.trim() || undefined) });
      return;

    case 'feed':
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      json(res, 200, { vehicles: await feed(userId) });
      return;

    case 'makes':
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      json(res, 200, { makes: await popularMakes() });
      return;

    default:
      notFound(res);
  }
}

/**
 * Las fotos de tickets y documentos, como las ilustraciones, no van dentro
 * del JSON del garaje: viajan como enlace y se descargan aparte.
 */
function withPhotoLink<T extends { id: string; photo?: string; createdAt: string }>(
  item: T,
  kind: 'records' | 'documents'
): T {
  if (!item.photo) return item;
  return { ...item, photo: `/api/${kind}/${item.id}/photo?v=${item.photo.length}` };
}

/** Sirve una imagen guardada como data URL. */
function sendDataUrl(res: ServerResponse, dataUrl: string | undefined): void {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl ?? '');
  if (!match) return notFound(res);

  res.statusCode = 200;
  res.setHeader('Content-Type', match[1]);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.end(Buffer.from(match[2], 'base64'));
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

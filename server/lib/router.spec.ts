import { createServer, Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { handleRequest } from './router.ts';
import { startTestDb, stopTestDb, truncateAll } from './test-db.ts';

let server: Server;
let base: string;

beforeAll(async () => {
  process.env['POSTGRES_URL'] = startTestDb();
  process.env['AUTH_SECRET'] = 'a-test-secret-that-is-long-enough-1234567890';

  server = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error(error);
      res.statusCode = 500;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await stopTestDb();
});

beforeEach(() => truncateAll());

function client() {
  let cookie = '';

  return {
    get cookie() {
      return cookie;
    },
    async fetch(path: string, init: RequestInit = {}) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string>),
      };
      if (cookie) headers['Cookie'] = cookie;

      const res = await fetch(base + path, { ...init, headers });

      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return res;
    },
    async register(email = 'ana@example.com', password = 'a-long-enough-password') {
      return this.fetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name: 'Ana' }),
      });
    },
  };
}

const CAR = {
  nickname: 'The car',
  make: 'SEAT',
  model: 'León',
  year: 2018,
  type: 'car',
  fuel: 'diesel',
  mileage: 100_000,
};

describe('registration', () => {
  it('creates the account and returns a session', async () => {
    const c = client();
    const res = await c.register();

    expect(res.status).toBe(201);
    const { user } = await res.json();
    expect(user.email).toBe('ana@example.com');
    expect(user.name).toBe('Ana');
    expect(c.cookie).toContain('garaje_session=');
  });

  it('never returns the password hash', async () => {
    const { user } = await (await client().register()).json();
    expect(JSON.stringify(user)).not.toContain('scrypt');
    expect(user.passwordHash).toBeUndefined();
  });

  it('marks the cookie as httpOnly', async () => {
    const res = await client().register();
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rejects an email that is already registered', async () => {
    await client().register('ana@example.com');
    const res = await client().register('ana@example.com');
    expect(res.status).toBe(409);
  });

  it('treats the email as case-insensitive', async () => {
    await client().register('ana@example.com');
    const res = await client().register('ANA@Example.com');
    expect(res.status).toBe(409);
  });

  it('rejects invalid emails and passwords', async () => {
    const c = client();
    expect((await c.register('not-an-email')).status).toBe(400);
    expect((await c.register('b@example.com', 'short')).status).toBe(400);
  });
});

describe('sign in', () => {
  it('accepts valid credentials', async () => {
    await client().register('ana@example.com', 'a-long-enough-password');

    const c = client();
    const res = await c.fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ana@example.com', password: 'a-long-enough-password' }),
    });

    expect(res.status).toBe(200);
    expect(c.cookie).toContain('garaje_session=');
  });

  it('rejects a wrong password', async () => {
    await client().register('ana@example.com', 'a-long-enough-password');

    const res = await client().fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ana@example.com', password: 'a-different-password' }),
    });
    expect(res.status).toBe(401);
  });

  it('does not reveal whether an email is registered', async () => {
    await client().register('ana@example.com', 'a-long-enough-password');

    const existe = await client().fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ana@example.com', password: 'wrong-password-1' }),
    });
    const noExiste = await client().fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password-1' }),
    });

    expect(existe.status).toBe(noExiste.status);
    expect(await existe.json()).toEqual(await noExiste.json());
  });
});

describe('session', () => {
  it('/api/auth/me returns the current user', async () => {
    const c = client();
    await c.register();

    const { user } = await (await c.fetch('/api/auth/me')).json();
    expect(user.email).toBe('ana@example.com');
  });

  it('/api/auth/me returns 401 without a session', async () => {
    expect((await fetch(base + '/api/auth/me')).status).toBe(401);
  });

  it('signing out clears the cookie', async () => {
    const c = client();
    await c.register();

    const res = await c.fetch('/api/auth/logout', { method: 'POST' });
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('rejects a cookie with an invalid signature', async () => {
    const res = await fetch(base + '/api/garage', {
      headers: { Cookie: 'garaje_session=abc.def.ghi' },
    });
    expect(res.status).toBe(401);
  });
});

describe('the garage requires a session', () => {
  it('returns 401 when unauthenticated', async () => {
    expect((await fetch(base + '/api/garage')).status).toBe(401);
    expect(
      (await fetch(base + '/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(CAR),
      })).status
    ).toBe(401);
  });
});

describe('isolation between accounts', () => {
  it('each account only sees its own vehicles', async () => {
    const ana = client();
    await ana.register('ana@example.com');
    await ana.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) });

    const luis = client();
    await luis.register('luis@example.com');

    expect((await (await luis.fetch('/api/garage')).json()).vehicles).toHaveLength(0);
    expect((await (await ana.fetch('/api/garage')).json()).vehicles).toHaveLength(1);
  });

  it('an account cannot read or delete another account\'s vehicle', async () => {
    const ana = client();
    await ana.register('ana@example.com');
    const car = await (
      await ana.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const luis = client();
    await luis.register('luis@example.com');

    expect((await luis.fetch(`/api/vehicles/${car.id}`)).status).toBe(404);
    expect(
      (await luis.fetch(`/api/vehicles/${car.id}`, { method: 'DELETE' })).status
    ).toBe(404);

    expect((await (await ana.fetch('/api/garage')).json()).vehicles).toHaveLength(1);
  });

  it('cannot add a record to another account\'s vehicle', async () => {
    const ana = client();
    await ana.register('ana@example.com');
    const car = await (
      await ana.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const luis = client();
    await luis.register('luis@example.com');

    const res = await luis.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Intruder',
        date: '2026-01-01', mileage: 1000,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('vehicles', () => {
  it('creates and returns the vehicle', async () => {
    const c = client();
    await c.register();

    const res = await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) });
    expect(res.status).toBe(201);

    const vehicle = await res.json();
    expect(vehicle.id).toBeTruthy();
    expect(vehicle.nickname).toBe('The car');
  });

  it('collects every validation error', async () => {
    const c = client();
    await c.register();

    const res = await c.fetch('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify({ nickname: '', year: 1800, type: 'barco' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).details.length).toBeGreaterThan(2);
  });

  it('only updates the mileage timestamp when mileage changes', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const igual = await (
      await c.fetch(`/api/vehicles/${car.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...CAR, nickname: 'Another name' }),
      })
    ).json();
    expect(igual.mileageUpdatedAt).toBe(car.mileageUpdatedAt);

    const distinto = await (
      await c.fetch(`/api/vehicles/${car.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...CAR, mileage: 105_000 }),
      })
    ).json();
    expect(distinto.mileageUpdatedAt).not.toBe(car.mileageUpdatedAt);
  });

  it('deleting a vehicle removes its history and plans', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    await c.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Oil',
        date: '2026-01-01', mileage: 99_000,
      }),
    });
    await c.fetch('/api/plans', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Oil',
        intervalKm: 15_000, active: true,
      }),
    });

    await c.fetch(`/api/vehicles/${car.id}`, { method: 'DELETE' });

    const snapshot = await (await c.fetch('/api/garage')).json();
    expect(snapshot.vehicles).toHaveLength(0);
    expect(snapshot.records).toHaveLength(0);
    expect(snapshot.plans).toHaveLength(0);
  });
});

describe('maintenance records', () => {
  async function withCar() {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();
    return { c, car };
  }

  it('raises the odometer when the record is more recent', async () => {
    const { c, car } = await withCar();

    await c.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Oil',
        date: '2026-06-01', mileage: 103_000,
      }),
    });

    const snapshot = await (await c.fetch('/api/garage')).json();
    expect(snapshot.vehicles[0].mileage).toBe(103_000);
  });

  it('never lowers the odometer with an older record', async () => {
    const { c, car } = await withCar();

    await c.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Older',
        date: '2025-01-01', mileage: 80_000,
      }),
    });

    const snapshot = await (await c.fetch('/api/garage')).json();
    expect(snapshot.vehicles[0].mileage).toBe(100_000);
  });

  it('completing a scheduled task reschedules it', async () => {
    const { c, car } = await withCar();
    const plan = await (
      await c.fetch('/api/plans', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: car.id, category: 'oil', title: 'Oil',
          intervalKm: 15_000, lastServiceMileage: 90_000, active: true,
        }),
      })
    ).json();

    await c.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Done',
        date: '2026-06-01', mileage: 105_000, planId: plan.id,
      }),
    });

    const snapshot = await (await c.fetch('/api/garage')).json();
    expect(snapshot.plans[0].lastServiceMileage).toBe(105_000);
  });

  it('rejects a record for a vehicle that does not exist', async () => {
    const c = client();
    await c.register();

    const res = await c.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: 'does-not-exist', category: 'oil', title: 'X',
        date: '2026-01-01', mileage: 1000,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('maintenance plans', () => {
  it('requires at least one interval', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const res = await c.fetch('/api/plans', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'No interval', active: true,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).details.join(' ')).toContain('interval');
  });

  it('accepts a time-only plan, such as the annual inspection', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const res = await c.fetch('/api/plans', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'inspection', title: 'ITV',
        intervalMonths: 12, active: true,
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe('deleting the account', () => {
  it('removes all of its content', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();
    await c.fetch('/api/plans', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Oil',
        intervalKm: 15_000, active: true,
      }),
    });

    const res = await c.fetch('/api/account', { method: 'DELETE' });
    expect(res.status).toBe(200);

    expect((await c.fetch('/api/auth/me')).status).toBe(401);
  });
});

describe('catalog', () => {
  it('is public: no session required', async () => {
    const res = await fetch(base + '/api/catalog');
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBeGreaterThan(80);
  });

  it('filters by vehicle type', async () => {
    const res = await fetch(base + '/api/catalog?type=motorcycle');
    const names = (await res.json()).makes.map((m: { name: string }) => m.name);
    expect(names).toContain('Yamaha');
    expect(names).not.toContain('SEAT');
  });
});

describe('errors', () => {
  it('404 on an unknown route', async () => {
    const c = client();
    await c.register();
    expect((await c.fetch('/api/nada')).status).toBe(404);
  });

  it('405 with the Allow header', async () => {
    const c = client();
    await c.register();
    const res = await c.fetch('/api/garage', { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('GET');
  });

  it('rejects malformed JSON', async () => {
    const c = client();
    await c.register();
    const res = await c.fetch('/api/vehicles', { method: 'POST', body: '{roto' });
    expect(res.status).toBe(400);
  });
});

describe('vehicle illustration', () => {
  it('creates the vehicle without an illustration', async () => {
    const c = client();
    await c.register();

    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    expect(car.illustration).toBeUndefined();
  });

  it('answers 503 when the image service is not configured', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const res = await c.fetch(`/api/vehicles/${car.id}/illustration`, {
      method: 'POST',
      body: '{}',
    });

    expect(res.status).toBe(503);
  });

  it('answers 404 for the image of a vehicle without one', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const res = await c.fetch(`/api/vehicles/${car.id}/illustration`);

    expect(res.status).toBe(404);
  });
});

describe('admin stats', () => {
  it('refuses anyone who is not in ADMIN_EMAILS', async () => {
    const c = client();
    await c.register();

    const res = await c.fetch('/api/admin/stats');

    expect(res.status).toBe(403);
  });
});

const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('a tiny receipt').toString('base64');

async function withCar(c: ReturnType<typeof client>) {
  const res = await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) });
  return (await res.json()) as { id: string; mileage: number };
}

describe('shared vehicles', () => {
  async function ownerAndGuest() {
    const owner = client();
    await owner.register('owner@example.com');
    const guest = client();
    await guest.register('guest@example.com');
    const car = await withCar(owner);
    return { owner, guest, car };
  }

  it('the owner shares a vehicle by email and the guest sees it in their garage', async () => {
    const { owner, guest, car } = await ownerAndGuest();

    const shared = await owner.fetch(`/api/vehicles/${car.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ email: 'GUEST@example.com' }),
    });
    expect(shared.status).toBe(201);
    const { members } = await shared.json();
    expect(members.map((m: { email: string; role: string }) => [m.email, m.role])).toEqual([
      ['owner@example.com', 'owner'],
      ['guest@example.com', 'member'],
    ]);

    const garage = await (await guest.fetch('/api/garage')).json();
    expect(garage.vehicles).toHaveLength(1);
    expect(garage.vehicles[0].sharedBy).toEqual({ ownerName: 'Ana', ownerEmail: 'owner@example.com' });
  });

  it('answers 404 when there is no account with that email', async () => {
    const { owner, car } = await ownerAndGuest();
    const res = await owner.fetch(`/api/vehicles/${car.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });
    expect(res.status).toBe(404);
  });

  it('a guest logs records that stay with the vehicle, but cannot delete it or share it', async () => {
    const { owner, guest, car } = await ownerAndGuest();
    await owner.fetch(`/api/vehicles/${car.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ email: 'guest@example.com' }),
    });

    const record = await guest.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Oil', date: '2026-05-01', mileage: 101_000,
      }),
    });
    expect(record.status).toBe(201);

    const ownerGarage = await (await owner.fetch('/api/garage')).json();
    expect(ownerGarage.records).toHaveLength(1);
    expect(ownerGarage.vehicles[0].mileage).toBe(101_000);

    expect((await guest.fetch(`/api/vehicles/${car.id}`, { method: 'DELETE' })).status).toBe(403);
    expect(
      (await guest.fetch(`/api/vehicles/${car.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: 'owner@example.com' }),
      })).status
    ).toBe(403);

    // Si el invitado se va, lo que apuntó se queda con el coche.
    const me = await (await guest.fetch('/api/auth/me')).json();
    expect((await guest.fetch(`/api/vehicles/${car.id}/members/${me.user.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await (await guest.fetch('/api/garage')).json()).vehicles).toHaveLength(0);
    expect((await (await owner.fetch('/api/garage')).json()).records).toHaveLength(1);
  });

  it('someone the vehicle is not shared with sees nothing of it', async () => {
    const { guest, car } = await ownerAndGuest();
    expect((await guest.fetch(`/api/vehicles/${car.id}`)).status).toBe(404);
    expect((await guest.fetch(`/api/vehicles/${car.id}/members`)).status).toBe(404);
    const res = await guest.fetch('/api/fuel', {
      method: 'POST',
      body: JSON.stringify({ vehicleId: car.id, date: '2026-05-01', mileage: 1, liters: 40, cost: 60 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('documents', () => {
  it('creates, updates and deletes a document, serving its photo apart', async () => {
    const c = client();
    await c.register();
    const car = await withCar(c);

    const created = await c.fetch('/api/documents', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, kind: 'insurance', title: 'Seguro', provider: 'Mapfre',
        expiresAt: '2027-01-31', cost: 320, photo: PHOTO,
      }),
    });
    expect(created.status).toBe(201);
    const doc = await created.json();
    expect(doc.photo).toMatch(new RegExp(`^/api/documents/${doc.id}/photo`));

    const photo = await c.fetch(`/api/documents/${doc.id}/photo`);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await photo.arrayBuffer()).toString()).toBe('a tiny receipt');

    const updated = await c.fetch(`/api/documents/${doc.id}`, {
      method: 'PUT',
      body: JSON.stringify({ vehicleId: car.id, kind: 'insurance', title: 'Seguro a todo riesgo', keepPhoto: true }),
    });
    expect((await updated.json()).photo).toBeTruthy();

    const garage = await (await c.fetch('/api/garage')).json();
    expect(garage.documents.map((d: { title: string }) => d.title)).toEqual(['Seguro a todo riesgo']);

    expect((await c.fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('rejects an unknown kind of document', async () => {
    const c = client();
    await c.register();
    const car = await withCar(c);
    const res = await c.fetch('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ vehicleId: car.id, kind: 'passport', title: 'X' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('fuel', () => {
  it('logs a refuel and raises the odometer', async () => {
    const c = client();
    await c.register();
    const car = await withCar(c);

    const res = await c.fetch('/api/fuel', {
      method: 'POST',
      body: JSON.stringify({ vehicleId: car.id, date: '2026-05-01', mileage: 100_650, liters: 42.5, cost: 66.3 }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).fullTank).toBe(true);

    const garage = await (await c.fetch('/api/garage')).json();
    expect(garage.fuel).toHaveLength(1);
    expect(garage.vehicles[0].mileage).toBe(100_650);
  });
});

describe('workshops', () => {
  it('belong to each account', async () => {
    const a = client();
    await a.register('a@example.com');
    const b = client();
    await b.register('b@example.com');

    const res = await a.fetch('/api/workshops', {
      method: 'POST',
      body: JSON.stringify({ name: 'Talleres Pepe', phone: '+34 600 000 000' }),
    });
    expect(res.status).toBe(201);
    const workshop = await res.json();

    expect((await (await a.fetch('/api/garage')).json()).workshops).toHaveLength(1);
    expect((await (await b.fetch('/api/garage')).json()).workshops).toHaveLength(0);
    expect((await b.fetch(`/api/workshops/${workshop.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('rejects a phone that is not a phone', async () => {
    const c = client();
    await c.register();
    const res = await c.fetch('/api/workshops', {
      method: 'POST',
      body: JSON.stringify({ name: 'X', phone: 'call me' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('records with receipts', () => {
  it('keeps the parts and serves the receipt photo apart', async () => {
    const c = client();
    await c.register();
    const car = await withCar(c);

    const res = await c.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'brakes', title: 'Pads', date: '2026-05-01',
        mileage: 100_000, parts: 'Front pads', photo: PHOTO,
      }),
    });
    const record = await res.json();
    expect(record.parts).toBe('Front pads');
    expect(record.photo).toMatch(/^\/api\/records\/.+\/photo/);

    const photo = await c.fetch(record.photo);
    expect(photo.status).toBe(200);
  });

  it('answers 503 to a scan when the AI is not configured', async () => {
    const c = client();
    await c.register();
    delete process.env['GEMINI_API_KEY'];
    const res = await c.fetch('/api/records/scan', { method: 'POST', body: JSON.stringify({ image: PHOTO }) });
    expect(res.status).toBe(503);
  });

  it('rejects a scan of something that is not an image', async () => {
    const c = client();
    await c.register();
    const res = await c.fetch('/api/records/scan', { method: 'POST', body: JSON.stringify({ image: 'hello' }) });
    expect(res.status).toBe(400);
  });
});

describe('social', () => {
  async function person(email: string, name = 'Ana') {
    const c = client();
    await c.fetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'a-long-enough-password', name }),
    });
    const { profile } = await (await c.fetch('/api/social/me')).json();
    return { c, username: profile.username as string };
  }

  it('gives every account a username taken from its name', async () => {
    const { username } = await person('ana@example.com', 'Ana Pérez');
    expect(username).toMatch(/^anaperez[0-9a-f]{4}$/);
  });

  it('lets you pick a username, but not one that is taken or malformed', async () => {
    const a = await person('a@example.com');
    const b = await person('b@example.com');

    const ok = await a.c.fetch('/api/social/me', { method: 'PUT', body: JSON.stringify({ username: 'El_Garaje' }) });
    expect((await ok.json()).profile.username).toBe('el_garaje');

    const taken = await b.c.fetch('/api/social/me', { method: 'PUT', body: JSON.stringify({ username: 'el_garaje' }) });
    expect(taken.status).toBe(409);
    const bad = await b.c.fetch('/api/social/me', { method: 'PUT', body: JSON.stringify({ username: 'a b' }) });
    expect(bad.status).toBe(400);
  });

  it('shows the make, model, year and image of a vehicle, and nothing private', async () => {
    const owner = await person('owner@example.com');
    const viewer = await person('viewer@example.com');
    await owner.c.fetch('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify({ ...CAR, plate: '1234 ABC', notes: 'secret', photo: PHOTO }),
    });

    const res = await viewer.c.fetch(`/api/social/profiles/${owner.username}`);
    const { profile } = await res.json();
    expect(profile.vehicles).toHaveLength(1);
    const car = profile.vehicles[0];
    expect(car).toMatchObject({ make: 'SEAT', model: 'León', year: 2018, imageKind: 'photo', likes: 0 });
    const text = JSON.stringify(profile);
    for (const secret of ['1234 ABC', 'secret', '100000', 'owner@example.com', 'The car', 'Ana']) {
      expect(text).not.toContain(secret);
    }

    const image = await viewer.c.fetch(car.image);
    expect(image.status).toBe(200);
  });

  it('follows people, shows their vehicles in the feed and counts likes', async () => {
    const owner = await person('owner@example.com');
    const viewer = await person('viewer@example.com');
    await owner.c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) });

    expect((await (await viewer.c.fetch('/api/social/feed')).json()).vehicles).toHaveLength(0);
    const followed = await viewer.c.fetch(`/api/social/profiles/${owner.username}/follow`, { method: 'POST' });
    expect((await followed.json()).profile).toMatchObject({ isFollowing: true, followers: 1 });

    const { vehicles } = await (await viewer.c.fetch('/api/social/feed')).json();
    expect(vehicles).toHaveLength(1);

    const liked = await viewer.c.fetch(`/api/social/vehicles/${vehicles[0].id}/like`, { method: 'POST' });
    expect(await liked.json()).toEqual({ likes: 1 });
    const again = await (await viewer.c.fetch('/api/social/explore?make=seat')).json();
    expect(again.vehicles[0]).toMatchObject({ likes: 1, likedByMe: true });
  });

  it('finds people by username', async () => {
    const owner = await person('owner@example.com', 'Marta');
    const viewer = await person('viewer@example.com');
    const { profiles } = await (await viewer.c.fetch('/api/social/search?q=mart')).json();
    expect(profiles.map((p: { username: string }) => p.username)).toEqual([owner.username]);
  });

  it('a hidden profile disappears from everywhere, and so does a hidden vehicle', async () => {
    const owner = await person('owner@example.com', 'Marta');
    const viewer = await person('viewer@example.com');
    const car = await withCar(owner.c);
    await owner.c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify({ ...CAR, model: 'Ibiza' }) });

    // Un coche oculto no sale, el otro sí.
    await owner.c.fetch(`/api/social/vehicles/${car.id}`, { method: 'PUT', body: JSON.stringify({ hidden: true }) });
    const explored = await (await viewer.c.fetch('/api/social/explore')).json();
    expect(explored.vehicles.map((v: { model: string }) => v.model)).toEqual(['Ibiza']);
    expect((await viewer.c.fetch(`/api/social/vehicles/${car.id}/like`, { method: 'POST' })).status).toBe(404);
    // Su dueño lo sigue viendo en su perfil.
    const own = await (await owner.c.fetch(`/api/social/profiles/${owner.username}`)).json();
    expect(own.profile.vehicles).toHaveLength(2);

    // Un perfil oculto no sale en ningún sitio.
    await owner.c.fetch('/api/social/me', { method: 'PUT', body: JSON.stringify({ hidden: true }) });
    expect((await viewer.c.fetch(`/api/social/profiles/${owner.username}`)).status).toBe(404);
    expect((await (await viewer.c.fetch('/api/social/explore')).json()).vehicles).toHaveLength(0);
    expect((await (await viewer.c.fetch('/api/social/search?q=mart')).json()).profiles).toHaveLength(0);
    expect((await viewer.c.fetch(`/api/social/profiles/${owner.username}/follow`, { method: 'POST' })).status).toBe(404);
  });

  it('only the owner hides a vehicle', async () => {
    const owner = await person('owner@example.com');
    const guest = await person('guest@example.com');
    const car = await withCar(owner.c);
    await owner.c.fetch(`/api/vehicles/${car.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ email: 'guest@example.com' }),
    });
    const res = await guest.c.fetch(`/api/social/vehicles/${car.id}`, { method: 'PUT', body: JSON.stringify({ hidden: true }) });
    expect(res.status).toBe(403);
  });
});

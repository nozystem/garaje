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

describe('stock vehicle image', () => {
  it('stores no image when the service is not configured', async () => {
    const c = client();
    await c.register();

    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    expect(car.stockImage).toBeUndefined();
  });

  it('keeps the stored image when only the mileage changes', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const updated = await (
      await c.fetch(`/api/vehicles/${car.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...CAR, mileage: 150_000 }),
      })
    ).json();

    expect(updated.stockImage).toBe(car.stockImage);
  });
});

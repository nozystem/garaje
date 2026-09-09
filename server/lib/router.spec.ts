import { createServer, Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { handleRequest } from './router.ts';
import { startTestDb, stopTestDb, truncateAll } from './test-db.ts';

/**
 * Tests de la API contra un servidor HTTP y un PostgreSQL reales: así se
 * comprueban también los códigos de estado, las cookies, el esquema y las
 * claves foráneas, que es donde suelen estar los fallos.
 */

let server: Server;
let base: string;

beforeAll(async () => {
  process.env['POSTGRES_URL'] = startTestDb();
  process.env['AUTH_SECRET'] = 'secreto-de-pruebas-suficientemente-largo-1234567';

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

/** Cliente que recuerda la cookie de sesión, como haría un navegador. */
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
    async register(email = 'ana@ejemplo.com', password = 'contraseña-larga') {
      return this.fetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name: 'Ana' }),
      });
    },
  };
}

const CAR = {
  nickname: 'El coche',
  make: 'SEAT',
  model: 'León',
  year: 2018,
  type: 'car',
  fuel: 'diesel',
  mileage: 100_000,
};

describe('registro', () => {
  it('crea la cuenta y devuelve una sesión', async () => {
    const c = client();
    const res = await c.register();

    expect(res.status).toBe(201);
    const { user } = await res.json();
    expect(user.email).toBe('ana@ejemplo.com');
    expect(user.name).toBe('Ana');
    expect(c.cookie).toContain('garaje_session=');
  });

  it('nunca devuelve el hash de la contraseña', async () => {
    const { user } = await (await client().register()).json();
    expect(JSON.stringify(user)).not.toContain('scrypt');
    expect(user.passwordHash).toBeUndefined();
  });

  it('marca la cookie como httpOnly', async () => {
    const res = await client().register();
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rechaza un correo ya registrado', async () => {
    await client().register('ana@ejemplo.com');
    const res = await client().register('ana@ejemplo.com');
    expect(res.status).toBe(409);
  });

  it('el correo no distingue mayúsculas', async () => {
    await client().register('ana@ejemplo.com');
    const res = await client().register('ANA@Ejemplo.com');
    expect(res.status).toBe(409);
  });

  it('rechaza correos y contraseñas inválidos', async () => {
    const c = client();
    expect((await c.register('no-es-un-correo')).status).toBe(400);
    expect((await c.register('b@ejemplo.com', 'corta')).status).toBe(400);
  });
});

describe('inicio de sesión', () => {
  it('acepta las credenciales correctas', async () => {
    await client().register('ana@ejemplo.com', 'contraseña-larga');

    const c = client();
    const res = await c.fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ana@ejemplo.com', password: 'contraseña-larga' }),
    });

    expect(res.status).toBe(200);
    expect(c.cookie).toContain('garaje_session=');
  });

  it('rechaza la contraseña incorrecta', async () => {
    await client().register('ana@ejemplo.com', 'contraseña-larga');

    const res = await client().fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ana@ejemplo.com', password: 'otra-cosa-mas' }),
    });
    expect(res.status).toBe(401);
  });

  it('no revela si un correo está registrado', async () => {
    await client().register('ana@ejemplo.com', 'contraseña-larga');

    const existe = await client().fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ana@ejemplo.com', password: 'incorrecta-1' }),
    });
    const noExiste = await client().fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nadie@ejemplo.com', password: 'incorrecta-1' }),
    });

    expect(existe.status).toBe(noExiste.status);
    expect(await existe.json()).toEqual(await noExiste.json());
  });
});

describe('sesión', () => {
  it('/api/auth/me devuelve el usuario actual', async () => {
    const c = client();
    await c.register();

    const { user } = await (await c.fetch('/api/auth/me')).json();
    expect(user.email).toBe('ana@ejemplo.com');
  });

  it('/api/auth/me responde 401 sin sesión', async () => {
    expect((await fetch(base + '/api/auth/me')).status).toBe(401);
  });

  it('cerrar sesión invalida la cookie', async () => {
    const c = client();
    await c.register();

    const res = await c.fetch('/api/auth/logout', { method: 'POST' });
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('rechaza una cookie con firma inválida', async () => {
    const res = await fetch(base + '/api/garage', {
      headers: { Cookie: 'garaje_session=abc.def.ghi' },
    });
    expect(res.status).toBe(401);
  });
});

describe('el garaje exige sesión', () => {
  it('devuelve 401 sin autenticar', async () => {
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

describe('aislamiento entre cuentas', () => {
  it('cada cuenta solo ve sus propios vehículos', async () => {
    const ana = client();
    await ana.register('ana@ejemplo.com');
    await ana.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) });

    const luis = client();
    await luis.register('luis@ejemplo.com');

    expect((await (await luis.fetch('/api/garage')).json()).vehicles).toHaveLength(0);
    expect((await (await ana.fetch('/api/garage')).json()).vehicles).toHaveLength(1);
  });

  it('una cuenta no puede leer ni borrar el vehículo de otra', async () => {
    const ana = client();
    await ana.register('ana@ejemplo.com');
    const car = await (
      await ana.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const luis = client();
    await luis.register('luis@ejemplo.com');

    expect((await luis.fetch(`/api/vehicles/${car.id}`)).status).toBe(404);
    expect(
      (await luis.fetch(`/api/vehicles/${car.id}`, { method: 'DELETE' })).status
    ).toBe(404);

    // El vehículo de Ana sigue intacto.
    expect((await (await ana.fetch('/api/garage')).json()).vehicles).toHaveLength(1);
  });

  it('no se puede añadir un registro al vehículo de otra cuenta', async () => {
    const ana = client();
    await ana.register('ana@ejemplo.com');
    const car = await (
      await ana.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const luis = client();
    await luis.register('luis@ejemplo.com');

    const res = await luis.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Intruso',
        date: '2026-01-01', mileage: 1000,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('vehículos', () => {
  it('crea y devuelve el vehículo', async () => {
    const c = client();
    await c.register();

    const res = await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) });
    expect(res.status).toBe(201);

    const vehicle = await res.json();
    expect(vehicle.id).toBeTruthy();
    expect(vehicle.nickname).toBe('El coche');
  });

  it('acumula los errores de validación', async () => {
    const c = client();
    await c.register();

    const res = await c.fetch('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify({ nickname: '', year: 1800, type: 'barco' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).details.length).toBeGreaterThan(2);
  });

  it('actualiza el sello de kilometraje solo si cambia', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const igual = await (
      await c.fetch(`/api/vehicles/${car.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...CAR, nickname: 'Otro nombre' }),
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

  it('borrar el vehículo arrastra su historial y sus planes', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    await c.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Aceite',
        date: '2026-01-01', mileage: 99_000,
      }),
    });
    await c.fetch('/api/plans', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Aceite',
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

describe('registros de mantenimiento', () => {
  async function withCar() {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();
    return { c, car };
  }

  it('sube el cuentakilómetros si el registro es más reciente', async () => {
    const { c, car } = await withCar();

    await c.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Aceite',
        date: '2026-06-01', mileage: 103_000,
      }),
    });

    const snapshot = await (await c.fetch('/api/garage')).json();
    expect(snapshot.vehicles[0].mileage).toBe(103_000);
  });

  it('no baja el cuentakilómetros con un mantenimiento antiguo', async () => {
    const { c, car } = await withCar();

    await c.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Antiguo',
        date: '2025-01-01', mileage: 80_000,
      }),
    });

    const snapshot = await (await c.fetch('/api/garage')).json();
    expect(snapshot.vehicles[0].mileage).toBe(100_000);
  });

  it('cerrar una tarea planificada la reprograma', async () => {
    const { c, car } = await withCar();
    const plan = await (
      await c.fetch('/api/plans', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: car.id, category: 'oil', title: 'Aceite',
          intervalKm: 15_000, lastServiceMileage: 90_000, active: true,
        }),
      })
    ).json();

    await c.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Hecho',
        date: '2026-06-01', mileage: 105_000, planId: plan.id,
      }),
    });

    const snapshot = await (await c.fetch('/api/garage')).json();
    expect(snapshot.plans[0].lastServiceMileage).toBe(105_000);
  });

  it('rechaza un registro para un vehículo inexistente', async () => {
    const c = client();
    await c.register();

    const res = await c.fetch('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: 'no-existe', category: 'oil', title: 'X',
        date: '2026-01-01', mileage: 1000,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('planes de mantenimiento', () => {
  it('exige al menos un intervalo', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();

    const res = await c.fetch('/api/plans', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Sin intervalo', active: true,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).details.join(' ')).toContain('intervalo');
  });

  it('acepta un plan solo temporal, como la ITV', async () => {
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

describe('borrar la cuenta', () => {
  it('se lleva por delante todo su contenido', async () => {
    const c = client();
    await c.register();
    const car = await (
      await c.fetch('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) })
    ).json();
    await c.fetch('/api/plans', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Aceite',
        intervalKm: 15_000, active: true,
      }),
    });

    const res = await c.fetch('/api/account', { method: 'DELETE' });
    expect(res.status).toBe(200);

    // La sesión ya no vale y la cuenta no se puede recuperar.
    expect((await c.fetch('/api/auth/me')).status).toBe(401);
  });
});

describe('catálogo', () => {
  it('es público: no necesita sesión', async () => {
    const res = await fetch(base + '/api/catalog');
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBeGreaterThan(80);
  });

  it('filtra por tipo de vehículo', async () => {
    const res = await fetch(base + '/api/catalog?type=motorcycle');
    const names = (await res.json()).makes.map((m: { name: string }) => m.name);
    expect(names).toContain('Yamaha');
    expect(names).not.toContain('SEAT');
  });
});

describe('errores', () => {
  it('404 en una ruta desconocida', async () => {
    const c = client();
    await c.register();
    expect((await c.fetch('/api/nada')).status).toBe(404);
  });

  it('405 con la cabecera Allow', async () => {
    const c = client();
    await c.register();
    const res = await c.fetch('/api/garage', { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('GET');
  });

  it('rechaza un JSON mal formado', async () => {
    const c = client();
    await c.register();
    const res = await c.fetch('/api/vehicles', { method: 'POST', body: '{roto' });
    expect(res.status).toBe(400);
  });
});

import { createServer, Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { handleRequest } from './router.ts';
import { resetMemory } from './store.ts';

/**
 * Tests de la API contra un servidor real, no contra mocks: así se comprueban
 * también los códigos de estado, las cabeceras y el parseo del cuerpo.
 */

let server: Server;
let base: string;

const GARAGE = 'test-garage-0001';

beforeAll(async () => {
  server = createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      res.statusCode = 500;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => resetMemory());

function api(path: string, init: RequestInit = {}, garage: string | null = GARAGE) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (garage) headers['x-garage-id'] = garage;
  return fetch(base + path, { ...init, headers: { ...headers, ...init.headers } });
}

const CAR = {
  nickname: 'El coche',
  make: 'Seat',
  model: 'León',
  year: 2018,
  type: 'car',
  fuel: 'diesel',
  mileage: 100_000,
};

async function createCar(overrides: Record<string, unknown> = {}) {
  const res = await api('/api/vehicles', {
    method: 'POST',
    body: JSON.stringify({ ...CAR, ...overrides }),
  });
  return res.json();
}

describe('salud y autenticación', () => {
  it('/api/health responde sin garaje', async () => {
    const res = await api('/api/health', {}, null);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });

  it('rechaza las peticiones sin cabecera de garaje', async () => {
    const res = await api('/api/garage', {}, null);
    expect(res.status).toBe(401);
  });

  it('rechaza un identificador de garaje mal formado', async () => {
    const res = await api('/api/garage', {}, 'corto');
    expect(res.status).toBe(401);
  });
});

describe('vehículos', () => {
  it('crea un vehículo y lo devuelve con id', async () => {
    const res = await api('/api/vehicles', { method: 'POST', body: JSON.stringify(CAR) });
    expect(res.status).toBe(201);

    const vehicle = await res.json();
    expect(vehicle.id).toBeTruthy();
    expect(vehicle.nickname).toBe('El coche');
    expect(vehicle.mileageUpdatedAt).toBeTruthy();
  });

  it('acumula los errores de validación en vez de parar en el primero', async () => {
    const res = await api('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify({ nickname: '', year: 1800, type: 'barco' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.length).toBeGreaterThan(2);
  });

  it('actualiza el sello de kilometraje solo si el kilometraje cambia', async () => {
    const car = await createCar();
    const original = car.mileageUpdatedAt;

    const sameKm = await (
      await api(`/api/vehicles/${car.id}`, { method: 'PUT', body: JSON.stringify({ ...CAR, nickname: 'Otro nombre' }) })
    ).json();
    expect(sameKm.mileageUpdatedAt).toBe(original);

    const newKm = await (
      await api(`/api/vehicles/${car.id}`, { method: 'PUT', body: JSON.stringify({ ...CAR, mileage: 105_000 }) })
    ).json();
    expect(newKm.mileageUpdatedAt).not.toBe(original);
  });

  it('un garaje no ve los vehículos de otro', async () => {
    await createCar();

    const otro = await (await api('/api/garage', {}, 'otro-garaje-9999')).json();
    expect(otro.vehicles).toHaveLength(0);

    const propio = await (await api('/api/garage')).json();
    expect(propio.vehicles).toHaveLength(1);
  });

  it('borrar un vehículo arrastra su historial y sus planes', async () => {
    const car = await createCar();
    await api('/api/records', {
      method: 'POST',
      body: JSON.stringify({ vehicleId: car.id, category: 'oil', title: 'Aceite', date: '2026-01-01', mileage: 99_000 }),
    });
    await api('/api/plans', {
      method: 'POST',
      body: JSON.stringify({ vehicleId: car.id, category: 'oil', title: 'Aceite', intervalKm: 15_000, active: true }),
    });

    await api(`/api/vehicles/${car.id}`, { method: 'DELETE' });

    const snapshot = await (await api('/api/garage')).json();
    expect(snapshot.vehicles).toHaveLength(0);
    expect(snapshot.records).toHaveLength(0);
    expect(snapshot.plans).toHaveLength(0);
  });
});

describe('registros de mantenimiento', () => {
  it('sube el cuentakilómetros si el registro es más reciente', async () => {
    const car = await createCar({ mileage: 100_000 });

    await api('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Aceite',
        date: '2026-06-01', mileage: 103_000,
      }),
    });

    const snapshot = await (await api('/api/garage')).json();
    expect(snapshot.vehicles[0].mileage).toBe(103_000);
  });

  it('no baja el cuentakilómetros al registrar un mantenimiento antiguo', async () => {
    const car = await createCar({ mileage: 100_000 });

    await api('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Aceite viejo',
        date: '2025-01-01', mileage: 80_000,
      }),
    });

    const snapshot = await (await api('/api/garage')).json();
    expect(snapshot.vehicles[0].mileage).toBe(100_000);
  });

  it('cerrar una tarea planificada la reprograma', async () => {
    const car = await createCar();
    const plan = await (
      await api('/api/plans', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: car.id, category: 'oil', title: 'Aceite',
          intervalKm: 15_000, lastServiceMileage: 90_000, active: true,
        }),
      })
    ).json();

    await api('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: car.id, category: 'oil', title: 'Aceite hecho',
        date: '2026-06-01', mileage: 105_000, planId: plan.id,
      }),
    });

    const snapshot = await (await api('/api/garage')).json();
    expect(snapshot.plans[0].lastServiceMileage).toBe(105_000);
    expect(snapshot.plans[0].lastServiceDate).toContain('2026-06-01');
  });

  it('rechaza un registro para un vehículo inexistente', async () => {
    const res = await api('/api/records', {
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
    const car = await createCar();
    const res = await api('/api/plans', {
      method: 'POST',
      body: JSON.stringify({ vehicleId: car.id, category: 'oil', title: 'Sin intervalo', active: true }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).details.join(' ')).toContain('intervalo');
  });

  it('acepta un plan solo temporal, como la ITV', async () => {
    const car = await createCar();
    const res = await api('/api/plans', {
      method: 'POST',
      body: JSON.stringify({ vehicleId: car.id, category: 'inspection', title: 'ITV', intervalMonths: 12, active: true }),
    });

    expect(res.status).toBe(201);
    expect((await res.json()).intervalMonths).toBe(12);
  });
});

describe('errores', () => {
  it('devuelve 404 en una ruta desconocida', async () => {
    expect((await api('/api/nada')).status).toBe(404);
  });

  it('devuelve 405 con la cabecera Allow en un método no permitido', async () => {
    const res = await api('/api/garage', { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('GET');
  });

  it('rechaza un JSON mal formado', async () => {
    const res = await fetch(base + '/api/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-garage-id': GARAGE },
      body: '{roto',
    });
    expect(res.status).toBe(400);
  });
});

describe('catálogo de vehículos', () => {
  it('es público: no necesita cabecera de garaje', async () => {
    const res = await api('/api/catalog', {}, null);
    expect(res.status).toBe(200);
  });

  it('fusiona el dataset externo con el catálogo español', async () => {
    const { makes, count, modelCount } = await (await api('/api/catalog')).json();

    expect(count).toBeGreaterThan(80);
    expect(modelCount).toBeGreaterThan(1500);

    const names = makes.map((m: { name: string }) => m.name);
    // Estas cuatro no están en open-vehicle-db: las aporta el catálogo local.
    expect(names).toContain('SEAT');
    expect(names).toContain('Cupra');
    expect(names).toContain('Volkswagen');
    expect(names).toContain('Škoda');
    // Y estas vienen del dataset externo.
    expect(names).toContain('Toyota');
    expect(names).toContain('Ford');
  });

  it('marca el origen de cada marca', async () => {
    const { makes } = await (await api('/api/catalog')).json();

    const seat = makes.find((m: { name: string }) => m.name === 'SEAT');
    expect(seat.sources).toEqual(['local']);

    // Renault existe en ambas fuentes, así que debe declarar las dos.
    const renault = makes.find((m: { name: string }) => m.name === 'Renault');
    expect(renault.sources).toContain('open-vehicle-db');
    expect(renault.sources).toContain('local');
    // Y sumar los modelos de las dos: el dataset externo solo trae cinco.
    expect(renault.models.length).toBeGreaterThan(10);
  });

  it('filtra por tipo de vehículo', async () => {
    const motos = await (await api('/api/catalog?type=motorcycle')).json();

    const names = motos.makes.map((m: { name: string }) => m.name);
    expect(names).toContain('Yamaha');
    expect(names).toContain('KTM');
    // Una marca solo de coches no debe aparecer entre las motos.
    expect(names).not.toContain('SEAT');

    for (const make of motos.makes) {
      for (const model of make.models) {
        expect(model.type).toBe('motorcycle');
      }
    }
  });

  it('no duplica modelos que están en ambas fuentes', async () => {
    const { makes } = await (await api('/api/catalog')).json();

    for (const make of makes) {
      const names = make.models.map((m: { name: string }) => m.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('permite cachear el catálogo pero no los datos del garaje', async () => {
    const catalog = await api('/api/catalog', {}, null);
    expect(catalog.headers.get('cache-control')).toContain('max-age');

    const garage = await api('/api/garage');
    expect(garage.headers.get('cache-control')).toBe('no-store');
  });
});

describe('fotos de vehículos', () => {
  // Un PNG de 1x1 válido, suficiente para comprobar el formato.
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('guarda y devuelve la foto', async () => {
    const car = await createCar({ photo: PNG });
    expect(car.photo).toBe(PNG);

    const snapshot = await (await api('/api/garage')).json();
    expect(snapshot.vehicles[0].photo).toBe(PNG);
  });

  it('acepta un vehículo sin foto', async () => {
    const car = await createCar();
    expect(car.photo).toBeUndefined();
  });

  it('rechaza lo que no sea una imagen en data URL', async () => {
    const res = await api('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify({ ...CAR, photo: 'https://ejemplo.com/foto.jpg' }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).details.join(' ')).toContain('formato');
  });

  it('rechaza una foto demasiado grande', async () => {
    const huge = 'data:image/jpeg;base64,' + 'A'.repeat(310_000);
    const res = await api('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify({ ...CAR, photo: huge }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).details.join(' ')).toContain('grande');
  });

  it('permite quitar la foto al editar', async () => {
    const car = await createCar({ photo: PNG });

    const updated = await (
      await api(`/api/vehicles/${car.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...CAR, photo: '' }),
      })
    ).json();

    expect(updated.photo).toBeUndefined();
  });
});

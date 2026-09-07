import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { VehicleType } from '../models/vehicle.model';

export interface CatalogModel {
  name: string;
  type: string;
  years?: string;
}

export interface CatalogMake {
  slug: string;
  name: string;
  models: CatalogModel[];
  sources: ('open-vehicle-db' | 'local')[];
}

interface CatalogResponse {
  count: number;
  modelCount: number;
  makes: CatalogMake[];
}

/**
 * Catálogo de marcas y modelos, servido por la API.
 *
 * Se pide una vez por tipo de vehículo y se guarda en memoria: son datos que
 * cambian pocas veces al año y no merece la pena volver a bajarlos al cambiar
 * de pestaña. Si la petición falla, el formulario sigue funcionando con los
 * campos en texto libre.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<VehicleType, CatalogMake[]>();

  readonly loading = signal(false);
  readonly failed = signal(false);

  async makesFor(type: VehicleType): Promise<CatalogMake[]> {
    const cached = this.cache.get(type);
    if (cached) return cached;

    this.loading.set(true);
    this.failed.set(false);

    try {
      const response = await firstValueFrom(
        this.http.get<CatalogResponse>(`/api/catalog?type=${type}`)
      );
      this.cache.set(type, response.makes);
      return response.makes;
    } catch {
      this.failed.set(true);
      return [];
    } finally {
      this.loading.set(false);
    }
  }

  modelsFor(makes: CatalogMake[], makeName: string): string[] {
    const make = makes.find(
      (m) => m.name.toLowerCase() === makeName.trim().toLowerCase()
    );
    return make ? make.models.map((m) => m.name) : [];
  }
}

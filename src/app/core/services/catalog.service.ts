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

export type FacetName = 'model' | 'body' | 'fuel' | 'transmission' | 'badge';

export interface FacetValue {
  value: string;
  count: number;
}

export type Facets = Partial<Record<FacetName, FacetValue[]>>;

export interface FacetFilters {
  make?: string;
  model?: string;
  year?: number;
  body?: string;
  fuel?: string;
}

interface CatalogResponse {
  count: number;
  modelCount: number;
  makes: CatalogMake[];
}

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<VehicleType, CatalogMake[]>();
  private readonly facetCache = new Map<string, Promise<Facets>>();

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

  /**
   * Valores posibles de cada faceta para los filtros dados, según API Ninjas.
   * Si el servicio no está disponible devuelve {} y el formulario sigue
   * funcionando solo con el catálogo local.
   */
  async facets(filters: FacetFilters, facets: FacetName[]): Promise<Facets> {
    const params = new URLSearchParams({ facets: facets.join(',') });
    for (const [name, value] of Object.entries(filters)) {
      if (value) params.set(name, String(value));
    }

    const key = params.toString();
    const cached = this.facetCache.get(key);
    if (cached) return cached;

    const request = firstValueFrom(
      this.http.get<{ facets: Facets }>(`/api/catalog/facets?${key}`)
    )
      .then((response) => response.facets)
      .catch(() => {
        this.facetCache.delete(key);
        return {};
      });
    this.facetCache.set(key, request);
    return request;
  }

  modelsFor(makes: CatalogMake[], makeName: string): string[] {
    const make = makes.find(
      (m) => m.name.toLowerCase() === makeName.trim().toLowerCase()
    );
    return make ? make.models.map((m) => m.name) : [];
  }
}

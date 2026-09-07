import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { MaintenancePlan, MaintenanceRecord } from '../models/maintenance.model';
import { Vehicle, VehicleDraft } from '../models/vehicle.model';
import { GarageIdService } from './garage-id.service';

export interface GarageSnapshot {
  vehicles: Vehicle[];
  records: MaintenanceRecord[];
  plans: MaintenancePlan[];
}

export interface HealthStatus {
  status: string;
  /** Falso cuando la API corre sin base de datos: los datos no sobreviven. */
  persistent: boolean;
  time: string;
}

/** Acceso a la API. Todo el manejo de errores de red vive aquí. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly garageId = inject(GarageIdService);

  private readonly base = '/api';

  health(): Observable<HealthStatus> {
    return this.http
      .get<HealthStatus>(`${this.base}/health`)
      .pipe(catchError(this.toFriendlyError));
  }

  loadGarage(): Observable<GarageSnapshot> {
    return this.http
      .get<GarageSnapshot>(`${this.base}/garage`, { headers: this.headers() })
      .pipe(catchError(this.toFriendlyError));
  }

  createVehicle(draft: VehicleDraft): Observable<Vehicle> {
    return this.http
      .post<Vehicle>(`${this.base}/vehicles`, draft, { headers: this.headers() })
      .pipe(catchError(this.toFriendlyError));
  }

  updateVehicle(id: string, draft: VehicleDraft): Observable<Vehicle> {
    return this.http
      .put<Vehicle>(`${this.base}/vehicles/${id}`, draft, { headers: this.headers() })
      .pipe(catchError(this.toFriendlyError));
  }

  deleteVehicle(id: string): Observable<unknown> {
    return this.http
      .delete(`${this.base}/vehicles/${id}`, { headers: this.headers() })
      .pipe(catchError(this.toFriendlyError));
  }

  createRecord(record: Omit<MaintenanceRecord, 'id' | 'createdAt'>): Observable<MaintenanceRecord> {
    return this.http
      .post<MaintenanceRecord>(`${this.base}/records`, record, { headers: this.headers() })
      .pipe(catchError(this.toFriendlyError));
  }

  deleteRecord(id: string): Observable<unknown> {
    return this.http
      .delete(`${this.base}/records/${id}`, { headers: this.headers() })
      .pipe(catchError(this.toFriendlyError));
  }

  createPlan(plan: Omit<MaintenancePlan, 'id' | 'createdAt'>): Observable<MaintenancePlan> {
    return this.http
      .post<MaintenancePlan>(`${this.base}/plans`, plan, { headers: this.headers() })
      .pipe(catchError(this.toFriendlyError));
  }

  updatePlan(id: string, plan: Partial<MaintenancePlan>): Observable<MaintenancePlan> {
    return this.http
      .put<MaintenancePlan>(`${this.base}/plans/${id}`, plan, { headers: this.headers() })
      .pipe(catchError(this.toFriendlyError));
  }

  deletePlan(id: string): Observable<unknown> {
    return this.http
      .delete(`${this.base}/plans/${id}`, { headers: this.headers() })
      .pipe(catchError(this.toFriendlyError));
  }

  private headers(): HttpHeaders {
    return new HttpHeaders({ 'x-garage-id': this.garageId.id });
  }

  /** Traduce el error HTTP a algo que se pueda enseñar en pantalla. */
  private toFriendlyError(error: HttpErrorResponse) {
    if (error.status === 0) {
      return throwError(() => new Error('Sin conexión con el servidor.'));
    }

    const details = error.error?.details;
    if (Array.isArray(details) && details.length) {
      return throwError(() => new Error(details.join('. ')));
    }

    return throwError(
      () => new Error(error.error?.error ?? 'No se ha podido completar la operación.')
    );
  }
}

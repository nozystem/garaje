import { Injectable } from '@angular/core';

const STORAGE_KEY = 'garaje-id';

/**
 * Identifica el garaje del visitante.
 *
 * Se genera un id aleatorio la primera vez y se guarda en el navegador. No es
 * autenticación: quien tenga el id ve ese garaje. A cambio, cualquiera puede
 * probar la app sin registrarse, y el id se puede copiar para abrir el mismo
 * garaje en otro dispositivo.
 */
@Injectable({ providedIn: 'root' })
export class GarageIdService {
  private cached: string | null = null;

  get id(): string {
    if (this.cached) return this.cached;

    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Modo privado o almacenamiento bloqueado: el id durará la sesión.
    }

    this.cached = stored ?? this.create();
    return this.cached;
  }

  /** Permite abrir un garaje existente desde otro dispositivo. */
  adopt(id: string): boolean {
    const clean = id.trim();
    if (!/^[a-z0-9-]{8,64}$/i.test(clean)) return false;

    this.cached = clean;
    this.persist(clean);
    return true;
  }

  private create(): string {
    const id = crypto.randomUUID();
    this.persist(id);
    return id;
  }

  private persist(id: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Sin almacenamiento, el id vive solo mientras dure la pestaña.
    }
  }
}

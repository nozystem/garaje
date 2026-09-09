import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

/**
 * Sesión del usuario.
 *
 * El token vive en una cookie httpOnly que pone el servidor, así que aquí no
 * se guarda ni se manipula: basta con enviar las credenciales en cada
 * petición (`withCredentials`) y preguntar quién es el usuario al arrancar.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly _user = signal<User | null>(null);
  private readonly _checked = signal(false);

  readonly user = this._user.asReadonly();
  /** Falso hasta que se sabe si hay sesión: evita parpadeos al arrancar. */
  readonly checked = this._checked.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);

  /** Comprueba si hay sesión activa. Se llama una vez al arrancar. */
  async restore(): Promise<void> {
    if (this._checked()) return;

    try {
      const { user } = await firstValueFrom(
        this.http.get<{ user: User }>('/api/auth/me', { withCredentials: true })
      );
      this._user.set(user);
    } catch {
      this._user.set(null);
    } finally {
      this._checked.set(true);
    }
  }

  async register(name: string, email: string, password: string): Promise<void> {
    const { user } = await firstValueFrom(
      this.http.post<{ user: User }>(
        '/api/auth/register',
        { name, email, password },
        { withCredentials: true }
      )
    );
    this._user.set(user);
    this._checked.set(true);
  }

  async login(email: string, password: string): Promise<void> {
    const { user } = await firstValueFrom(
      this.http.post<{ user: User }>(
        '/api/auth/login',
        { email, password },
        { withCredentials: true }
      )
    );
    this._user.set(user);
    this._checked.set(true);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post('/api/auth/logout', {}, { withCredentials: true })
      );
    } finally {
      // Aunque falle la petición, en el cliente la sesión se da por cerrada.
      this._user.set(null);
    }
  }

  async deleteAccount(): Promise<void> {
    await firstValueFrom(
      this.http.delete('/api/account', { withCredentials: true })
    );
    this._user.set(null);
  }

  /** Traduce el error HTTP a algo que se pueda enseñar en pantalla. */
  static message(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Sin conexión con el servidor.';

      const details = error.error?.details;
      if (Array.isArray(details) && details.length) return details.join('. ');
      if (error.error?.error) return error.error.error;
    }
    return 'No se ha podido completar la operación.';
  }
}

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly _user = signal<User | null>(null);
  private readonly _checked = signal(false);

  readonly user = this._user.asReadonly();
  readonly checked = this._checked.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);

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
      this._user.set(null);
    }
  }

  async deleteAccount(): Promise<void> {
    await firstValueFrom(
      this.http.delete('/api/account', { withCredentials: true })
    );
    this._user.set(null);
  }

  static message(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Cannot reach the server.';

      const details = error.error?.details;
      if (Array.isArray(details) && details.length) return details.join('. ');
      if (error.error?.error) return error.error.error;
    }
    return 'The request could not be completed.';
  }
}

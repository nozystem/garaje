import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { refreshOutline } from 'ionicons/icons';
import { firstValueFrom } from 'rxjs';

/** Espejo de AdminStats en server/lib/store.ts. */
interface UsageWindow {
  service: 'gemini' | 'illustration-cache' | 'api-ninjas';
  outcome: 'ok' | 'error';
  today: number;
  week: number;
  month: number;
  total: number;
  costMonth: number;
  costTotal: number;
}

interface AdminStats {
  users: { total: number; week: number; month: number };
  vehicles: number;
  storedIllustrations: number;
  usage: UsageWindow[];
  daily: { day: string; gemini: number; cacheHits: number; apiNinjas: number }[];
  topMakes: { make: string; count: number }[];
  people: {
    id: string;
    email: string;
    name: string;
    createdAt: string;
    vehicles: number;
    images: number;
    costUsd: number;
    lastActivity: string | null;
  }[];
}

/** Lo que cuesta una imagen de Gemini: para estimar lo ahorrado con la caché. */
const COST_PER_IMAGE_USD = 0.0336;

type Window = 'today' | 'week' | 'month' | 'total';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrl: './admin.page.scss',
  imports: [
    DatePipe, DecimalPipe,
    IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon,
    IonSpinner, IonTitle, IonToolbar,
  ],
})
export class AdminPage implements OnInit {
  private readonly http = inject(HttpClient);

  readonly stats = signal<AdminStats | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Suma de un servicio en una ventana de tiempo, con o sin errores. */
  private count(service: UsageWindow['service'], window: Window, outcome: UsageWindow['outcome'] = 'ok'): number {
    return (this.stats()?.usage ?? [])
      .filter((u) => u.service === service && u.outcome === outcome)
      .reduce((sum, u) => sum + u[window], 0);
  }

  readonly gemini = computed(() => ({
    today: this.count('gemini', 'today'),
    week: this.count('gemini', 'week'),
    month: this.count('gemini', 'month'),
    errorsMonth: this.count('gemini', 'month', 'error'),
    costMonth: this.cost('gemini', 'costMonth'),
    costTotal: this.cost('gemini', 'costTotal'),
  }));

  readonly cache = computed(() => {
    const month = this.count('illustration-cache', 'month');
    const total = this.count('illustration-cache', 'total');
    return { month, total, savedTotal: total * COST_PER_IMAGE_USD };
  });

  readonly ninjas = computed(() => ({
    today: this.count('api-ninjas', 'today'),
    week: this.count('api-ninjas', 'week'),
    month: this.count('api-ninjas', 'month'),
    errorsMonth: this.count('api-ninjas', 'month', 'error'),
  }));

  /** Barras de imágenes generadas por día; la altura es relativa al máximo. */
  readonly days = computed(() => {
    const daily = this.stats()?.daily ?? [];
    const max = Math.max(1, ...daily.map((d) => d.gemini));
    return daily.map((d) => ({ ...d, height: (d.gemini / max) * 100 }));
  });

  readonly makes = computed(() => {
    const makes = this.stats()?.topMakes ?? [];
    const max = Math.max(1, ...makes.map((m) => m.count));
    return makes.map((m) => ({ ...m, width: (m.count / max) * 100 }));
  });

  constructor() {
    addIcons({ refreshOutline });
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.stats.set(
        await firstValueFrom(this.http.get<AdminStats>('/api/admin/stats', { withCredentials: true }))
      );
    } catch {
      this.error.set('Could not load the stats');
    } finally {
      this.loading.set(false);
    }
  }

  private cost(service: UsageWindow['service'], field: 'costMonth' | 'costTotal'): number {
    return (this.stats()?.usage ?? [])
      .filter((u) => u.service === service)
      .reduce((sum, u) => sum + u[field], 0);
  }
}

import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonSpinner,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  carSportOutline,
  lockClosedOutline,
  mailOutline,
  personOutline,
} from 'ionicons/icons';

import { AuthService } from '../../core/services/auth.service';

type Mode = 'login' | 'register';

@Component({
  selector: 'app-auth',
  templateUrl: './auth.page.html',
  styleUrl: './auth.page.scss',
  imports: [
    ReactiveFormsModule,
    IonButton, IonContent, IonIcon, IonInput, IonItem, IonSpinner,
  ],
})
export class AuthPage {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastController);

  readonly mode = signal<Mode>('login');
  readonly busy = signal(false);
  readonly submitted = signal(false);

  readonly isRegister = computed(() => this.mode() === 'register');

  readonly form = this.fb.nonNullable.group({
    name: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  constructor() {
    addIcons({ carSportOutline, lockClosedOutline, mailOutline, personOutline });
  }

  switchTo(mode: Mode): void {
    this.mode.set(mode);
    this.submitted.set(false);

    const name = this.form.controls.name;
    if (mode === 'register') {
      name.setValidators([Validators.required, Validators.minLength(2)]);
    } else {
      name.clearValidators();
    }
    name.updateValueAndValidity();
  }

  invalid(field: string): boolean {
    const control = this.form.get(field);
    return !!control && control.invalid && (control.touched || this.submitted());
  }

  async submit(): Promise<void> {
    this.submitted.set(true);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    const { name, email, password } = this.form.getRawValue();

    try {
      if (this.isRegister()) {
        await this.auth.register(name, email, password);
      } else {
        await this.auth.login(email, password);
      }
      void this.router.navigate(['/garage']);
    } catch (error) {
      const toast = await this.toasts.create({
        message: AuthService.message(error),
        color: 'danger',
        duration: 3000,
        position: 'top',
      });
      await toast.present();
    } finally {
      this.busy.set(false);
    }
  }
}

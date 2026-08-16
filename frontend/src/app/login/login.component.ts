import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'pc-login',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly isSigningIn = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // Se já existe sessão (ex.: usuário digitou /login por engano), não faz sentido pedir login de novo.
    this.auth.ensureSessionLoaded().then((session) => {
      if (session) this.router.navigate(['/']);
    });
  }

  async signIn(): Promise<void> {
    this.isSigningIn.set(true);
    this.error.set(null);
    try {
      await this.auth.signInWithGoogle();
      // A partir daqui o Supabase redireciona para o Google; se voltar com
      // erro, o catch abaixo trata, senão o navegador já navegou para fora.
    } catch (err) {
      console.error('Falha ao iniciar login com Google', err);
      this.error.set('Não foi possível conectar ao Google. Tente novamente.');
      this.isSigningIn.set(false);
    }
  }
}

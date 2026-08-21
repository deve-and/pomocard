import { Injectable, signal } from '@angular/core';

const ERROR_TOAST_DURATION_MS = 4500;

/**
 * Notificação de erro visível ao usuário — antes deste serviço, toda falha
 * de rede/Supabase (salvar carta, deck, revisão, recompensa, streak) ia só
 * pro console.error, sem nenhum feedback na tela. Root-provided singleton
 * pra qualquer service/component poder mostrar um erro, renderizado uma
 * única vez na raiz do app (ver error-toast.component.ts + app.component.ts)
 * em vez de cada tela precisar da própria UI de toast.
 */
@Injectable({ providedIn: 'root' })
export class ErrorToastService {
  readonly message = signal<string | null>(null);
  private timeoutHandle?: ReturnType<typeof setTimeout>;

  show(message: string): void {
    this.message.set(message);
    clearTimeout(this.timeoutHandle);
    this.timeoutHandle = setTimeout(() => this.message.set(null), ERROR_TOAST_DURATION_MS);
  }
}

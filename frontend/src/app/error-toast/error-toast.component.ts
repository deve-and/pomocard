import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ErrorToastService } from '../core/error-toast.service';

/**
 * Renderizada uma vez na raiz do app (ver app.component.ts) — assim toda
 * tela (dashboard, revisão, gerenciar deck, login) reflete erros de rede
 * sem precisar da própria cópia da UI de toast.
 */
@Component({
  selector: 'pc-error-toast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './error-toast.component.html',
  styleUrl: './error-toast.component.scss',
})
export class ErrorToastComponent {
  readonly errorToast = inject(ErrorToastService);
}

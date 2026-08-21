import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PomodoroTimerService } from './core/pomodoro-timer.service';
import { FocusModeComponent } from './focus-mode/focus-mode.component';

@Component({
  selector: 'pc-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, FocusModeComponent],
  template: `
    <router-outlet />
    <pc-focus-mode *ngIf="pomodoroTimer.isZenModeActive()" />
  `,
})
export class AppComponent {
  // Renderizado aqui (raiz do app) em vez de dentro do DashboardComponent
  // pra cobrir a tela inteira independente da rota atual quando um Pomodoro
  // de foco está rodando — ver isZenModeActive em pomodoro-timer.service.ts.
  readonly pomodoroTimer = inject(PomodoroTimerService);
}

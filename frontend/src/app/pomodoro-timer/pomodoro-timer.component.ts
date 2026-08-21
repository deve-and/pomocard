import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { PomodoroTimerService } from '../core/pomodoro-timer.service';

/**
 * View fina sobre o PomodoroTimerService: toda a lógica de contagem vive no
 * serviço (singleton de app inteiro) para sobreviver à destruição deste
 * componente quando o usuário navega para outra rota — ver o comentário no
 * topo do serviço para o porquê. O modal de configurações também é
 * controlado por esse serviço (isSettingsOpen), mas é RENDERIZADO em
 * dashboard.component.html, fora do painel do timer — ver o comentário
 * de isSettingsOpen no serviço para o porquê.
 */
@Component({
  selector: 'pc-pomodoro-timer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pomodoro-timer.component.html',
  styleUrl: './pomodoro-timer.component.scss',
})
export class PomodoroTimerComponent {
  private readonly timer = inject(PomodoroTimerService);

  readonly phase = this.timer.phase;
  readonly isRunning = this.timer.isRunning;
  readonly remainingSeconds = this.timer.remainingSeconds;
  readonly phaseLabel = this.timer.phaseLabel;
  readonly isBreak = this.timer.isBreak;
  readonly phaseDurationSeconds = this.timer.phaseDurationSeconds;

  readonly isSettingsOpen = this.timer.isSettingsOpen;

  get displayTime(): string {
    return this.timer.displayTime;
  }

  start(): void {
    this.timer.start();
  }

  pause(): void {
    this.timer.pause();
  }

  reset(): void {
    this.timer.reset();
  }

  skipBreak(): void {
    this.timer.skipBreak();
  }
}

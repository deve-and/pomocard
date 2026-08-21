import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BREAK_MAX_MINUTES,
  BREAK_MIN_MINUTES,
  FOCUS_MAX_MINUTES,
  FOCUS_MIN_MINUTES,
  PomodoroTimerService,
} from '../core/pomodoro-timer.service';

/**
 * Configuração das três durações do Pomodoro (foco/descanso curto/descanso longo).
 * Autocontido: lê e grava direto no PomodoroTimerService (não precisa de @Input,
 * o serviço já é a fonte da verdade) — só emite `closed` pra o pai esconder o modal,
 * tanto ao cancelar quanto depois de salvar com sucesso.
 */
@Component({
  selector: 'pc-pomodoro-settings-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pomodoro-settings-modal.component.html',
  styleUrl: './pomodoro-settings-modal.component.scss',
})
export class PomodoroSettingsModalComponent {
  private readonly timer = inject(PomodoroTimerService);

  @Output() closed = new EventEmitter<void>();

  readonly isRunning = this.timer.isRunning;

  readonly focusMin = FOCUS_MIN_MINUTES;
  readonly focusMax = FOCUS_MAX_MINUTES;
  readonly breakMin = BREAK_MIN_MINUTES;
  readonly breakMax = BREAK_MAX_MINUTES;

  focusMinutes = this.timer.focusMinutesSetting();
  shortBreakMinutes = this.timer.shortBreakMinutesSetting();
  longBreakMinutes = this.timer.longBreakMinutesSetting();

  focusError: string | null = null;
  shortBreakError: string | null = null;
  longBreakError: string | null = null;

  save(): void {
    const errors = this.timer.updateSettings(
      Number(this.focusMinutes),
      Number(this.shortBreakMinutes),
      Number(this.longBreakMinutes)
    );

    this.focusError = errors.find((e) => e.field === 'focus')?.message ?? null;
    this.shortBreakError = errors.find((e) => e.field === 'shortBreak')?.message ?? null;
    this.longBreakError = errors.find((e) => e.field === 'longBreak')?.message ?? null;

    if (errors.length === 0) this.closed.emit();
  }
}

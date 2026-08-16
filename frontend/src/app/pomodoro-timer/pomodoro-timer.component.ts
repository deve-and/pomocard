import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, Output, computed, signal } from '@angular/core';

export type PomodoroPhase = 'focus' | 'short-break' | 'long-break';

/**
 * Timer Pomodoro do fluxo principal (regra de negócio 1: Timer -> Modal de
 * Criação de Flashcard -> Recompensa em Mana/XP), com o ciclo clássico de
 * descansos: 5 min de descanso curto após cada foco, e um descanso longo de
 * 15 min a cada N sessões de foco completadas (`longBreakEvery`).
 *
 * Só o foco emite `sessionCompleted` (é o único que gera recompensa — o
 * descanso não conta tempo de stamina nem mana).
 */
@Component({
  selector: 'pc-pomodoro-timer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pomodoro-timer.component.html',
  styleUrl: './pomodoro-timer.component.scss',
})
export class PomodoroTimerComponent implements OnDestroy {
  // TODO: voltar para 25 depois dos testes de beta — 1 minuto é só para
  // validar o ciclo de recompensa (Mana/XP) sem esperar a duração real.
  @Input() durationMinutes = 1;
  @Input() shortBreakMinutes = 5;
  @Input() longBreakMinutes = 15;
  @Input() longBreakEvery = 2;

  @Output() sessionCompleted = new EventEmitter<number>();

  private intervalHandle?: ReturnType<typeof setInterval>;

  readonly phase = signal<PomodoroPhase>('focus');
  readonly completedFocusSessions = signal(0);
  readonly isRunning = signal(false);
  readonly remainingSeconds = signal(this.durationMinutes * 60);

  readonly phaseLabel = computed(() => {
    switch (this.phase()) {
      case 'short-break':
        return 'Descanso Curto';
      case 'long-break':
        return 'Descanso Longo';
      default:
        return 'Foco';
    }
  });

  readonly isBreak = computed(() => this.phase() !== 'focus');
  readonly phaseDurationSeconds = computed(() => this.phaseDurationMinutes(this.phase()) * 60);

  get displayTime(): string {
    const minutes = Math.floor(this.remainingSeconds() / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (this.remainingSeconds() % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  start(): void {
    if (this.isRunning()) return;
    this.isRunning.set(true);
    this.intervalHandle = setInterval(() => this.tick(), 1000);
  }

  pause(): void {
    this.isRunning.set(false);
    clearInterval(this.intervalHandle);
  }

  reset(): void {
    this.pause();
    this.remainingSeconds.set(this.phaseDurationMinutes(this.phase()) * 60);
  }

  /** Encerra o descanso atual na marra, sem esperar o relógio zerar. */
  skipBreak(): void {
    if (!this.isBreak()) return;
    this.advancePhase();
  }

  private tick(): void {
    const next = this.remainingSeconds() - 1;
    if (next <= 0) {
      this.remainingSeconds.set(0);
      this.pause();
      this.advancePhase();
      return;
    }
    this.remainingSeconds.set(next);
  }

  private advancePhase(): void {
    this.pause();

    if (this.phase() === 'focus') {
      this.sessionCompleted.emit(this.durationMinutes);

      const completed = this.completedFocusSessions() + 1;
      this.completedFocusSessions.set(completed);

      const nextPhase: PomodoroPhase = completed % this.longBreakEvery === 0 ? 'long-break' : 'short-break';
      this.phase.set(nextPhase);
      this.remainingSeconds.set(this.phaseDurationMinutes(nextPhase) * 60);
    } else {
      this.phase.set('focus');
      this.remainingSeconds.set(this.durationMinutes * 60);
    }
  }

  private phaseDurationMinutes(phase: PomodoroPhase): number {
    switch (phase) {
      case 'short-break':
        return this.shortBreakMinutes;
      case 'long-break':
        return this.longBreakMinutes;
      default:
        return this.durationMinutes;
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.intervalHandle);
  }
}

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';
import { AudioService } from '../core/audio.service';

export type PomodoroPhase = 'focus' | 'short-break' | 'long-break';

interface PersistedTimerState {
  phase: PomodoroPhase;
  targetEndAt: number;
  completedFocusSessions: number;
}

const STORAGE_KEY = 'pomocard.pomodoro.running';

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
export class PomodoroTimerComponent implements OnInit, OnDestroy {
  @Input() durationMinutes = 25;
  @Input() shortBreakMinutes = 5;
  @Input() longBreakMinutes = 15;
  @Input() longBreakEvery = 2;

  @Output() sessionCompleted = new EventEmitter<number>();

  private readonly audio = inject(AudioService);
  private intervalHandle?: ReturnType<typeof setInterval>;
  /** Timestamp (epoch ms) em que a fase atual deve chegar a zero. Fonte da verdade do tempo restante. */
  private targetEndAt = 0;
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && this.isRunning()) this.tick();
  };

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

  ngOnInit(): void {
    // Adiado para depois da construção: se a fase tiver terminado enquanto a aba estava
    // fechada, resumeFromStorageIfAny() pode emitir `sessionCompleted` na hora, e o
    // listener do componente pai só fica pronto depois que Angular termina de criar a view.
    this.resumeFromStorageIfAny();
  }

  get displayTime(): string {
    const minutes = Math.floor(this.remainingSeconds() / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (this.remainingSeconds() % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  start(): void {
    if (this.isRunning()) return;
    this.audio.unlock();
    this.beginCountdown(Date.now() + this.remainingSeconds() * 1000);
  }

  pause(): void {
    this.isRunning.set(false);
    clearInterval(this.intervalHandle);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    localStorage.removeItem(STORAGE_KEY);
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

  /**
   * Alguns navegadores (sobretudo mobile) descartam e recarregam abas em segundo plano
   * quando o usuário troca de app — isso zera todo o estado em memória do componente.
   * Por isso, enquanto uma fase está rodando, guardamos o horário real de término em
   * localStorage e, ao recriar o componente, recalculamos o tempo restante a partir do
   * relógio real em vez de simplesmente reiniciar do zero.
   */
  private beginCountdown(targetEndAt: number): void {
    this.isRunning.set(true);
    this.targetEndAt = targetEndAt;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        phase: this.phase(),
        targetEndAt,
        completedFocusSessions: this.completedFocusSessions(),
      } satisfies PersistedTimerState)
    );
    // Intervalo curto só para deixar a UI fluida; o tempo restante nunca vem da contagem
    // de disparos do interval (que os navegadores atrasam em abas em segundo plano), e
    // sim da diferença real de relógio até targetEndAt — ver tick().
    this.intervalHandle = setInterval(() => this.tick(), 250);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private resumeFromStorageIfAny(): void {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    let saved: PersistedTimerState;
    try {
      saved = JSON.parse(raw);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    this.phase.set(saved.phase);
    this.completedFocusSessions.set(saved.completedFocusSessions);

    const secondsLeft = Math.round((saved.targetEndAt - Date.now()) / 1000);
    if (secondsLeft > 0) {
      this.remainingSeconds.set(secondsLeft);
      this.beginCountdown(saved.targetEndAt);
    } else {
      // A fase terminou enquanto a aba estava fechada/suspensa — conclui direto,
      // como se o relógio tivesse chegado a zero agora.
      this.remainingSeconds.set(0);
      this.advancePhase();
    }
  }

  private tick(): void {
    const secondsLeft = Math.max(0, Math.round((this.targetEndAt - Date.now()) / 1000));
    if (secondsLeft <= 0) {
      this.remainingSeconds.set(0);
      this.pause();
      this.advancePhase();
      return;
    }
    this.remainingSeconds.set(secondsLeft);
  }

  private advancePhase(): void {
    this.pause();

    if (this.phase() === 'focus') {
      this.audio.playFocusComplete();
      this.sessionCompleted.emit(this.durationMinutes);

      const completed = this.completedFocusSessions() + 1;
      this.completedFocusSessions.set(completed);

      const nextPhase: PomodoroPhase = completed % this.longBreakEvery === 0 ? 'long-break' : 'short-break';
      this.phase.set(nextPhase);
      this.remainingSeconds.set(this.phaseDurationMinutes(nextPhase) * 60);
    } else {
      this.audio.playBreakComplete();
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
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}

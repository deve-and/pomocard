import { Injectable, computed, inject, signal } from '@angular/core';
import { AudioService } from './audio.service';

export type PomodoroPhase = 'focus' | 'short-break' | 'long-break';

interface PersistedTimerState {
  phase: PomodoroPhase;
  targetEndAt: number;
  completedFocusSessions: number;
}

const STORAGE_KEY = 'pomocard.pomodoro.running';

// Sequência de 4 ciclos: Foco -> Curto três vezes, e o 4º Foco encerra em Longo —
// depois disso o loop reinicia em Foco automaticamente. completedFocusSessions
// nunca é resetado; é o `% LONG_BREAK_EVERY` em advancePhase() que faz o loop de
// ciclos se repetir indefinidamente. Durações em 1 minuto por momento, só para
// agilizar testes — valores reais são Foco 25 / Curto 5 / Longo 30.
const DURATION_MINUTES = 1;
const SHORT_BREAK_MINUTES = 1;
const LONG_BREAK_MINUTES = 1;
const LONG_BREAK_EVERY = 4;

/**
 * Timer Pomodoro do fluxo principal (regra de negócio 1: Timer -> Modal de
 * Criação de Flashcard -> Recompensa em Gold/XP), com o ciclo clássico de
 * descansos: 5 min de descanso curto após cada foco, e um descanso longo de
 * 30 min a cada quatro sessões de foco completadas (ver LONG_BREAK_EVERY).
 *
 * É um serviço singleton (não um estado do componente) de propósito: o
 * Angular Router destrói e recria o DashboardComponent (e qualquer filho
 * seu) toda vez que o usuário navega para outra rota (ex.: abrir um deck).
 * Se o timer vivesse dentro do componente, cada navegação resetaria a
 * contagem ou perderia a fase de descanso em andamento. Aqui ele roda
 * independente da rota atual, e só é recriado numa recarga de página
 * completa — cenário coberto por resumeFromStorageIfAny().
 */
@Injectable({ providedIn: 'root' })
export class PomodoroTimerService {
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
  readonly remainingSeconds = signal(DURATION_MINUTES * 60);

  /** Sessão de foco concluída aguardando o dashboard abrir o modal de recompensa. */
  readonly pendingFocusReward = signal<number | null>(null);

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

  constructor() {
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

  consumePendingFocusReward(): number | null {
    const minutes = this.pendingFocusReward();
    this.pendingFocusReward.set(null);
    return minutes;
  }

  /**
   * Alguns navegadores (sobretudo mobile) descartam e recarregam a página em
   * segundo plano quando o usuário troca de app — isso zera todo o estado em
   * memória. Por isso, enquanto uma fase está rodando, guardamos o horário
   * real de término em localStorage e, ao recriar o serviço, recalculamos o
   * tempo restante a partir do relógio real em vez de reiniciar do zero.
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
      this.pendingFocusReward.set(DURATION_MINUTES);

      const completed = this.completedFocusSessions() + 1;
      this.completedFocusSessions.set(completed);

      const nextPhase: PomodoroPhase = completed % LONG_BREAK_EVERY === 0 ? 'long-break' : 'short-break';
      this.phase.set(nextPhase);
      this.remainingSeconds.set(this.phaseDurationMinutes(nextPhase) * 60);
    } else {
      this.audio.playBreakComplete();
      this.phase.set('focus');
      this.remainingSeconds.set(DURATION_MINUTES * 60);
    }
  }

  private phaseDurationMinutes(phase: PomodoroPhase): number {
    switch (phase) {
      case 'short-break':
        return SHORT_BREAK_MINUTES;
      case 'long-break':
        return LONG_BREAK_MINUTES;
      default:
        return DURATION_MINUTES;
    }
  }
}

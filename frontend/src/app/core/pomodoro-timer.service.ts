import { Injectable, computed, inject, signal } from '@angular/core';
import { AudioService } from './audio.service';

export type PomodoroPhase = 'focus' | 'short-break' | 'long-break';

interface PersistedTimerState {
  phase: PomodoroPhase;
  targetEndAt: number;
  completedFocusSessions: number;
  /** Duração (min) "congelada" da fase em andamento — ver comentário em activePhaseDurationMinutes. */
  activePhaseDurationMinutes: number;
}

interface PersistedTimerSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
}

export interface TimerSettingsValidationError {
  field: 'focus' | 'shortBreak' | 'longBreak';
  message: string;
}

const STORAGE_KEY = 'pomocard.pomodoro.running';
const SETTINGS_STORAGE_KEY = 'pomocard.pomodoro.settings';

const DEFAULT_FOCUS_MINUTES = 25;
const DEFAULT_SHORT_BREAK_MINUTES = 5;
const DEFAULT_LONG_BREAK_MINUTES = 30;

export const FOCUS_MIN_MINUTES = 25;
export const FOCUS_MAX_MINUTES = 180;
export const BREAK_MIN_MINUTES = 5;
export const BREAK_MAX_MINUTES = 60;

// Sequência de 4 ciclos: Foco -> Curto três vezes, e o 4º Foco encerra em Longo — depois
// disso o loop reinicia em Foco automaticamente. completedFocusSessions nunca é resetado;
// é o `% LONG_BREAK_EVERY` em advancePhase() que faz o loop de ciclos se repetir
// indefinidamente. Só as DURAÇÕES são customizáveis pelo usuário — a estrutura de 4
// ciclos em si é fixa.
const LONG_BREAK_EVERY = 4;

/**
 * Timer Pomodoro do fluxo principal (regra de negócio 1: Timer -> Modal de
 * Criação de Flashcard -> Recompensa em Gold/XP), com o ciclo clássico de
 * descansos: um curto após cada foco, e um longo a cada quatro focos
 * completados (ver LONG_BREAK_EVERY). As três durações (foco/curto/longo)
 * são configuráveis pelo usuário (ver updateSettings()) e persistem em
 * localStorage — client-side de propósito, é uma preferência de aparelho,
 * não precisa sincronizar entre dispositivos nem exige uma migração de banco.
 *
 * Mudar as configurações NÃO afeta uma fase que já está contando: cada fase,
 * ao começar, "congela" sua própria duração em activePhaseDurationMinutes —
 * é esse valor (não a configuração ao vivo) que dita o mostrador, o botão
 * Reiniciar e a recompensa quando a fase termina. Só a PRÓXIMA fase (depois
 * de avançar de verdade, em advancePhase()) lê a configuração atualizada.
 * Isso evita o timer "pular" de valor no meio da contagem se o usuário abrir
 * as configurações e mudar algo enquanto o relógio está rodando.
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

  readonly focusMinutesSetting = signal(DEFAULT_FOCUS_MINUTES);
  readonly shortBreakMinutesSetting = signal(DEFAULT_SHORT_BREAK_MINUTES);
  readonly longBreakMinutesSetting = signal(DEFAULT_LONG_BREAK_MINUTES);

  readonly phase = signal<PomodoroPhase>('focus');
  readonly completedFocusSessions = signal(0);
  readonly isRunning = signal(false);
  readonly remainingSeconds = signal(DEFAULT_FOCUS_MINUTES * 60);
  /** Duração (min) da fase EM ANDAMENTO, congelada no instante em que ela começou — ver comentário da classe. */
  readonly activePhaseDurationMinutes = signal(DEFAULT_FOCUS_MINUTES);

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
  readonly phaseDurationSeconds = computed(() => this.activePhaseDurationMinutes() * 60);

  constructor() {
    this.loadSettingsFromStorage();
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
    // Clicar em Iniciar/Retomar é a interação que deve calar na hora um alerta de
    // "fase concluída" que ainda estivesse repetindo (ver advancePhase()).
    this.audio.stopRepeatingAlert();
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
    // Usa a duração CONGELADA desta fase, não a configuração ao vivo — reiniciar o
    // ciclo atual não deve puxar uma customização feita depois que ele já começou.
    this.remainingSeconds.set(this.activePhaseDurationMinutes() * 60);
  }

  /** Encerra o descanso atual na marra, sem esperar o relógio zerar. */
  skipBreak(): void {
    if (!this.isBreak()) return;
    this.audio.stopRepeatingAlert();
    this.advancePhase();
  }

  consumePendingFocusReward(): number | null {
    const minutes = this.pendingFocusReward();
    this.pendingFocusReward.set(null);
    return minutes;
  }

  validateFocusMinutes(value: number): string | null {
    if (!Number.isInteger(value)) return 'Informe um número inteiro de minutos.';
    if (value < FOCUS_MIN_MINUTES || value > FOCUS_MAX_MINUTES) {
      return `O tempo de foco deve ficar entre ${FOCUS_MIN_MINUTES} e ${FOCUS_MAX_MINUTES} minutos.`;
    }
    return null;
  }

  validateBreakMinutes(value: number, label: string): string | null {
    if (!Number.isInteger(value)) return 'Informe um número inteiro de minutos.';
    if (value < BREAK_MIN_MINUTES || value > BREAK_MAX_MINUTES) {
      return `O tempo de ${label} deve ficar entre ${BREAK_MIN_MINUTES} e ${BREAK_MAX_MINUTES} minutos.`;
    }
    return null;
  }

  /**
   * Valida e aplica as três durações customizadas. Retorna a lista de erros (vazia se
   * tudo válido — nesse caso já aplicou e persistiu). Nada é salvo se houver qualquer
   * erro, pra não deixar a configuração num estado parcialmente inválido.
   */
  updateSettings(focusMinutes: number, shortBreakMinutes: number, longBreakMinutes: number): TimerSettingsValidationError[] {
    const errors: TimerSettingsValidationError[] = [];
    const focusError = this.validateFocusMinutes(focusMinutes);
    if (focusError) errors.push({ field: 'focus', message: focusError });
    const shortBreakError = this.validateBreakMinutes(shortBreakMinutes, 'descanso curto');
    if (shortBreakError) errors.push({ field: 'shortBreak', message: shortBreakError });
    const longBreakError = this.validateBreakMinutes(longBreakMinutes, 'descanso longo');
    if (longBreakError) errors.push({ field: 'longBreak', message: longBreakError });

    if (errors.length > 0) return errors;

    this.focusMinutesSetting.set(focusMinutes);
    this.shortBreakMinutesSetting.set(shortBreakMinutes);
    this.longBreakMinutesSetting.set(longBreakMinutes);
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ focusMinutes, shortBreakMinutes, longBreakMinutes } satisfies PersistedTimerSettings)
    );

    // Só vale pros próximos ciclos: se a fase atual já está rodando, não mexe nela (ver
    // comentário da classe) — só re-sincroniza o mostrador se ainda não tiver começado
    // ou estiver pausada, pra refletir a configuração nova sem esperar um novo ciclo.
    if (!this.isRunning()) {
      this.activePhaseDurationMinutes.set(this.phaseDurationMinutes(this.phase()));
      this.remainingSeconds.set(this.activePhaseDurationMinutes() * 60);
    }

    return [];
  }

  private loadSettingsFromStorage(): void {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;

    try {
      const saved: PersistedTimerSettings = JSON.parse(raw);
      if (!this.validateFocusMinutes(saved.focusMinutes)) this.focusMinutesSetting.set(saved.focusMinutes);
      if (!this.validateBreakMinutes(saved.shortBreakMinutes, '')) this.shortBreakMinutesSetting.set(saved.shortBreakMinutes);
      if (!this.validateBreakMinutes(saved.longBreakMinutes, '')) this.longBreakMinutesSetting.set(saved.longBreakMinutes);
    } catch {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
    }
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
        activePhaseDurationMinutes: this.activePhaseDurationMinutes(),
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
    if (!raw) {
      // Sem sessão em andamento salva — a fase inicial só foi inicializada com o
      // padrão até aqui; aplica a configuração customizada (se houver) recém-carregada.
      this.activePhaseDurationMinutes.set(this.phaseDurationMinutes(this.phase()));
      this.remainingSeconds.set(this.activePhaseDurationMinutes() * 60);
      return;
    }

    let saved: PersistedTimerState;
    try {
      saved = JSON.parse(raw);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    this.phase.set(saved.phase);
    this.completedFocusSessions.set(saved.completedFocusSessions);
    // Fallback pra estado salvo antes desta duração congelada existir.
    this.activePhaseDurationMinutes.set(saved.activePhaseDurationMinutes ?? this.phaseDurationMinutes(saved.phase));

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
      // Alerta repete sozinho (até silenciar numa próxima interação, ver start()/
      // skipBreak()) em vez de tocar uma vez só — o usuário pode não estar olhando
      // pra tela no instante exato em que o foco termina.
      this.audio.playRepeatingAlert(() => this.audio.playFocusComplete());
      // Recompensa usa a duração REAL desta sessão que terminou (congelada), não uma
      // configuração que possa ter mudado enquanto ela estava rodando.
      this.pendingFocusReward.set(this.activePhaseDurationMinutes());

      const completed = this.completedFocusSessions() + 1;
      this.completedFocusSessions.set(completed);

      const nextPhase: PomodoroPhase = completed % LONG_BREAK_EVERY === 0 ? 'long-break' : 'short-break';
      this.phase.set(nextPhase);
      this.activePhaseDurationMinutes.set(this.phaseDurationMinutes(nextPhase));
      this.remainingSeconds.set(this.activePhaseDurationMinutes() * 60);
    } else {
      this.audio.playRepeatingAlert(() => this.audio.playBreakComplete());
      this.phase.set('focus');
      this.activePhaseDurationMinutes.set(this.phaseDurationMinutes('focus'));
      this.remainingSeconds.set(this.activePhaseDurationMinutes() * 60);
    }
  }

  private phaseDurationMinutes(phase: PomodoroPhase): number {
    switch (phase) {
      case 'short-break':
        return this.shortBreakMinutesSetting();
      case 'long-break':
        return this.longBreakMinutesSetting();
      default:
        return this.focusMinutesSetting();
    }
  }
}

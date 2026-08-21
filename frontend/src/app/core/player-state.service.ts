import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { ErrorToastService } from './error-toast.service';
import { RewardService } from './reward.service';
import { SupabaseService } from './supabase.service';

interface UserRow {
  username: string;
  mana: number;
  xp: number;
  level: number;
  minutes_focused_today: number;
  stamina_reset_on: string;
  current_streak_days: number;
  streak_shields: number;
  last_streak_activity_on: string | null;
}

export type StreakEvent = 'shield-consumed' | 'shield-awarded' | 'streak-broken' | null;

const MANA_CAP_MINUTES = 180;
/** Quanto tempo o aviso de escudo/quebra de sequência fica visível no dashboard. */
const STREAK_EVENT_DURATION_MS = 4000;

// Curva de XP por nível — placeholder simples até o balanceamento do jogo ser definido.
function xpRequiredForLevel(level: number): number {
  return level * 500;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Um ganho real (>0) sempre mostra um traço mínimo na barra — sem isso, um
// progresso de 1% num total de 500 XP fica visualmente indistinguível de 0%.
const MIN_VISIBLE_PERCENT = 3;

function visiblePercent(current: number, total: number): number {
  const exact = Math.round((current / total) * 100);
  if (current > 0 && exact < MIN_VISIBLE_PERCENT) return MIN_VISIBLE_PERCENT;
  return Math.min(100, exact);
}

/**
 * Estado do jogador (Gold/XP/Level/Mana), persistido em public.users
 * (ver db/schema.sql). Compartilhado entre Dashboard e Revisão para que uma
 * recompensa dada em qualquer tela reflita no HUD imediatamente.
 *
 * Nomenclatura: as colunas do Supabase (`mana`, `stamina_reset_on`, etc.)
 * mantêm os nomes originais para não exigir uma migração no banco de
 * produção — o domínio do app foi renomeado (o antigo "Stamina" virou
 * "Mana", e o antigo "Mana" virou "Gold"), mas o mapeamento pra essas
 * colunas fica só aqui, na fronteira com o banco.
 */
@Injectable({ providedIn: 'root' })
export class PlayerStateService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  private readonly rewardService = inject(RewardService);
  private readonly errorToast = inject(ErrorToastService);

  private streakEventTimeout?: ReturnType<typeof setTimeout>;

  readonly username = signal('');
  readonly level = signal(1);
  readonly xp = signal(0);
  readonly gold = signal(0);
  readonly minutesFocusedToday = signal(0);
  readonly manaCapMinutes = MANA_CAP_MINUTES;
  readonly isLoaded = signal(false);

  // Sequência diária de estudo + Escudo de Ofensiva — ver streakService.js (backend).
  readonly currentStreakDays = signal(0);
  readonly streakShields = signal(0);
  readonly lastStreakActivityOn = signal<string | null>(null);
  /** Evento transitório da última mudança de sequência, pro dashboard exibir um aviso breve. */
  readonly streakEvent = signal<StreakEvent>(null);

  readonly xpToNextLevel = computed(() => xpRequiredForLevel(this.level()));
  readonly xpPercent = computed(() => visiblePercent(this.xp(), this.xpToNextLevel()));

  // A mana é tratada como um recurso que se GASTA (começa cheia, esvazia
  // com o foco do dia) — o oposto do XP, que se acumula. A barra reflete isso:
  // preenchida = energia disponível, drena conforme você estuda.
  readonly manaRemainingMinutes = computed(() => Math.max(0, this.manaCapMinutes - this.minutesFocusedToday()));
  readonly manaPercent = computed(() => visiblePercent(this.manaRemainingMinutes(), this.manaCapMinutes));
  readonly manaLevel = computed<'full' | 'low' | 'critical'>(() => {
    const pct = this.manaPercent();
    if (pct <= 15) return 'critical';
    if (pct <= 40) return 'low';
    return 'full';
  });

  readonly isInBonusWindow = computed(() => this.minutesFocusedToday() < this.manaCapMinutes);

  async loadProfile(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) return;

    const { data, error } = await this.supabase.from('users').select('*').eq('id', userId).single<UserRow>();
    if (error || !data) {
      console.error('Falha ao carregar perfil do jogador', error);
      this.errorToast.show('⚠ Não foi possível carregar seu perfil. Recarregue a página.');
      return;
    }

    // Regra Anti-Burnout: a mana reseta a cada novo dia.
    let minutesFocusedToday = data.minutes_focused_today;
    if (data.stamina_reset_on !== todayIso()) {
      minutesFocusedToday = 0;
      const { error: resetError } = await this.supabase
        .from('users')
        .update({ minutes_focused_today: 0, stamina_reset_on: todayIso() })
        .eq('id', userId);
      if (resetError) console.error('Falha ao resetar mana diária', resetError);
    }

    this.username.set(data.username);
    this.level.set(data.level);
    this.xp.set(data.xp);
    this.gold.set(data.mana);
    this.minutesFocusedToday.set(minutesFocusedToday);
    this.currentStreakDays.set(data.current_streak_days);
    this.streakShields.set(data.streak_shields);
    this.lastStreakActivityOn.set(data.last_streak_activity_on);
    this.isLoaded.set(true);
  }

  async addReward(goldEarned: number, xpEarned: number): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) return;

    let nextXp = this.xp() + xpEarned;
    let nextLevel = this.level();
    while (nextXp >= xpRequiredForLevel(nextLevel)) {
      nextXp -= xpRequiredForLevel(nextLevel);
      nextLevel += 1;
    }
    const nextGold = this.gold() + goldEarned;

    this.gold.set(nextGold);
    this.xp.set(nextXp);
    this.level.set(nextLevel);

    const { error } = await this.supabase
      .from('users')
      .update({ mana: nextGold, xp: nextXp, level: nextLevel })
      .eq('id', userId);
    if (error) {
      console.error('Falha ao salvar recompensa', error);
      this.errorToast.show('⚠ Gold/XP não foi salvo — verifique sua conexão.');
    }
  }

  async addFocusMinutes(minutes: number): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) return;

    const nextMinutes = this.minutesFocusedToday() + minutes;
    this.minutesFocusedToday.set(nextMinutes);

    const { error } = await this.supabase
      .from('users')
      .update({ minutes_focused_today: nextMinutes, stamina_reset_on: todayIso() })
      .eq('id', userId);
    if (error) {
      console.error('Falha ao salvar minutos de foco', error);
      this.errorToast.show('⚠ Seu progresso de foco não foi salvo — verifique sua conexão.');
    }

    // addFocusMinutes já é chamado em todo evento de foco que conta pra sequência
    // (Pomodoro concluído OU carta revisada) — reaproveitando esse ponto único, o
    // avanço da sequência só dispara uma vez por dia (checagem local evita um
    // round-trip ao backend a cada carta respondida no mesmo dia).
    if (this.lastStreakActivityOn() !== todayIso()) {
      await this.advanceStreakIfNeeded();
    }
  }

  private async advanceStreakIfNeeded(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) return;

    try {
      const result = await firstValueFrom(
        this.rewardService.advanceStreak(
          this.currentStreakDays(),
          this.streakShields(),
          this.lastStreakActivityOn(),
          todayIso()
        )
      );

      this.currentStreakDays.set(result.currentStreakDays);
      this.streakShields.set(result.streakShields);
      this.lastStreakActivityOn.set(result.lastStreakActivityOn);

      const event: StreakEvent = result.shieldAwarded
        ? 'shield-awarded'
        : result.shieldConsumed
          ? 'shield-consumed'
          : result.streakBroken
            ? 'streak-broken'
            : null;
      this.streakEvent.set(event);
      clearTimeout(this.streakEventTimeout);
      if (event !== null) {
        this.streakEventTimeout = setTimeout(() => this.streakEvent.set(null), STREAK_EVENT_DURATION_MS);
      }

      const { error } = await this.supabase
        .from('users')
        .update({
          current_streak_days: result.currentStreakDays,
          streak_shields: result.streakShields,
          last_streak_activity_on: result.lastStreakActivityOn,
        })
        .eq('id', userId);
      if (error) {
        console.error('Falha ao salvar sequência de estudo', error);
        this.errorToast.show('⚠ Sua sequência diária não foi atualizada.');
      }
    } catch (err) {
      // Não-crítico: se o avanço de sequência falhar (rede, backend fora do ar), o
      // resto da recompensa (Gold/XP/mana) já foi concedido normalmente antes disso.
      console.error('Falha ao avançar sequência de estudo', err);
      this.errorToast.show('⚠ Sua sequência diária não foi atualizada.');
    }
  }
}

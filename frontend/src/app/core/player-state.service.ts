import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

interface UserRow {
  username: string;
  mana: number;
  xp: number;
  level: number;
  minutes_focused_today: number;
  stamina_reset_on: string;
}

const STAMINA_BONUS_CAP_MINUTES = 180;

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
 * Estado do jogador (Mana/XP/Level/Stamina), persistido em public.users
 * (ver db/schema.sql). Compartilhado entre Dashboard e Revisão para que uma
 * recompensa dada em qualquer tela reflita no HUD imediatamente.
 */
@Injectable({ providedIn: 'root' })
export class PlayerStateService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  readonly username = signal('');
  readonly level = signal(1);
  readonly xp = signal(0);
  readonly mana = signal(0);
  readonly minutesFocusedToday = signal(0);
  readonly staminaBonusCapMinutes = STAMINA_BONUS_CAP_MINUTES;
  readonly isLoaded = signal(false);

  readonly xpToNextLevel = computed(() => xpRequiredForLevel(this.level()));
  readonly xpPercent = computed(() => visiblePercent(this.xp(), this.xpToNextLevel()));
  readonly staminaPercent = computed(() =>
    visiblePercent(this.minutesFocusedToday(), this.staminaBonusCapMinutes)
  );
  readonly isInBonusWindow = computed(() => this.minutesFocusedToday() < this.staminaBonusCapMinutes);

  async loadProfile(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) return;

    const { data, error } = await this.supabase.from('users').select('*').eq('id', userId).single<UserRow>();
    if (error || !data) {
      console.error('Falha ao carregar perfil do jogador', error);
      return;
    }

    // Regra Anti-Burnout: a stamina reseta a cada novo dia.
    let minutesFocusedToday = data.minutes_focused_today;
    if (data.stamina_reset_on !== todayIso()) {
      minutesFocusedToday = 0;
      const { error: resetError } = await this.supabase
        .from('users')
        .update({ minutes_focused_today: 0, stamina_reset_on: todayIso() })
        .eq('id', userId);
      if (resetError) console.error('Falha ao resetar stamina diária', resetError);
    }

    this.username.set(data.username);
    this.level.set(data.level);
    this.xp.set(data.xp);
    this.mana.set(data.mana);
    this.minutesFocusedToday.set(minutesFocusedToday);
    this.isLoaded.set(true);
  }

  async addReward(manaEarned: number, xpEarned: number): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) return;

    let nextXp = this.xp() + xpEarned;
    let nextLevel = this.level();
    while (nextXp >= xpRequiredForLevel(nextLevel)) {
      nextXp -= xpRequiredForLevel(nextLevel);
      nextLevel += 1;
    }
    const nextMana = this.mana() + manaEarned;

    this.mana.set(nextMana);
    this.xp.set(nextXp);
    this.level.set(nextLevel);

    const { error } = await this.supabase
      .from('users')
      .update({ mana: nextMana, xp: nextXp, level: nextLevel })
      .eq('id', userId);
    if (error) console.error('Falha ao salvar recompensa', error);
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
    if (error) console.error('Falha ao salvar minutos de foco', error);
  }
}

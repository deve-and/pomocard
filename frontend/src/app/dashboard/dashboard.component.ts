import { CommonModule } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { DeckCatalogService } from '../core/deck-catalog.service';
import { PlayerStateService } from '../core/player-state.service';
import { PomodoroTimerService } from '../core/pomodoro-timer.service';
import { RewardService } from '../core/reward.service';
import { DeckModalComponent } from '../deck-modal/deck-modal.component';
import { FlashcardDraft, FlashcardModalComponent } from '../flashcard-modal/flashcard-modal.component';
import { PomodoroTimerComponent } from '../pomodoro-timer/pomodoro-timer.component';

interface GuildRankEntry {
  username: string;
  activeDaysLast7d: number;
}

@Component({
  selector: 'pc-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, PomodoroTimerComponent, FlashcardModalComponent, DeckModalComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  readonly player = inject(PlayerStateService);
  readonly deckCatalog = inject(DeckCatalogService);
  private readonly pomodoroTimer = inject(PomodoroTimerService);
  private readonly rewardService = inject(RewardService);
  private readonly auth = inject(AuthService);

  // Guildas ainda não migraram para o Supabase (public.guild_consistency_rankings
  // já existe no schema) — próximo passo natural depois deste.
  readonly guildRanking: GuildRankEntry[] = [
    { username: 'Aventureiro', activeDaysLast7d: 6 },
    { username: 'Lyra', activeDaysLast7d: 5 },
    { username: 'Kael', activeDaysLast7d: 4 },
  ];

  // Estado do fluxo Timer -> Modal -> Recompensa
  readonly isFlashcardModalOpen = signal(false);
  readonly isSubmittingFlashcard = signal(false);
  readonly lastReward = signal<{ goldEarned: number; xpEarned: number } | null>(null);
  // 0 é um valor sentinela: nenhum Pomodoro real dura 0 minuto, então serve pra distinguir
  // "modal aberto por uma sessão concluída" de "modal aberto manualmente" (ver
  // openManualFlashcardModal) — a criação manual não passa pelo cálculo de recompensa.
  readonly pendingSessionMinutes = signal(0);

  // Criação de deck
  readonly isDeckModalOpen = signal(false);

  constructor() {
    this.player.loadProfile();
    this.deckCatalog.loadDecks();

    // O timer roda num serviço singleton (sobrevive à navegação entre rotas), então uma
    // sessão de foco pode ter terminado enquanto o dashboard estava desmontado. O effect
    // roda assim que este componente é (re)criado e pega qualquer recompensa pendente.
    effect(
      () => {
        const focusMinutes = this.pomodoroTimer.pendingFocusReward();
        if (focusMinutes !== null) {
          this.pomodoroTimer.consumePendingFocusReward();
          this.onSessionCompleted(focusMinutes);
        }
      },
      { allowSignalWrites: true }
    );
  }

  onSessionCompleted(focusMinutes: number): void {
    this.pendingSessionMinutes.set(focusMinutes);
    this.lastReward.set(null);
    this.isFlashcardModalOpen.set(true);
  }

  /** Botão "+ Nova Carta" do dashboard: mesma modal, sem esperar um Pomodoro terminar. */
  openManualFlashcardModal(): void {
    this.pendingSessionMinutes.set(0);
    this.lastReward.set(null);
    this.isFlashcardModalOpen.set(true);
  }

  onFlashcardCancel(): void {
    // O tempo de foco conta pra mana do dia mesmo sem criar a carta (só quando veio de
    // um Pomodoro de verdade — pendingSessionMinutes é 0 na criação manual, então isso
    // não desconta mana à toa), mas sem carta não há recompensa (regra 1: a recompensa
    // é atrelada à criação).
    const sessionMinutes = this.pendingSessionMinutes();
    if (sessionMinutes > 0) this.player.addFocusMinutes(sessionMinutes);
    this.isFlashcardModalOpen.set(false);
  }

  onFlashcardCreate(draft: FlashcardDraft): void {
    if (this.isSubmittingFlashcard()) return;

    const sessionMinutes = this.pendingSessionMinutes();
    if (sessionMinutes <= 0) {
      // Criação manual: não veio de um Pomodoro concluído, então não há recompensa de
      // Gold/XP nem consumo de Mana a calcular — só cria a carta.
      this.createFlashcardWithoutReward(draft);
      return;
    }

    // O cálculo de recompensa pode demorar (o backend no plano free do Render "acorda"
    // em até uns 30s quando estava ocioso). Sem essa trava, cliques repetidos no botão
    // durante essa espera disparavam uma recompensa completa a cada clique — zerando a
    // mana e inflando XP/nível como se vários Pomodoros tivessem sido concluídos.
    this.isSubmittingFlashcard.set(true);
    const minutesBefore = this.player.minutesFocusedToday();

    this.rewardService.completePomodoroSession(sessionMinutes, minutesBefore).subscribe({
      next: async ({ goldEarned, xpEarned }) => {
        await this.player.addReward(goldEarned, xpEarned);
        await this.player.addFocusMinutes(sessionMinutes);
        this.lastReward.set({ goldEarned, xpEarned });

        const deckId = draft.deckId ?? (await this.deckCatalog.createDeck(draft.newDeckTitle!))?.id;
        if (deckId) {
          await this.deckCatalog.createFlashcard(deckId, draft.front, draft.back);
        }
        this.isSubmittingFlashcard.set(false);
        this.isFlashcardModalOpen.set(false);
      },
      error: (err) => {
        console.error('Falha ao calcular recompensa do Pomodoro', err);
        this.isSubmittingFlashcard.set(false);
        this.isFlashcardModalOpen.set(false);
      },
    });
  }

  private async createFlashcardWithoutReward(draft: FlashcardDraft): Promise<void> {
    this.isSubmittingFlashcard.set(true);
    const deckId = draft.deckId ?? (await this.deckCatalog.createDeck(draft.newDeckTitle!))?.id;
    if (deckId) {
      await this.deckCatalog.createFlashcard(deckId, draft.front, draft.back);
    }
    this.isSubmittingFlashcard.set(false);
    this.isFlashcardModalOpen.set(false);
  }

  onDeckCreate(title: string): void {
    this.isDeckModalOpen.set(false);
    this.deckCatalog.createDeck(title);
  }

  signOut(): void {
    this.auth.signOut();
  }
}

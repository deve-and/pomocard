import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { DeckCatalogService } from '../core/deck-catalog.service';
import { PlayerStateService } from '../core/player-state.service';
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
  readonly lastReward = signal<{ manaEarned: number; xpEarned: number } | null>(null);
  readonly pendingSessionMinutes = signal(0);

  // Criação de deck
  readonly isDeckModalOpen = signal(false);

  constructor() {
    this.player.loadProfile();
    this.deckCatalog.loadDecks();
  }

  onSessionCompleted(focusMinutes: number): void {
    this.pendingSessionMinutes.set(focusMinutes);
    this.lastReward.set(null);
    this.isFlashcardModalOpen.set(true);
  }

  onFlashcardCancel(): void {
    // O tempo de foco conta para a stamina do dia mesmo sem criar a carta,
    // mas sem carta não há recompensa (regra 1: a recompensa é atrelada à criação).
    this.player.addFocusMinutes(this.pendingSessionMinutes());
    this.isFlashcardModalOpen.set(false);
  }

  onFlashcardCreate(draft: FlashcardDraft): void {
    const minutesBefore = this.player.minutesFocusedToday();
    const sessionMinutes = this.pendingSessionMinutes();

    this.rewardService.completePomodoroSession(sessionMinutes, minutesBefore).subscribe({
      next: async ({ manaEarned, xpEarned }) => {
        await this.player.addReward(manaEarned, xpEarned);
        await this.player.addFocusMinutes(sessionMinutes);
        this.lastReward.set({ manaEarned, xpEarned });

        const deckId = draft.deckId ?? (await this.deckCatalog.createDeck(draft.newDeckTitle!))?.id;
        if (deckId) {
          await this.deckCatalog.createFlashcard(deckId, draft.front, draft.back);
        }
        this.isFlashcardModalOpen.set(false);
      },
      error: (err) => {
        console.error('Falha ao calcular recompensa do Pomodoro', err);
        this.isFlashcardModalOpen.set(false);
      },
    });
  }

  onDeckCreate(title: string): void {
    this.isDeckModalOpen.set(false);
    this.deckCatalog.createDeck(title);
  }

  signOut(): void {
    this.auth.signOut();
  }
}

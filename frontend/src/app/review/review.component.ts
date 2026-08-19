import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DeckCatalogService, ReviewCard } from '../core/deck-catalog.service';
import { PlayerStateService } from '../core/player-state.service';
import { RewardService } from '../core/reward.service';

// Minutos de foco atribuídos a cada carta revisada — usado como entrada do
// Mana Service (backend), que sempre pondera tempo de foco x dificuldade x stamina.
const REVIEW_MINUTES_PER_CARD = 1;
const REWARD_CHIP_DURATION_MS = 1500;

/**
 * Fila de revisão SM-2 (regra de negócio 3): mostra a frente da carta,
 * revela o verso com um flip, e o usuário classifica o recall (Errei /
 * Difícil / Bom / Fácil). "Difícil" é a Boss Battle da regra de negócio —
 * paga mais Mana por exigir mais esforço de memória.
 */
@Component({
  selector: 'pc-review',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './review.component.html',
  styleUrl: './review.component.scss',
})
export class ReviewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly deckCatalog = inject(DeckCatalogService);
  private readonly rewardService = inject(RewardService);
  readonly player = inject(PlayerStateService);

  readonly deckId = signal('');
  readonly deckTitle = computed(() => this.deckCatalog.getDeckTitle(this.deckId()));

  readonly isLoading = signal(true);
  readonly queue = signal<ReviewCard[]>([]);
  readonly totalCount = signal(0);
  readonly isRevealed = signal(false);
  readonly isSubmitting = signal(false);
  readonly sessionManaEarned = signal(0);
  readonly lastCardMana = signal<number | null>(null);

  readonly currentCard = computed<ReviewCard | null>(() => this.queue()[0] ?? null);
  readonly remainingCount = computed(() => this.queue().length);
  readonly completedCount = computed(() => this.totalCount() - this.remainingCount());
  readonly progressPercent = computed(() =>
    this.totalCount() === 0 ? 0 : Math.round((this.completedCount() / this.totalCount()) * 100)
  );
  readonly isSessionComplete = computed(() => this.totalCount() > 0 && this.remainingCount() === 0);

  constructor() {
    this.route.paramMap.subscribe(async (params) => {
      const id = params.get('deckId') ?? '';
      this.deckId.set(id);
      this.isLoading.set(true);
      const cards = await this.deckCatalog.getDueCards(id);
      this.queue.set(cards);
      this.totalCount.set(cards.length);
      this.isLoading.set(false);
    });
  }

  reveal(): void {
    this.isRevealed.set(true);
  }

  async rate(quality: number): Promise<void> {
    const card = this.currentCard();
    if (!card || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    const minutesBefore = this.player.minutesFocusedToday();

    try {
      const { manaEarned, schedule } = await firstValueFrom(
        this.rewardService.submitReview(quality, card.srsState, REVIEW_MINUTES_PER_CARD, minutesBefore)
      );

      // A revisão paga em Mana (peso de dificuldade); XP fica reservado à
      // criação da carta, conforme o fluxo principal (regra de negócio 1).
      await this.player.addReward(manaEarned, 0);
      await this.player.addFocusMinutes(REVIEW_MINUTES_PER_CARD);
      this.sessionManaEarned.update((total) => total + manaEarned);

      this.lastCardMana.set(manaEarned);
      setTimeout(() => this.lastCardMana.set(null), REWARD_CHIP_DURATION_MS);

      // A carta local precisa carregar o novo srsState retornado pelo backend: se ela for
      // requeued (errou) e revisada de novo nesta mesma sessão, o próximo cálculo de SM-2
      // tem que partir do estado pós-erro, não do estado com que a sessão começou.
      const updatedCard = {
        ...card,
        srsState: {
          easinessFactor: schedule.easinessFactor,
          repetitions: schedule.repetitions,
          intervalDays: schedule.intervalDays,
        },
      };
      await this.deckCatalog.submitCardReview(updatedCard, quality, schedule, manaEarned);

      if (quality < 3) {
        // Errou: a carta é a "Boss Battle" da sessão — continua na fila e volta pro topo,
        // sempre a próxima a ser lida, até ser vencida.
        this.queue.update((cards) => [updatedCard, ...cards.slice(1)]);
      } else {
        // Acertou: sai da rotação desta sessão (equivalente a ir pro fim do baralho — não
        // volta a aparecer hoje).
        this.queue.update((cards) => cards.slice(1));
      }
      this.isRevealed.set(false);
    } catch (err) {
      console.error('Falha ao registrar revisão', err);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  backToDashboard(): void {
    this.router.navigate(['/']);
  }
}

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DeckCatalogService, ReviewCard } from '../core/deck-catalog.service';
import { PlayerStateService } from '../core/player-state.service';
import { RewardService } from '../core/reward.service';

// Minutos de foco atribuídos a cada carta revisada — usado como entrada do
// Gold Service (backend), que sempre pondera tempo de foco x dificuldade x mana.
const REVIEW_MINUTES_PER_CARD = 1;
const REWARD_CHIP_DURATION_MS = 1500;

/**
 * Fila de revisão Leitner (regra de negócio 3): mostra a frente da carta,
 * revela o verso com um flip, e o usuário classifica o recall (Errou /
 * Difícil / Médio / Fácil). "Difícil" é a Boss Battle da regra de negócio —
 * paga mais Gold por exigir mais esforço de memória.
 *
 * Fila prioritária: "Errou" é prioridade máxima e volta pro INÍCIO da fila local
 * (`queue`) — é a próxima carta a aparecer, sem esperar as outras. Uma carta que já
 * tinha sido considerada fácil noutra revisão desta sessão, se errada agora, também
 * salta pro início como qualquer erro (o estado dela não guarda "nível anterior", só
 * o resultado mais recente). O loop só encerra de duas formas: a fila esvazia (todas
 * as cartas foram acertadas nesta sessão) ou o usuário sai manualmente pelo botão
 * "Dashboard" no cabeçalho, salvando o progresso parcial (cada resposta já foi
 * persistida individualmente em submitCardReview, não existe um "salvar no final").
 *
 * Isso é feito só com reatribuição de array num signal — nenhuma
 * assinatura/timer fica presa a uma carta específica, então não há nada pra
 * vazar por causa da fila em si. O único recurso com ciclo de vida próprio é
 * o setTimeout do toast de recompensa (ver rate()), por isso o handle é
 * guardado e limpo em ngOnDestroy: se o usuário sair do loop bem no instante
 * em que o toast estava de saída, o timer não fica "vivo" segurando uma
 * referência ao componente já destruído.
 */
@Component({
  selector: 'pc-review',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './review.component.html',
  styleUrl: './review.component.scss',
})
export class ReviewComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly deckCatalog = inject(DeckCatalogService);
  private readonly rewardService = inject(RewardService);
  readonly player = inject(PlayerStateService);

  private rewardChipTimeout?: ReturnType<typeof setTimeout>;

  readonly deckId = signal('');
  readonly deckTitle = computed(() => this.deckCatalog.getDeckTitle(this.deckId()));

  readonly isLoading = signal(true);
  readonly queue = signal<ReviewCard[]>([]);
  readonly totalCount = signal(0);
  readonly isRevealed = signal(false);
  readonly isSubmitting = signal(false);
  readonly sessionGoldEarned = signal(0);
  readonly lastCardGold = signal<number | null>(null);

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
      const { goldEarned, schedule } = await firstValueFrom(
        this.rewardService.submitReview(
          quality,
          card.srsState,
          REVIEW_MINUTES_PER_CARD,
          minutesBefore,
          card.lastGoldAwardedAt
        )
      );

      // A revisão paga em Gold (peso de dificuldade); XP fica reservado à
      // criação da carta, conforme o fluxo principal (regra de negócio 1).
      await this.player.addReward(goldEarned, 0);
      await this.player.addFocusMinutes(REVIEW_MINUTES_PER_CARD);
      this.sessionGoldEarned.update((total) => total + goldEarned);

      this.lastCardGold.set(goldEarned);
      clearTimeout(this.rewardChipTimeout);
      this.rewardChipTimeout = setTimeout(() => this.lastCardGold.set(null), REWARD_CHIP_DURATION_MS);

      // A carta local precisa carregar o novo srsState retornado pelo backend: se ela for
      // requeued (errou) e revisada de novo nesta mesma sessão, o próximo cálculo de agendamento
      // tem que partir do estado pós-erro, não do estado com que a sessão começou.
      const updatedCard = {
        ...card,
        srsState: {
          easinessFactor: schedule.easinessFactor,
          repetitions: schedule.repetitions,
          intervalDays: schedule.intervalDays,
        },
        // Só avança se o Gold foi realmente pago agora — permanece igual quando zerou por
        // erro ou por cooldown, senão o próximo acerto seria bloqueado à toa.
        lastGoldAwardedAt: goldEarned > 0 ? new Date().toISOString() : card.lastGoldAwardedAt,
      };
      await this.deckCatalog.submitCardReview(updatedCard, quality, schedule, goldEarned);

      if (quality < 3) {
        // Errou: volta pra Caixa 1 (ver srsService no backend) e é a prioridade máxima do
        // loop de estudo ativo — salta pro INÍCIO da fila da sessão, é a próxima a aparecer.
        this.queue.update((cards) => [updatedCard, ...cards.slice(1)]);
      } else {
        // Acertou: sobe uma Caixa e sai da rotação desta sessão — já tem uma nova data
        // de agendamento salva, não volta a aparecer hoje.
        this.queue.update((cards) => cards.slice(1));
      }
      this.isRevealed.set(false);
    } catch (err) {
      console.error('Falha ao registrar revisão', err);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  /** Sai do loop de revisão manualmente — uma das duas condições de saída (a outra é acertar tudo). */
  backToDashboard(): void {
    this.router.navigate(['/']);
  }

  ngOnDestroy(): void {
    clearTimeout(this.rewardChipTimeout);
  }
}

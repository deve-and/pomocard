import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AudioService } from '../core/audio.service';
import { DeckCatalogService, ReviewCard } from '../core/deck-catalog.service';
import { ErrorToastService } from '../core/error-toast.service';
import { PlayerStateService } from '../core/player-state.service';
import { RewardService } from '../core/reward.service';

// Minutos de foco atribuídos a cada carta revisada — usado como entrada do
// Gold Service (backend), que sempre pondera tempo de foco x dificuldade x mana.
const REVIEW_MINUTES_PER_CARD = 1;
const REWARD_CHIP_DURATION_MS = 1500;
// Duração da transição "Emboscada" ao entrar numa fila com cartas pendentes —
// curta o bastante pra não atrasar o estudo, longa o bastante pra ser lida.
const AMBUSH_DURATION_MS = 900;

// A UI só tem dois botões (Acertei/Errei) — internamente ainda mandamos uma nota
// 0-5 pro backend (Leitner + Gold já entendem essa escala), só fixamos os dois
// valores que uma resposta binária pode gerar: "Médio" pro acerto, "Errou" pro erro.
const ACERTEI_QUALITY = 4;
const ERREI_QUALITY = 1;

// Ao errar, a carta não pode reaparecer imediatamente (decoreba de curto prazo) nem
// sumir de vista — salta de 2 a 3 cartas à frente na fila, uma posição intermediária.
const ERROR_RESPACE_MIN_GAP = 2;
const ERROR_RESPACE_MAX_GAP = 3;

interface MonsterFlavor {
  icon: string;
  label: string;
}

// Reaproveita a Caixa Leitner (srsState.repetitions, 1 a 5 — ver srsService.js no
// backend) como "nível de ameaça" puramente decorativo: caixa baixa = carta ainda
// mal fixada = monstro fraco e comum; caixa alta = quase dominada = chefão raro.
// Nenhum dado novo, só uma leitura RPG do que a Caixa já significa.
const MONSTER_BY_BOX_LEVEL: Record<number, MonsterFlavor> = {
  1: { icon: '👻', label: 'Fantasma da Dúvida' },
  2: { icon: '🗡️', label: 'Goblin Batedor' },
  3: { icon: '🛡️', label: 'Guerreiro Veterano' },
  4: { icon: '🐺', label: 'Licantropo Ancião' },
  5: { icon: '🐉', label: 'Chefão da Memória' },
};

function resolveMonster(boxLevel: number): MonsterFlavor {
  return MONSTER_BY_BOX_LEVEL[boxLevel] ?? MONSTER_BY_BOX_LEVEL[1];
}

/**
 * Fila de revisão contínua (regra de negócio 3): mostra a frente da carta, revela o
 * verso com um flip, e o usuário classifica o recall com só duas opções — Acertei /
 * Errei. Estudo disponível a qualquer momento, sem depender de "cartas devidas": a
 * fila carrega TODAS as cartas do baralho (ver getDeckFlashcards), não só as
 * agendadas pra hoje.
 *
 * Loop infinito por design — nada é removido da fila, só reordenado, então ela
 * nunca esvazia sozinha (a única saída é o botão "Dashboard" no cabeçalho, que
 * salva o progresso parcial: cada resposta já foi persistida individualmente em
 * submitCardReview, não existe um "salvar no final"):
 *   - Acertar manda a carta pro FINAL da fila — reforço contínuo, mas menor
 *     prioridade que o resto.
 *   - Errar reinsere a carta de 2 a 3 posições à frente (semi-aleatório) em vez de
 *     repeti-la na hora — evita decoreba de curto prazo — exceto se ela for a
 *     única carta restante, caso em que repete em sequência mesmo.
 *   - Uma carta ainda não respondida nesta sessão nunca é tocada por essas regras,
 *     então naturalmente fica à frente das que já geraram Acertei/Errei.
 *
 * Cooldown de Gold: além do cooldown de 24h por carta (calculado no backend a
 * partir de lastGoldAwardedAt), uma carta que já errou NESTA sessão fica "marcada"
 * (failedThisSessionIds) e não paga Gold nem se acertada depois — só volta a valer
 * Gold numa sessão futura. O agendamento Leitner continua avançando normalmente
 * nos dois casos (ganho educativo), só o Gold é que fica de fora.
 *
 * Isso é feito só com reatribuição de array num signal — nenhuma assinatura/timer
 * fica presa a uma carta específica, então não há nada pra vazar por causa da fila
 * em si. O único recurso com ciclo de vida próprio é o setTimeout do toast de
 * recompensa (ver rate()), por isso o handle é guardado e limpo em ngOnDestroy: se
 * o usuário sair do loop bem no instante em que o toast estava de saída, o timer
 * não fica "vivo" segurando uma referência ao componente já destruído.
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
  private readonly audioService = inject(AudioService);
  private readonly errorToast = inject(ErrorToastService);
  readonly player = inject(PlayerStateService);

  private rewardChipTimeout?: ReturnType<typeof setTimeout>;
  private ambushTimeout?: ReturnType<typeof setTimeout>;
  /** Cartas que já erraram nesta sessão — zeram Gold mesmo se acertadas depois (ver rate()). */
  private readonly failedThisSessionIds = new Set<string>();

  readonly deckId = signal('');
  readonly deckTitle = computed(() => this.deckCatalog.getDeckTitle(this.deckId()));

  readonly isLoading = signal(true);
  readonly queue = signal<ReviewCard[]>([]);
  readonly isRevealed = signal(false);
  readonly isSubmitting = signal(false);
  readonly sessionGoldEarned = signal(0);
  readonly lastCardGold = signal<number | null>(null);
  /** true quando o Gold acabado de mostrar em lastCardGold veio de um loot crítico (ver rate()). */
  readonly lastCardCritical = signal(false);
  /** Ato II: breve transição de "monstros emergindo" ao entrar numa fila com cartas — ver triggerAmbush(). */
  readonly isAmbushActive = signal(false);

  readonly currentCard = computed<ReviewCard | null>(() => this.queue()[0] ?? null);
  readonly isEmpty = computed(() => !this.isLoading() && this.queue().length === 0);
  readonly currentMonster = computed(() => resolveMonster(this.currentCard()?.srsState.repetitions ?? 1));
  /** Pips fixos de 1 a 5 pro indicador de Caixa Leitner do cabeçalho da carta. */
  readonly boxPips = [1, 2, 3, 4, 5];

  constructor() {
    this.route.paramMap.subscribe(async (params) => {
      const id = params.get('deckId') ?? '';
      this.deckId.set(id);
      this.isLoading.set(true);
      // Todas as cartas do baralho, não só as devidas — estudo disponível a
      // qualquer momento, sem bloqueio por horário ou limite diário.
      const cards = await this.deckCatalog.getDeckFlashcards(id);
      this.queue.set(cards);
      this.isLoading.set(false);
      if (cards.length > 0) this.triggerAmbush();
    });
  }

  /**
   * Ato II do loop de 3 atos (Foco → Emboscada → Batalha): um susto sonoro/visual
   * curto ao entrar na fila, coerente com a leitura de "cartas pendentes = monstros
   * emergindo da curva do esquecimento". Puramente decorativo — não atrasa nem
   * bloqueia a leitura da primeira carta além da duração fixa da transição.
   */
  private triggerAmbush(): void {
    this.isAmbushActive.set(true);
    this.audioService.playEncounter();
    clearTimeout(this.ambushTimeout);
    this.ambushTimeout = setTimeout(() => this.isAmbushActive.set(false), AMBUSH_DURATION_MS);
  }

  reveal(): void {
    this.isRevealed.set(true);
  }

  async rate(isCorrect: boolean): Promise<void> {
    const card = this.currentCard();
    if (!card || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    const minutesBefore = this.player.minutesFocusedToday();
    const quality = isCorrect ? ACERTEI_QUALITY : ERREI_QUALITY;

    try {
      const { goldEarned, schedule, isCritical } = await firstValueFrom(
        this.rewardService.submitReview(
          quality,
          card.srsState,
          REVIEW_MINUTES_PER_CARD,
          minutesBefore,
          card.lastGoldAwardedAt
        )
      );

      // Errar "contamina" a carta pro resto da sessão: mesmo que ela seja acertada
      // numa tentativa seguinte hoje, não paga Gold de novo até a próxima sessão.
      const wasAlreadyTaintedThisSession = this.failedThisSessionIds.has(card.id);
      if (!isCorrect) this.failedThisSessionIds.add(card.id);
      const effectiveGoldEarned = isCorrect && !wasAlreadyTaintedThisSession ? goldEarned : 0;
      // Sem crítico "vazio": só conta se o Gold que ele dobrou foi de fato pago —
      // uma carta contaminada nesta sessão não deve comemorar um crítico que virou 0.
      const effectiveIsCritical = effectiveGoldEarned > 0 && isCritical;

      // A revisão paga em Gold (peso de dificuldade); XP fica reservado à
      // criação da carta, conforme o fluxo principal (regra de negócio 1).
      await this.player.addReward(effectiveGoldEarned, 0);
      await this.player.addFocusMinutes(REVIEW_MINUTES_PER_CARD);
      this.sessionGoldEarned.update((total) => total + effectiveGoldEarned);

      if (effectiveIsCritical) this.audioService.playCritical();

      this.lastCardGold.set(effectiveGoldEarned);
      this.lastCardCritical.set(effectiveIsCritical);
      clearTimeout(this.rewardChipTimeout);
      this.rewardChipTimeout = setTimeout(() => {
        this.lastCardGold.set(null);
        this.lastCardCritical.set(false);
      }, REWARD_CHIP_DURATION_MS);

      // A carta local precisa carregar o novo srsState retornado pelo backend, senão o
      // próximo cálculo de agendamento desta mesma carta partiria do estado desatualizado.
      const updatedCard: ReviewCard = {
        ...card,
        srsState: {
          easinessFactor: schedule.easinessFactor,
          repetitions: schedule.repetitions,
          intervalDays: schedule.intervalDays,
        },
        // Só avança quando o Gold foi de fato pago agora (effectiveGoldEarned, não o valor
        // bruto do backend) — senão o cooldown de 24h reiniciaria sem ter pago nada.
        lastGoldAwardedAt: effectiveGoldEarned > 0 ? new Date().toISOString() : card.lastGoldAwardedAt,
      };
      await this.deckCatalog.submitCardReview(updatedCard, quality, schedule, effectiveGoldEarned);

      this.queue.update((cards) => {
        const remaining = cards.slice(1);
        return isCorrect ? [...remaining, updatedCard] : this.reinsertMissedCard(remaining, updatedCard);
      });
      this.isRevealed.set(false);
    } catch (err) {
      console.error('Falha ao registrar revisão', err);
      this.errorToast.show('⚠ Não foi possível registrar sua resposta. Tente novamente.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  /**
   * Reinsere uma carta errada de 2 a 3 posições à frente na fila restante — nem
   * repete na hora (decoreba), nem desaparece pro final. Se não sobrar carta
   * nenhuma pra "pular na frente", a exceção do requisito se aplica: ela repete
   * em sequência mesmo (era a única carta restante).
   */
  private reinsertMissedCard(remaining: ReviewCard[], card: ReviewCard): ReviewCard[] {
    if (remaining.length === 0) return [card];
    const gapRange = ERROR_RESPACE_MAX_GAP - ERROR_RESPACE_MIN_GAP + 1;
    const gap = Math.min(remaining.length, ERROR_RESPACE_MIN_GAP + Math.floor(Math.random() * gapRange));
    return [...remaining.slice(0, gap), card, ...remaining.slice(gap)];
  }

  /** Única forma de sair do loop de estudo contínuo — ele nunca termina sozinho. */
  backToDashboard(): void {
    this.router.navigate(['/']);
  }

  ngOnDestroy(): void {
    clearTimeout(this.rewardChipTimeout);
    clearTimeout(this.ambushTimeout);
  }
}

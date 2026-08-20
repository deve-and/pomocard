'use strict';

/**
 * Spaced Repetition Service — Sistema Leitner adaptativo (5 caixas).
 * Recebe o estado atual de uma carta (public.flashcards) e a nota de
 * recall dada pelo usuário na revisão (0-5, mas só 4 níveis chegam da UI:
 * 1 = Errou, 3 = Difícil, 4 = Médio, 5 = Fácil), e devolve o novo estado
 * (easiness_factor, repetitions, interval_days, next_review_at) a ser
 * persistido. A nota também é o insumo de `goldService.calculateGoldReward`
 * ("Boss Battle" pra cartas difíceis).
 *
 * Nomenclatura: a coluna `repetitions` do Supabase guarda o Nível da Caixa
 * Leitner (1-5) — o nome da coluna ficou do algoritmo antigo (SM-2) e não
 * foi renomeado pra não exigir migração; internamente aqui ela já é tratada
 * como "Caixa" (mesmo padrão usado pra Mana/Gold em player-state.service.ts
 * no frontend). Cartas antigas gravadas com repetitions = 0 (o "zero" do
 * SM-2) são lidas como Caixa 1 — ver `readBoxLevel`.
 */

const MIN_EASINESS_FACTOR = 1.3;
const DEFAULT_EASINESS_FACTOR = 2.5;
const MIN_BOX_LEVEL = 1;
const MAX_BOX_LEVEL = 5;
const MIN_INTERVAL_DAYS = 1;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Intervalo inicial (em dias) ao entrar numa caixa pela primeira vez — usado só
 * quando a carta ainda não tem um intervalo anterior > 0 pra multiplicar (ou
 * seja, o primeiro acerto da vida da carta). Progressão clássica de Leitner:
 * cada caixa dobra o espaçamento da anterior.
 */
const BASE_INTERVAL_DAYS_BY_BOX = Object.freeze({ 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 });

/**
 * Ajuste aplicado ao Fator de Facilidade por nível de acerto (drift, estilo
 * SM-2: "Difícil" reduz a facilidade futura, "Fácil" aumenta) e o peso usado
 * SÓ nesta revisão pra multiplicar o intervalo — ver `calculateGrowthInterval`.
 * "Médio" não altera nem acelera nem desacelera: é o ritmo de referência.
 */
const PERFORMANCE_LEVELS = Object.freeze({
  3: { name: 'hard', easeDelta: -0.15, intervalWeight: 0.8 }, // Difícil
  4: { name: 'medium', easeDelta: 0, intervalWeight: 1.0 }, // Médio
  5: { name: 'easy', easeDelta: 0.15, intervalWeight: 1.3 }, // Fácil
});

function readBoxLevel(rawRepetitions) {
  return Math.min(MAX_BOX_LEVEL, Math.max(MIN_BOX_LEVEL, rawRepetitions || MIN_BOX_LEVEL));
}

/**
 * @typedef {Object} CardScheduleState
 * @property {number} easinessFactor Fator de Facilidade atual da carta (>= 1.3).
 * @property {number} repetitions    Nível da Caixa Leitner atual (1-5) — ver nota de nomenclatura acima.
 * @property {number} intervalDays   Intervalo atual, em dias, até a próxima revisão.
 */

/**
 * Calcula o próximo estado de agendamento de uma carta pelo Sistema Leitner.
 *
 * @param {Object} params
 * @param {number} params.quality          Nota de recall desta revisão (0-5; < 3 é "Errou").
 * @param {CardScheduleState} params.currentState Estado atual da carta.
 * @param {Date} [params.reviewedAt]        Momento da revisão (default: agora).
 * @returns {CardScheduleState & { nextReviewAt: Date }}
 */
function scheduleNextReview({ quality, currentState, reviewedAt = new Date() }) {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new RangeError(`quality deve ser um inteiro entre 0 e 5, recebido: ${quality}`);
  }

  const { easinessFactor = DEFAULT_EASINESS_FACTOR, repetitions, intervalDays = 0 } = currentState ?? {};
  const currentBox = readBoxLevel(repetitions);

  if (quality < 3) {
    // Errou: volta pra Caixa 1 e o intervalo futuro é resetado ao mínimo. O Fator de
    // Facilidade não muda aqui — só os níveis de acerto ajustam ele (ver PERFORMANCE_LEVELS).
    return {
      easinessFactor,
      repetitions: MIN_BOX_LEVEL,
      intervalDays: MIN_INTERVAL_DAYS,
      nextReviewAt: new Date(reviewedAt.getTime() + MIN_INTERVAL_DAYS * MS_PER_DAY),
    };
  }

  const level = PERFORMANCE_LEVELS[quality];
  const nextEasinessFactor = Math.max(MIN_EASINESS_FACTOR, roundTo(easinessFactor + level.easeDelta, 2));
  const nextBox = Math.min(MAX_BOX_LEVEL, currentBox + 1);
  const nextIntervalDays =
    intervalDays > 0
      ? Math.max(MIN_INTERVAL_DAYS, Math.round(intervalDays * easinessFactor * level.intervalWeight))
      : BASE_INTERVAL_DAYS_BY_BOX[nextBox];

  return {
    easinessFactor: nextEasinessFactor,
    repetitions: nextBox,
    intervalDays: nextIntervalDays,
    nextReviewAt: new Date(reviewedAt.getTime() + nextIntervalDays * MS_PER_DAY),
  };
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

module.exports = {
  MIN_EASINESS_FACTOR,
  DEFAULT_EASINESS_FACTOR,
  MIN_BOX_LEVEL,
  MAX_BOX_LEVEL,
  MIN_INTERVAL_DAYS,
  BASE_INTERVAL_DAYS_BY_BOX,
  scheduleNextReview,
};

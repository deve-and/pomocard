'use strict';

/**
 * Spaced Repetition Service — algoritmo SM-2 (SuperMemo 2)
 * Recebe o estado atual de uma carta (public.flashcards) e a nota de
 * recall (0-5) dada pelo usuário na revisão, e devolve o novo estado
 * (easiness_factor, repetitions, interval_days, next_review_at) a ser
 * persistido. A nota também é o insumo de `goldService.calculateGoldReward`
 * para determinar a recompensa de Mana da revisão ("Boss Battle").
 */

const MIN_EASINESS_FACTOR = 1.3;
const DEFAULT_EASINESS_FACTOR = 2.5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} CardScheduleState
 * @property {number} easinessFactor  Fator de facilidade atual da carta (>= 1.3).
 * @property {number} repetitions     Número de revisões corretas consecutivas.
 * @property {number} intervalDays    Intervalo atual, em dias, até a próxima revisão.
 */

/**
 * Calcula o próximo estado de agendamento de uma carta pelo algoritmo SM-2.
 *
 * @param {Object} params
 * @param {number} params.quality          Nota de recall desta revisão (0-5).
 * @param {CardScheduleState} params.currentState Estado atual da carta.
 * @param {Date} [params.reviewedAt]        Momento da revisão (default: agora).
 * @returns {CardScheduleState & { nextReviewAt: Date }}
 */
function scheduleNextReview({ quality, currentState, reviewedAt = new Date() }) {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new RangeError(`quality deve ser um inteiro entre 0 e 5, recebido: ${quality}`);
  }

  const { easinessFactor = DEFAULT_EASINESS_FACTOR, repetitions = 0, intervalDays = 0 } = currentState ?? {};

  // Fórmula original do SM-2 para o novo Easiness Factor.
  const rawEasinessFactor =
    easinessFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const nextEasinessFactor = Math.max(MIN_EASINESS_FACTOR, roundTo(rawEasinessFactor, 2));

  let nextRepetitions;
  let nextIntervalDays;

  if (quality < 3) {
    // Falha no recall: a carta "perdeu a batalha" e volta para o início da fila,
    // mas mantém o easiness factor (levemente reduzido) ganho em revisões passadas.
    nextRepetitions = 0;
    nextIntervalDays = 1;
  } else {
    nextRepetitions = repetitions + 1;
    if (nextRepetitions === 1) {
      nextIntervalDays = 1;
    } else if (nextRepetitions === 2) {
      nextIntervalDays = 6;
    } else {
      nextIntervalDays = Math.round(intervalDays * nextEasinessFactor);
    }
  }

  return {
    easinessFactor: nextEasinessFactor,
    repetitions: nextRepetitions,
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
  scheduleNextReview,
};

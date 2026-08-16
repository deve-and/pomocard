'use strict';

/**
 * Mana Service
 * Calcula a Mana concedida ao final de uma sessão Pomodoro / revisão de carta,
 * combinando três fatores das regras de negócio do Pomocard:
 *   1. Tempo de foco (minutos do timer Pomodoro)
 *   2. Peso da dificuldade da carta (nota SM-2 — cartas difíceis pagam mais, "Boss Battle")
 *   3. Multiplicador de Stamina diária (bônus de 100% nas primeiras 3h/dia, com
 *      redução progressiva depois disso — regra Anti-Burnout)
 */

/** Mana base concedida por minuto de foco, antes dos multiplicadores. */
const BASE_MANA_PER_MINUTE = 2;

/**
 * Peso de dificuldade por nota SM-2 (0 a 5).
 * Notas < 3 são "falha" (a carta não foi vencida) e rendem apenas uma
 * recompensa de consolação. Notas 3-5 são "vitórias", e quanto mais difícil
 * o recall (nota mais baixa dentro da faixa de acerto), maior o prêmio —
 * mesma lógica de uma Boss Battle: adversário mais difícil, mais loot.
 */
const DIFFICULTY_WEIGHTS = Object.freeze({
  0: 0.1, // blackout total
  1: 0.1, // incorreto, lembrete parecia familiar
  2: 0.15, // incorreto, mas fácil de lembrar ao ver a resposta
  3: 2.0, // correto, com sério esforço ("Hard" — Boss Battle)
  4: 1.0, // correto, com alguma hesitação ("Good")
  5: 0.5, // correto, resposta perfeita e imediata ("Easy")
});

/**
 * Tetos de stamina diária (em minutos acumulados de foco no dia) e o
 * multiplicador de mana aplicado dentro de cada faixa. As faixas são
 * cumulativas e percorridas em ordem — ver `getStaminaMultiplier`.
 *
 *   0 – 180 min  (0-3h): x2.0  -> bônus de 100% (regra Anti-Burnout)
 * 180 – 240 min  (3-4h): x1.0  -> ritmo normal
 * 240 – 300 min  (4-5h): x0.5  -> redução progressiva
 *      300+ min  (5h+ ): x0.25 -> fadiga, desestimula grind excessivo
 */
const STAMINA_TIERS = Object.freeze([
  { upToMinute: 180, multiplier: 2.0 },
  { upToMinute: 240, multiplier: 1.0 },
  { upToMinute: 300, multiplier: 0.5 },
  { upToMinute: Infinity, multiplier: 0.25 },
]);

/**
 * Retorna o peso de dificuldade para uma nota SM-2 (0-5).
 * @param {number} quality
 * @returns {number}
 */
function getDifficultyWeight(quality) {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new RangeError(`quality deve ser um inteiro entre 0 e 5, recebido: ${quality}`);
  }
  return DIFFICULTY_WEIGHTS[quality];
}

/**
 * Calcula o multiplicador médio de stamina para uma sessão de `focusMinutes`
 * que começa depois que o usuário já acumulou `minutesBeforeSession` minutos
 * de foco no dia. Quando a sessão atravessa mais de uma faixa de stamina, o
 * multiplicador é a média ponderada pelos minutos gastos em cada faixa —
 * evita que uma sessão longa "escape" para a faixa de bônus inteira.
 *
 * @param {number} minutesBeforeSession minutos já focados hoje antes desta sessão
 * @param {number} focusMinutes duração da sessão atual em minutos
 * @returns {number} multiplicador médio (ex.: 1.4)
 */
function getStaminaMultiplier(minutesBeforeSession, focusMinutes) {
  let cursor = minutesBeforeSession;
  const sessionEnd = minutesBeforeSession + focusMinutes;
  let weightedMultiplierSum = 0;

  for (const tier of STAMINA_TIERS) {
    if (cursor >= sessionEnd) break;
    if (tier.upToMinute <= cursor) continue; // sessão já começou depois desta faixa
    const tierEnd = Math.min(tier.upToMinute, sessionEnd);
    weightedMultiplierSum += (tierEnd - cursor) * tier.multiplier;
    cursor = tierEnd;
  }

  return weightedMultiplierSum / focusMinutes;
}

/**
 * Calcula a Mana concedida por um evento de foco/revisão.
 *
 * @param {Object} params
 * @param {number} params.focusMinutes            Duração do Pomodoro / revisão, em minutos (> 0).
 * @param {number} params.cardQuality              Nota SM-2 da carta associada (0-5).
 * @param {number} params.minutesFocusedTodayBeforeSession Minutos de foco já acumulados hoje pelo usuário, antes desta sessão (>= 0).
 * @returns {{ manaEarned: number, staminaMultiplier: number, difficultyWeight: number }}
 */
function calculateManaReward({ focusMinutes, cardQuality, minutesFocusedTodayBeforeSession }) {
  if (!Number.isFinite(focusMinutes) || focusMinutes <= 0) {
    throw new RangeError(`focusMinutes deve ser um número positivo, recebido: ${focusMinutes}`);
  }
  if (!Number.isFinite(minutesFocusedTodayBeforeSession) || minutesFocusedTodayBeforeSession < 0) {
    throw new RangeError(
      `minutesFocusedTodayBeforeSession deve ser >= 0, recebido: ${minutesFocusedTodayBeforeSession}`
    );
  }

  const difficultyWeight = getDifficultyWeight(cardQuality);
  const staminaMultiplier = getStaminaMultiplier(minutesFocusedTodayBeforeSession, focusMinutes);

  const rawMana = focusMinutes * BASE_MANA_PER_MINUTE * difficultyWeight * staminaMultiplier;

  return {
    manaEarned: Math.round(rawMana),
    staminaMultiplier: Number(staminaMultiplier.toFixed(2)),
    difficultyWeight,
  };
}

module.exports = {
  BASE_MANA_PER_MINUTE,
  DIFFICULTY_WEIGHTS,
  STAMINA_TIERS,
  getDifficultyWeight,
  getStaminaMultiplier,
  calculateManaReward,
};

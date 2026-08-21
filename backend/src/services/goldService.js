'use strict';

/**
 * Gold Service
 * Calcula o Gold concedido ao final de uma sessão Pomodoro / revisão de carta,
 * combinando três fatores das regras de negócio do Pomocard:
 *   1. Tempo de foco (minutos do timer Pomodoro)
 *   2. Peso da dificuldade da carta (nota de recall — cartas difíceis pagam mais, "Boss Battle")
 *   3. Multiplicador de Mana diária (bônus de 100% nas primeiras 3h/dia, com
 *      redução progressiva depois disso — regra Anti-Burnout)
 */

/** Gold base concedido por minuto de foco, antes dos multiplicadores. */
const BASE_GOLD_PER_MINUTE = 2;

/**
 * Cooldown anti-inflação: revisar a MESMA carta várias vezes no mesmo dia não deve
 * render Gold ilimitado. Passado esse intervalo desde o último Gold ganho por uma
 * carta específica, ela volta a valer Gold normalmente na próxima revisão correta.
 */
const GOLD_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * "Loot crítico": chance de um acerto pagar Gold em dobro, puramente por sorte —
 * o Core Drive 7 do Octalysis (Imprevisibilidade & Curiosidade). Só faz sentido
 * num evento que se repete com frequência (revisão de carta, "batalha"), por
 * isso é opt-in via `allowCriticalLoot` — a recompensa de Pomodoro concluído
 * (evento raro, grande) nunca rola crítico, pra não se tornar previsível OU
 * volátil demais num valor que já é alto por si só.
 */
const CRITICAL_LOOT_CHANCE = 0.15;
const CRITICAL_LOOT_MULTIPLIER = 2;

/**
 * Peso de dificuldade por nota de recall (0 a 5).
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
 * Tetos de mana diária (em minutos acumulados de foco no dia) e o
 * multiplicador de gold aplicado dentro de cada faixa. As faixas são
 * cumulativas e percorridas em ordem — ver `getManaMultiplier`.
 *
 *   0 – 180 min  (0-3h): x2.0  -> bônus de 100% (regra Anti-Burnout)
 * 180 – 240 min  (3-4h): x1.0  -> ritmo normal
 * 240 – 300 min  (4-5h): x0.5  -> redução progressiva
 *      300+ min  (5h+ ): x0.25 -> fadiga, desestimula grind excessivo
 */
const MANA_TIERS = Object.freeze([
  { upToMinute: 180, multiplier: 2.0 },
  { upToMinute: 240, multiplier: 1.0 },
  { upToMinute: 300, multiplier: 0.5 },
  { upToMinute: Infinity, multiplier: 0.25 },
]);

/**
 * Retorna o peso de dificuldade para uma nota de recall (0-5).
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
 * Calcula o multiplicador médio de mana para uma sessão de `focusMinutes`
 * que começa depois que o usuário já acumulou `minutesBeforeSession` minutos
 * de foco no dia. Quando a sessão atravessa mais de uma faixa de mana, o
 * multiplicador é a média ponderada pelos minutos gastos em cada faixa —
 * evita que uma sessão longa "escape" para a faixa de bônus inteira.
 *
 * @param {number} minutesBeforeSession minutos já focados hoje antes desta sessão
 * @param {number} focusMinutes duração da sessão atual em minutos
 * @returns {number} multiplicador médio (ex.: 1.4)
 */
function getManaMultiplier(minutesBeforeSession, focusMinutes) {
  let cursor = minutesBeforeSession;
  const sessionEnd = minutesBeforeSession + focusMinutes;
  let weightedMultiplierSum = 0;

  for (const tier of MANA_TIERS) {
    if (cursor >= sessionEnd) break;
    if (tier.upToMinute <= cursor) continue; // sessão já começou depois desta faixa
    const tierEnd = Math.min(tier.upToMinute, sessionEnd);
    weightedMultiplierSum += (tierEnd - cursor) * tier.multiplier;
    cursor = tierEnd;
  }

  return weightedMultiplierSum / focusMinutes;
}

/**
 * Calcula o Gold concedido por um evento de foco/revisão.
 *
 * @param {Object} params
 * @param {number} params.focusMinutes            Duração do Pomodoro / revisão, em minutos (> 0).
 * @param {number} params.cardQuality              Nota de recall da carta associada (0-5). < 3 é "Errou" e nunca rende Gold.
 * @param {number} params.minutesFocusedTodayBeforeSession Minutos de foco já acumulados hoje pelo usuário, antes desta sessão (>= 0).
 * @param {string|null} [params.lastGoldAwardedAt] ISO 8601 do último Gold ganho por ESTA carta (null se nunca ganhou). Ignorado numa falha.
 * @param {Date} [params.now]                      Momento de referência pro cálculo do cooldown (default: agora).
 * @param {boolean} [params.allowCriticalLoot]     Se true, um acerto que pagaria Gold tem CRITICAL_LOOT_CHANCE de chance de pagar em dobro. Default false (ver constante acima).
 * @param {() => number} [params.randomFn]         Fonte de aleatoriedade pro roll do crítico (default Math.random) — injetável pra testes determinísticos.
 * @returns {{ goldEarned: number, manaMultiplier: number, difficultyWeight: number, goldBlockedByCooldown: boolean, isCritical: boolean }}
 */
function calculateGoldReward({
  focusMinutes,
  cardQuality,
  minutesFocusedTodayBeforeSession,
  lastGoldAwardedAt = null,
  now = new Date(),
  allowCriticalLoot = false,
  randomFn = Math.random,
}) {
  if (!Number.isFinite(focusMinutes) || focusMinutes <= 0) {
    throw new RangeError(`focusMinutes deve ser um número positivo, recebido: ${focusMinutes}`);
  }
  if (!Number.isFinite(minutesFocusedTodayBeforeSession) || minutesFocusedTodayBeforeSession < 0) {
    throw new RangeError(
      `minutesFocusedTodayBeforeSession deve ser >= 0, recebido: ${minutesFocusedTodayBeforeSession}`
    );
  }

  const difficultyWeight = getDifficultyWeight(cardQuality);
  const manaMultiplier = getManaMultiplier(minutesFocusedTodayBeforeSession, focusMinutes);

  // Errou (quality < 3): zero Gold, sem exceção — não existe mais "prêmio de consolação".
  const isFailure = cardQuality < 3;
  const goldBlockedByCooldown =
    !isFailure && lastGoldAwardedAt !== null && now.getTime() - new Date(lastGoldAwardedAt).getTime() < GOLD_COOLDOWN_MS;

  const baseGold =
    isFailure || goldBlockedByCooldown ? 0 : focusMinutes * BASE_GOLD_PER_MINUTE * difficultyWeight * manaMultiplier;

  // O roll só acontece quando Gold seria mesmo pago — sem crítico "vazio" numa
  // falha ou num acerto bloqueado por cooldown, e sem custo de aleatoriedade
  // (chamar randomFn) fora desse caminho, mantendo o cálculo determinístico
  // pros dois outros casos.
  const isCritical = allowCriticalLoot && baseGold > 0 && randomFn() < CRITICAL_LOOT_CHANCE;
  const rawGold = isCritical ? baseGold * CRITICAL_LOOT_MULTIPLIER : baseGold;

  return {
    goldEarned: Math.round(rawGold),
    manaMultiplier: Number(manaMultiplier.toFixed(2)),
    difficultyWeight,
    goldBlockedByCooldown,
    isCritical,
  };
}

module.exports = {
  BASE_GOLD_PER_MINUTE,
  GOLD_COOLDOWN_MS,
  CRITICAL_LOOT_CHANCE,
  CRITICAL_LOOT_MULTIPLIER,
  DIFFICULTY_WEIGHTS,
  MANA_TIERS,
  getDifficultyWeight,
  getManaMultiplier,
  calculateGoldReward,
};

'use strict';

/**
 * Streak Service
 * Calcula a sequência diária de estudo e o "Escudo de Ofensiva" que a protege
 * de um dia perdido — Core Drive 8 do Octalysis (Perda & Aversão), mas sem
 * punição terminal: um único dia sem estudar não zera a sequência se houver
 * escudo disponível.
 *
 * "Dia de estudo" = qualquer dia em que o usuário registrou foco (Pomodoro
 * concluído OU revisão de carta) — o mesmo evento que já dispara
 * addFocusMinutes no frontend, então nenhum rastreio novo de atividade é
 * necessário além da data.
 */

/** Teto de escudos acumuláveis — sem isso o jogador poderia "guardar" indefinidamente. */
const MAX_STREAK_SHIELDS = 2;

/** A cada N dias consecutivos, a sequência rende +1 escudo (até o teto). */
const SHIELD_MILESTONE_DAYS = 7;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value, paramName) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    throw new RangeError(`${paramName} deve ser uma data no formato YYYY-MM-DD, recebido: ${value}`);
  }
}

/** Diferença em dias de calendário (UTC) entre duas datas YYYY-MM-DD. */
function diffInCalendarDays(fromIso, toIso) {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/**
 * Avança a sequência de estudo com base num novo dia de atividade.
 *
 * @param {Object} params
 * @param {number} params.currentStreakDays        Sequência atual, em dias consecutivos (>= 0).
 * @param {number} params.streakShields             Escudos disponíveis (0 a MAX_STREAK_SHIELDS).
 * @param {string|null} params.lastStreakActivityOn Data (YYYY-MM-DD) do último dia já contado, ou null se nunca estudou.
 * @param {string} params.today                     Data (YYYY-MM-DD) do dia de atividade que está sendo registrado.
 * @returns {{
 *   currentStreakDays: number,
 *   streakShields: number,
 *   lastStreakActivityOn: string,
 *   shieldConsumed: boolean,
 *   shieldAwarded: boolean,
 *   streakBroken: boolean,
 * }}
 */
function advanceStreak({ currentStreakDays, streakShields, lastStreakActivityOn, today }) {
  if (!Number.isInteger(currentStreakDays) || currentStreakDays < 0) {
    throw new RangeError(`currentStreakDays deve ser um inteiro >= 0, recebido: ${currentStreakDays}`);
  }
  if (!Number.isInteger(streakShields) || streakShields < 0 || streakShields > MAX_STREAK_SHIELDS) {
    throw new RangeError(`streakShields deve ser um inteiro entre 0 e ${MAX_STREAK_SHIELDS}, recebido: ${streakShields}`);
  }
  if (lastStreakActivityOn !== null) assertIsoDate(lastStreakActivityOn, 'lastStreakActivityOn');
  assertIsoDate(today, 'today');

  const unchanged = {
    currentStreakDays,
    streakShields,
    lastStreakActivityOn: lastStreakActivityOn ?? today,
    shieldConsumed: false,
    shieldAwarded: false,
    streakBroken: false,
  };

  // Primeira atividade já registrada hoje, ou today <= lastStreakActivityOn (chamada
  // duplicada / relógio do cliente atrasado) — não reprocessa, nem arrisca resetar
  // uma sequência válida por causa de uma data que "andou pra trás".
  if (lastStreakActivityOn !== null && diffInCalendarDays(lastStreakActivityOn, today) <= 0) {
    return unchanged;
  }

  const gapDays = lastStreakActivityOn === null ? null : diffInCalendarDays(lastStreakActivityOn, today);

  let nextStreak;
  let shieldConsumed = false;
  let streakBroken = false;

  if (gapDays === null) {
    nextStreak = 1; // primeira atividade de todas
  } else if (gapDays === 1) {
    nextStreak = currentStreakDays + 1; // dia seguinte, sequência contínua
  } else if (gapDays === 2 && streakShields > 0) {
    // Exatamente 1 dia perdido no meio — um escudo perdoa e a sequência continua.
    nextStreak = currentStreakDays + 1;
    shieldConsumed = true;
  } else {
    // 2+ dias perdidos, ou 1 dia perdido sem escudo disponível: reseta (hoje é o dia 1
    // da nova sequência) — o escudo só perdoa UM dia, não uma ausência prolongada.
    nextStreak = 1;
    streakBroken = currentStreakDays > 0;
  }

  let nextShields = streakShields - (shieldConsumed ? 1 : 0);
  let shieldAwarded = false;
  if (nextStreak % SHIELD_MILESTONE_DAYS === 0 && nextShields < MAX_STREAK_SHIELDS) {
    nextShields += 1;
    shieldAwarded = true;
  }

  return {
    currentStreakDays: nextStreak,
    streakShields: nextShields,
    lastStreakActivityOn: today,
    shieldConsumed,
    shieldAwarded,
    streakBroken,
  };
}

module.exports = {
  MAX_STREAK_SHIELDS,
  SHIELD_MILESTONE_DAYS,
  advanceStreak,
};

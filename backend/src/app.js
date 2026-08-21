'use strict';

const express = require('express');
const cors = require('cors');
const { calculateGoldReward } = require('./services/goldService');
const { scheduleNextReview } = require('./services/srsService');
const { advanceStreak } = require('./services/streakService');

// XP concedido por minuto de foco ao completar um Pomodoro (regra 1: Timer -> Modal -> Recompensa).
const XP_PER_FOCUS_MINUTE = 4;

// Nota de recall (escala 0-5) usada como linha de base ao recompensar a
// CRIAÇÃO de uma carta nova: ainda não houve revisão/nota real, então usamos
// o peso equivalente a "Good" em vez de aplicar o bônus de dificuldade.
const CREATION_QUALITY_BASELINE = 4;

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Chamado quando o timer Pomodoro termina e o usuário confirma a criação
  // do flashcard no modal (ver dashboard.component.ts).
  app.post('/api/rewards/pomodoro-session', (req, res) => {
    const { focusMinutes, minutesFocusedTodayBeforeSession } = req.body ?? {};

    if (!isPositiveNumber(focusMinutes)) {
      return res.status(400).json({ error: 'focusMinutes deve ser um número positivo.' });
    }
    if (!isNonNegativeNumber(minutesFocusedTodayBeforeSession)) {
      return res.status(400).json({ error: 'minutesFocusedTodayBeforeSession deve ser um número >= 0.' });
    }

    const { goldEarned, manaMultiplier } = calculateGoldReward({
      focusMinutes,
      cardQuality: CREATION_QUALITY_BASELINE,
      minutesFocusedTodayBeforeSession,
    });

    return res.json({
      goldEarned,
      xpEarned: Math.round(focusMinutes * XP_PER_FOCUS_MINUTE),
      manaMultiplier,
    });
  });

  // Chamado ao revisar uma carta existente (fila de Spaced Repetition):
  // recalcula o agendamento Leitner e o Gold ("Boss Battle" para cartas difíceis).
  app.post('/api/reviews', (req, res) => {
    const { quality, currentState, focusMinutes, minutesFocusedTodayBeforeSession, reviewedAt, lastGoldAwardedAt } =
      req.body ?? {};

    if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
      return res.status(400).json({ error: 'quality deve ser um inteiro entre 0 e 5.' });
    }
    if (!isPositiveNumber(focusMinutes)) {
      return res.status(400).json({ error: 'focusMinutes deve ser um número positivo.' });
    }
    if (!isNonNegativeNumber(minutesFocusedTodayBeforeSession)) {
      return res.status(400).json({ error: 'minutesFocusedTodayBeforeSession deve ser um número >= 0.' });
    }

    const now = reviewedAt ? new Date(reviewedAt) : new Date();

    const schedule = scheduleNextReview({
      quality,
      currentState: currentState ?? {},
      reviewedAt: now,
    });

    // lastGoldAwardedAt vem do próprio cartão (public.flashcards.last_gold_awarded_at) —
    // é o que permite o cooldown de 24h por carta em vez de por usuário ou sessão.
    // allowCriticalLoot só é ligado aqui (revisão = "batalha" recorrente) — a
    // recompensa de Pomodoro concluído (/api/rewards/pomodoro-session) nunca rola crítico.
    const { goldEarned, manaMultiplier, goldBlockedByCooldown, isCritical } = calculateGoldReward({
      focusMinutes,
      cardQuality: quality,
      minutesFocusedTodayBeforeSession,
      lastGoldAwardedAt: lastGoldAwardedAt ?? null,
      now,
      allowCriticalLoot: true,
    });

    return res.json({ schedule, goldEarned, manaMultiplier, goldBlockedByCooldown, isCritical });
  });

  // Chamado no primeiro registro de foco (Pomodoro concluído OU carta revisada) do dia
  // — ver player-state.service.ts, addFocusMinutes só chama isto quando o dia mudou.
  app.post('/api/streak/advance', (req, res) => {
    const { currentStreakDays, streakShields, lastStreakActivityOn, today } = req.body ?? {};

    if (!isNonNegativeInteger(currentStreakDays)) {
      return res.status(400).json({ error: 'currentStreakDays deve ser um inteiro >= 0.' });
    }
    if (!isNonNegativeInteger(streakShields)) {
      return res.status(400).json({ error: 'streakShields deve ser um inteiro >= 0.' });
    }
    if (typeof today !== 'string') {
      return res.status(400).json({ error: 'today é obrigatório, no formato YYYY-MM-DD.' });
    }
    if (lastStreakActivityOn !== null && lastStreakActivityOn !== undefined && typeof lastStreakActivityOn !== 'string') {
      return res.status(400).json({ error: 'lastStreakActivityOn deve ser uma string YYYY-MM-DD ou null.' });
    }

    try {
      const result = advanceStreak({
        currentStreakDays,
        streakShields,
        lastStreakActivityOn: lastStreakActivityOn ?? null,
        today,
      });
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  });

  return app;
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

module.exports = { createApp, XP_PER_FOCUS_MINUTE, CREATION_QUALITY_BASELINE };

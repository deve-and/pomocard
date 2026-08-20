'use strict';

const express = require('express');
const cors = require('cors');
const { calculateGoldReward } = require('./services/goldService');
const { scheduleNextReview } = require('./services/srsService');

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
    const { goldEarned, manaMultiplier, goldBlockedByCooldown } = calculateGoldReward({
      focusMinutes,
      cardQuality: quality,
      minutesFocusedTodayBeforeSession,
      lastGoldAwardedAt: lastGoldAwardedAt ?? null,
      now,
    });

    return res.json({ schedule, goldEarned, manaMultiplier, goldBlockedByCooldown });
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

module.exports = { createApp, XP_PER_FOCUS_MINUTE, CREATION_QUALITY_BASELINE };

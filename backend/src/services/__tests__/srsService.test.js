'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleNextReview, DEFAULT_EASINESS_FACTOR, MAX_BOX_LEVEL } = require('../srsService');

const freshCard = { easinessFactor: DEFAULT_EASINESS_FACTOR, repetitions: 0, intervalDays: 0 };

test('primeira revisão "Médio" entra na Caixa 2 com o intervalo-base da caixa (2 dias)', () => {
  const result = scheduleNextReview({ quality: 4, currentState: freshCard, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  assert.equal(result.repetitions, 2); // Caixa 2 (subiu da Caixa 1)
  assert.equal(result.intervalDays, 2);
  assert.equal(result.nextReviewAt.toISOString(), '2026-01-03T00:00:00.000Z');
});

test('segunda revisão "Médio" multiplica o intervalo anterior pelo fator de facilidade', () => {
  const afterFirst = scheduleNextReview({ quality: 4, currentState: freshCard, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  const afterSecond = scheduleNextReview({
    quality: 4,
    currentState: afterFirst,
    reviewedAt: new Date('2026-01-03T00:00:00Z'),
  });
  assert.equal(afterSecond.repetitions, 3); // Caixa 3
  assert.equal(afterSecond.intervalDays, Math.round(afterFirst.intervalDays * afterFirst.easinessFactor * 1.0));
});

test('"Fácil" cresce o intervalo mais rápido que "Difícil" nas mesmas condições', () => {
  const base = { easinessFactor: 2.5, repetitions: 2, intervalDays: 5 };
  const hard = scheduleNextReview({ quality: 3, currentState: base, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  const easy = scheduleNextReview({ quality: 5, currentState: base, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  assert.ok(easy.intervalDays > hard.intervalDays);
});

test('Caixa nunca passa de 5, mesmo acertando repetidamente', () => {
  let state = { easinessFactor: 2.5, repetitions: MAX_BOX_LEVEL, intervalDays: 30 };
  for (let i = 0; i < 3; i++) {
    state = scheduleNextReview({ quality: 5, currentState: state, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  }
  assert.equal(state.repetitions, MAX_BOX_LEVEL);
});

test('falha ("Errou", quality < 3) volta pra Caixa 1 e reinicia o intervalo em 1 dia', () => {
  const advanced = { easinessFactor: 2.6, repetitions: 4, intervalDays: 20 };
  const result = scheduleNextReview({ quality: 1, currentState: advanced, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  assert.equal(result.repetitions, 1); // Caixa 1
  assert.equal(result.intervalDays, 1);
  assert.equal(result.easinessFactor, 2.6); // fator de facilidade não muda numa falha
});

test('fator de facilidade nunca cai abaixo de 1.3, mesmo com "Difícil" repetido', () => {
  let state = { easinessFactor: 1.35, repetitions: 3, intervalDays: 10 };
  for (let i = 0; i < 5; i++) {
    state = scheduleNextReview({ quality: 3, currentState: state, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  }
  assert.ok(state.easinessFactor >= 1.3);
});

test('"Fácil" aumenta o fator de facilidade em relação ao estado inicial', () => {
  const result = scheduleNextReview({ quality: 5, currentState: freshCard, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  assert.ok(result.easinessFactor > DEFAULT_EASINESS_FACTOR);
});

test('carta legada com repetitions = 0 é lida como Caixa 1 (compatibilidade com dados do SM-2 antigo)', () => {
  const result = scheduleNextReview({ quality: 1, currentState: freshCard, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  assert.equal(result.repetitions, 1);
});

test('rejeita quality fora do intervalo 0-5', () => {
  assert.throws(() => scheduleNextReview({ quality: 9, currentState: freshCard }));
});

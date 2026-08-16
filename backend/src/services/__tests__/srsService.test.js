'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleNextReview, DEFAULT_EASINESS_FACTOR } = require('../srsService');

const freshCard = { easinessFactor: DEFAULT_EASINESS_FACTOR, repetitions: 0, intervalDays: 0 };

test('primeira revisão correta (quality 4) agenda para 1 dia', () => {
  const result = scheduleNextReview({ quality: 4, currentState: freshCard, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  assert.equal(result.repetitions, 1);
  assert.equal(result.intervalDays, 1);
  assert.equal(result.nextReviewAt.toISOString(), '2026-01-02T00:00:00.000Z');
});

test('segunda revisão correta agenda para 6 dias', () => {
  const afterFirst = scheduleNextReview({ quality: 4, currentState: freshCard, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  const afterSecond = scheduleNextReview({
    quality: 4,
    currentState: afterFirst,
    reviewedAt: new Date('2026-01-02T00:00:00Z'),
  });
  assert.equal(afterSecond.repetitions, 2);
  assert.equal(afterSecond.intervalDays, 6);
});

test('terceira revisão em diante multiplica o intervalo pelo easiness factor', () => {
  let state = freshCard;
  let reviewedAt = new Date('2026-01-01T00:00:00Z');
  state = scheduleNextReview({ quality: 4, currentState: state, reviewedAt });
  state = scheduleNextReview({ quality: 4, currentState: state, reviewedAt: state.nextReviewAt });
  const before = state;
  state = scheduleNextReview({ quality: 4, currentState: state, reviewedAt: state.nextReviewAt });
  assert.equal(state.repetitions, 3);
  assert.equal(state.intervalDays, Math.round(before.intervalDays * state.easinessFactor));
});

test('falha no recall (quality < 3) zera repetitions e reinicia o intervalo em 1 dia', () => {
  const advanced = { easinessFactor: 2.6, repetitions: 4, intervalDays: 20 };
  const result = scheduleNextReview({ quality: 1, currentState: advanced, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  assert.equal(result.repetitions, 0);
  assert.equal(result.intervalDays, 1);
});

test('easiness factor nunca cai abaixo de 1.3', () => {
  let state = { easinessFactor: 1.35, repetitions: 3, intervalDays: 10 };
  for (let i = 0; i < 5; i++) {
    state = scheduleNextReview({ quality: 0, currentState: state, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  }
  assert.ok(state.easinessFactor >= 1.3);
});

test('quality alta (5) aumenta o easiness factor em relação ao estado inicial', () => {
  const result = scheduleNextReview({ quality: 5, currentState: freshCard, reviewedAt: new Date('2026-01-01T00:00:00Z') });
  assert.ok(result.easinessFactor > DEFAULT_EASINESS_FACTOR);
});

test('rejeita quality fora do intervalo 0-5', () => {
  assert.throws(() => scheduleNextReview({ quality: 9, currentState: freshCard }));
});

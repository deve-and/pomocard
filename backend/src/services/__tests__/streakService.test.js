'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceStreak, MAX_STREAK_SHIELDS, SHIELD_MILESTONE_DAYS } = require('../streakService');

test('primeira atividade de todas (lastStreakActivityOn null) inicia a sequência em 1', () => {
  const result = advanceStreak({ currentStreakDays: 0, streakShields: 0, lastStreakActivityOn: null, today: '2026-01-01' });
  assert.equal(result.currentStreakDays, 1);
  assert.equal(result.lastStreakActivityOn, '2026-01-01');
  assert.equal(result.shieldConsumed, false);
  assert.equal(result.streakBroken, false);
});

test('atividade no mesmo dia já contado é um no-op (sem duplicar a contagem)', () => {
  const result = advanceStreak({
    currentStreakDays: 3,
    streakShields: 1,
    lastStreakActivityOn: '2026-01-05',
    today: '2026-01-05',
  });
  assert.equal(result.currentStreakDays, 3);
  assert.equal(result.streakShields, 1);
  assert.equal(result.shieldConsumed, false);
  assert.equal(result.shieldAwarded, false);
});

test('dia seguinte consecutivo incrementa a sequência em 1', () => {
  const result = advanceStreak({
    currentStreakDays: 3,
    streakShields: 0,
    lastStreakActivityOn: '2026-01-05',
    today: '2026-01-06',
  });
  assert.equal(result.currentStreakDays, 4);
  assert.equal(result.streakBroken, false);
});

test('1 dia perdido COM escudo disponível: consome o escudo e mantém a sequência', () => {
  const result = advanceStreak({
    currentStreakDays: 3,
    streakShields: 1,
    lastStreakActivityOn: '2026-01-05',
    today: '2026-01-07', // pulou o dia 6
  });
  assert.equal(result.currentStreakDays, 4);
  assert.equal(result.streakShields, 0);
  assert.equal(result.shieldConsumed, true);
  assert.equal(result.streakBroken, false);
});

test('1 dia perdido SEM escudo disponível: reseta a sequência pra 1', () => {
  const result = advanceStreak({
    currentStreakDays: 3,
    streakShields: 0,
    lastStreakActivityOn: '2026-01-05',
    today: '2026-01-07',
  });
  assert.equal(result.currentStreakDays, 1);
  assert.equal(result.shieldConsumed, false);
  assert.equal(result.streakBroken, true);
});

test('2+ dias perdidos reseta a sequência mesmo com escudo disponível (só perdoa 1 dia)', () => {
  const result = advanceStreak({
    currentStreakDays: 5,
    streakShields: 1,
    lastStreakActivityOn: '2026-01-01',
    today: '2026-01-10',
  });
  assert.equal(result.currentStreakDays, 1);
  assert.equal(result.streakShields, 1); // escudo preservado, não foi consumido à toa
  assert.equal(result.shieldConsumed, false);
  assert.equal(result.streakBroken, true);
});

test(`ao atingir um múltiplo de ${SHIELD_MILESTONE_DAYS} dias, ganha 1 escudo`, () => {
  const result = advanceStreak({
    currentStreakDays: SHIELD_MILESTONE_DAYS - 1,
    streakShields: 0,
    lastStreakActivityOn: '2026-01-06',
    today: '2026-01-07',
  });
  assert.equal(result.currentStreakDays, SHIELD_MILESTONE_DAYS);
  assert.equal(result.streakShields, 1);
  assert.equal(result.shieldAwarded, true);
});

test('escudos não passam do teto MAX_STREAK_SHIELDS mesmo batendo o marco novamente', () => {
  const result = advanceStreak({
    currentStreakDays: SHIELD_MILESTONE_DAYS * 2 - 1,
    streakShields: MAX_STREAK_SHIELDS,
    lastStreakActivityOn: '2026-01-13',
    today: '2026-01-14',
  });
  assert.equal(result.streakShields, MAX_STREAK_SHIELDS);
  assert.equal(result.shieldAwarded, false);
});

test('today no passado (<=) em relação a lastStreakActivityOn não altera nada (defesa contra relógio desalinhado)', () => {
  const result = advanceStreak({
    currentStreakDays: 3,
    streakShields: 1,
    lastStreakActivityOn: '2026-01-10',
    today: '2026-01-09',
  });
  assert.equal(result.currentStreakDays, 3);
  assert.equal(result.streakShields, 1);
  assert.equal(result.shieldConsumed, false);
  assert.equal(result.streakBroken, false);
});

test('rejeita currentStreakDays negativo', () => {
  assert.throws(() =>
    advanceStreak({ currentStreakDays: -1, streakShields: 0, lastStreakActivityOn: null, today: '2026-01-01' })
  );
});

test('rejeita streakShields acima do teto', () => {
  assert.throws(() =>
    advanceStreak({
      currentStreakDays: 0,
      streakShields: MAX_STREAK_SHIELDS + 1,
      lastStreakActivityOn: null,
      today: '2026-01-01',
    })
  );
});

test('rejeita data em formato inválido', () => {
  assert.throws(() =>
    advanceStreak({ currentStreakDays: 0, streakShields: 0, lastStreakActivityOn: null, today: '01/01/2026' })
  );
});

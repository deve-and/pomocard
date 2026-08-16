'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateManaReward, getStaminaMultiplier } = require('../manaService');

test('sessão dentro da janela de bônus (0-3h) aplica multiplicador x2.0', () => {
  const { manaEarned, staminaMultiplier } = calculateManaReward({
    focusMinutes: 25,
    cardQuality: 4, // "Good"
    minutesFocusedTodayBeforeSession: 0,
  });
  assert.equal(staminaMultiplier, 2.0);
  assert.equal(manaEarned, Math.round(25 * 2 * 1.0 * 2.0));
});

test('carta difícil (quality 3) rende mais mana que carta fácil (quality 5) sob as mesmas condições', () => {
  const hard = calculateManaReward({ focusMinutes: 25, cardQuality: 3, minutesFocusedTodayBeforeSession: 0 });
  const easy = calculateManaReward({ focusMinutes: 25, cardQuality: 5, minutesFocusedTodayBeforeSession: 0 });
  assert.ok(hard.manaEarned > easy.manaEarned);
});

test('sessão que cruza a fronteira 3h/4h usa multiplicador médio ponderado', () => {
  // 170 min já focados hoje, sessão de 20 min: 10 min a x2.0 (até 180) + 10 min a x1.0 (180-190)
  const multiplier = getStaminaMultiplier(170, 20);
  assert.equal(multiplier, (10 * 2.0 + 10 * 1.0) / 20);
});

test('após 5h de foco no dia, multiplicador de fadiga é x0.25', () => {
  const multiplier = getStaminaMultiplier(310, 15);
  assert.equal(multiplier, 0.25);
});

test('falha na revisão (quality < 3) ainda concede mana de consolação, mas bem menor', () => {
  const { manaEarned } = calculateManaReward({ focusMinutes: 25, cardQuality: 1, minutesFocusedTodayBeforeSession: 0 });
  assert.ok(manaEarned > 0);
  assert.ok(manaEarned < 25 * 2); // menor que a mana base sem multiplicadores
});

test('rejeita focusMinutes inválido', () => {
  assert.throws(() => calculateManaReward({ focusMinutes: 0, cardQuality: 4, minutesFocusedTodayBeforeSession: 0 }));
});

test('rejeita cardQuality fora do intervalo 0-5', () => {
  assert.throws(() => calculateManaReward({ focusMinutes: 25, cardQuality: 6, minutesFocusedTodayBeforeSession: 0 }));
});

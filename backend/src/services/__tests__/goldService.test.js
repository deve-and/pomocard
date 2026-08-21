'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateGoldReward, getManaMultiplier } = require('../goldService');

test('sessão dentro da janela de bônus (0-3h) aplica multiplicador x2.0', () => {
  const { goldEarned, manaMultiplier } = calculateGoldReward({
    focusMinutes: 25,
    cardQuality: 4, // "Good"
    minutesFocusedTodayBeforeSession: 0,
  });
  assert.equal(manaMultiplier, 2.0);
  assert.equal(goldEarned, Math.round(25 * 2 * 1.0 * 2.0));
});

test('carta difícil (quality 3) rende mais gold que carta fácil (quality 5) sob as mesmas condições', () => {
  const hard = calculateGoldReward({ focusMinutes: 25, cardQuality: 3, minutesFocusedTodayBeforeSession: 0 });
  const easy = calculateGoldReward({ focusMinutes: 25, cardQuality: 5, minutesFocusedTodayBeforeSession: 0 });
  assert.ok(hard.goldEarned > easy.goldEarned);
});

test('sessão que cruza a fronteira 3h/4h usa multiplicador médio ponderado', () => {
  // 170 min já focados hoje, sessão de 20 min: 10 min a x2.0 (até 180) + 10 min a x1.0 (180-190)
  const multiplier = getManaMultiplier(170, 20);
  assert.equal(multiplier, (10 * 2.0 + 10 * 1.0) / 20);
});

test('após 5h de foco no dia, multiplicador de fadiga é x0.25', () => {
  const multiplier = getManaMultiplier(310, 15);
  assert.equal(multiplier, 0.25);
});

test('falha na revisão (quality < 3) concede exatamente zero Gold, sem prêmio de consolação', () => {
  const { goldEarned, goldBlockedByCooldown } = calculateGoldReward({
    focusMinutes: 25,
    cardQuality: 1,
    minutesFocusedTodayBeforeSession: 0,
  });
  assert.equal(goldEarned, 0);
  assert.equal(goldBlockedByCooldown, false); // zerou por ser falha, não por cooldown
});

test('acerto dentro de 24h do último Gold ganho pela MESMA carta é bloqueado (ganho educativo, sem Gold)', () => {
  const now = new Date('2026-01-02T00:00:00Z');
  const lastGoldAwardedAt = new Date('2026-01-01T12:00:00Z').toISOString(); // 12h atrás
  const result = calculateGoldReward({
    focusMinutes: 25,
    cardQuality: 4,
    minutesFocusedTodayBeforeSession: 0,
    lastGoldAwardedAt,
    now,
  });
  assert.equal(result.goldEarned, 0);
  assert.equal(result.goldBlockedByCooldown, true);
});

test('acerto depois de 24h do último Gold ganho pela mesma carta volta a render Gold normalmente', () => {
  const now = new Date('2026-01-02T13:00:00Z');
  const lastGoldAwardedAt = new Date('2026-01-01T12:00:00Z').toISOString(); // 25h atrás
  const result = calculateGoldReward({
    focusMinutes: 25,
    cardQuality: 4,
    minutesFocusedTodayBeforeSession: 0,
    lastGoldAwardedAt,
    now,
  });
  assert.ok(result.goldEarned > 0);
  assert.equal(result.goldBlockedByCooldown, false);
});

test('carta nunca premiada antes (lastGoldAwardedAt null) nunca é bloqueada por cooldown', () => {
  const result = calculateGoldReward({
    focusMinutes: 25,
    cardQuality: 5,
    minutesFocusedTodayBeforeSession: 0,
    lastGoldAwardedAt: null,
  });
  assert.ok(result.goldEarned > 0);
  assert.equal(result.goldBlockedByCooldown, false);
});

test('rejeita focusMinutes inválido', () => {
  assert.throws(() => calculateGoldReward({ focusMinutes: 0, cardQuality: 4, minutesFocusedTodayBeforeSession: 0 }));
});

test('rejeita cardQuality fora do intervalo 0-5', () => {
  assert.throws(() => calculateGoldReward({ focusMinutes: 25, cardQuality: 6, minutesFocusedTodayBeforeSession: 0 }));
});

test('sem allowCriticalLoot (default), nunca rola crítico mesmo com randomFn favorável', () => {
  const result = calculateGoldReward({
    focusMinutes: 25,
    cardQuality: 4,
    minutesFocusedTodayBeforeSession: 0,
    randomFn: () => 0, // sempre "ganharia" o roll se estivesse habilitado
  });
  assert.equal(result.isCritical, false);
});

test('com allowCriticalLoot e roll dentro da chance, dobra o Gold e marca isCritical', () => {
  const base = calculateGoldReward({ focusMinutes: 25, cardQuality: 4, minutesFocusedTodayBeforeSession: 0 });
  const critical = calculateGoldReward({
    focusMinutes: 25,
    cardQuality: 4,
    minutesFocusedTodayBeforeSession: 0,
    allowCriticalLoot: true,
    randomFn: () => 0, // 0 < CRITICAL_LOOT_CHANCE, sempre acerta o roll
  });
  assert.equal(critical.isCritical, true);
  assert.equal(critical.goldEarned, base.goldEarned * 2);
});

test('com allowCriticalLoot e roll fora da chance, não dobra o Gold', () => {
  const base = calculateGoldReward({ focusMinutes: 25, cardQuality: 4, minutesFocusedTodayBeforeSession: 0 });
  const result = calculateGoldReward({
    focusMinutes: 25,
    cardQuality: 4,
    minutesFocusedTodayBeforeSession: 0,
    allowCriticalLoot: true,
    randomFn: () => 0.99, // acima de CRITICAL_LOOT_CHANCE, nunca acerta o roll
  });
  assert.equal(result.isCritical, false);
  assert.equal(result.goldEarned, base.goldEarned);
});

test('crítico nunca rola numa falha (quality < 3), mesmo com allowCriticalLoot e roll favorável', () => {
  const result = calculateGoldReward({
    focusMinutes: 25,
    cardQuality: 1,
    minutesFocusedTodayBeforeSession: 0,
    allowCriticalLoot: true,
    randomFn: () => 0,
  });
  assert.equal(result.isCritical, false);
  assert.equal(result.goldEarned, 0);
});

test('crítico nunca rola quando bloqueado por cooldown, mesmo com allowCriticalLoot e roll favorável', () => {
  const now = new Date('2026-01-02T00:00:00Z');
  const lastGoldAwardedAt = new Date('2026-01-01T12:00:00Z').toISOString(); // 12h atrás, dentro do cooldown
  const result = calculateGoldReward({
    focusMinutes: 25,
    cardQuality: 4,
    minutesFocusedTodayBeforeSession: 0,
    lastGoldAwardedAt,
    now,
    allowCriticalLoot: true,
    randomFn: () => 0,
  });
  assert.equal(result.isCritical, false);
  assert.equal(result.goldEarned, 0);
});

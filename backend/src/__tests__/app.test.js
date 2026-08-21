'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

async function withServer(run) {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/health responde ok', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });
});

test('POST /api/rewards/pomodoro-session concede gold e xp por uma sessão válida', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/rewards/pomodoro-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ focusMinutes: 25, minutesFocusedTodayBeforeSession: 0 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.goldEarned, 100); // 25 * 2 * 1.0 (quality 4) * 2.0 (bônus mana)
    assert.equal(body.xpEarned, 100); // 25 * 4
    assert.equal(body.manaMultiplier, 2.0);
  });
});

test('POST /api/rewards/pomodoro-session rejeita focusMinutes inválido', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/rewards/pomodoro-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ focusMinutes: -5, minutesFocusedTodayBeforeSession: 0 }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/reviews combina o agendamento Leitner com a recompensa de gold', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quality: 3,
        currentState: { easinessFactor: 2.5, repetitions: 1, intervalDays: 1 },
        focusMinutes: 10,
        minutesFocusedTodayBeforeSession: 0,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.schedule.repetitions, 2); // subiu da Caixa 1 pra Caixa 2
    assert.equal(body.schedule.intervalDays, Math.round(1 * 2.5 * 0.8)); // intervalWeight de "Difícil"
    assert.ok(body.goldEarned > 0);
  });
});

test('POST /api/reviews zera o Gold quando a mesma carta já ganhou Gold há menos de 24h', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quality: 4,
        currentState: { easinessFactor: 2.5, repetitions: 1, intervalDays: 1 },
        focusMinutes: 10,
        minutesFocusedTodayBeforeSession: 0,
        lastGoldAwardedAt: new Date().toISOString(), // acabou de ganhar Gold por essa carta agora mesmo
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.goldEarned, 0);
    assert.equal(body.goldBlockedByCooldown, true);
    assert.equal(body.schedule.repetitions, 2); // agendamento continua valendo (ganho educativo)
  });
});

test('POST /api/reviews rejeita quality fora do intervalo', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quality: 9, focusMinutes: 10, minutesFocusedTodayBeforeSession: 0 }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/streak/advance incrementa a sequência no dia seguinte', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/streak/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentStreakDays: 3,
        streakShields: 0,
        lastStreakActivityOn: '2026-01-05',
        today: '2026-01-06',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.currentStreakDays, 4);
    assert.equal(body.lastStreakActivityOn, '2026-01-06');
  });
});

test('POST /api/streak/advance rejeita currentStreakDays inválido', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/streak/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentStreakDays: -1, streakShields: 0, lastStreakActivityOn: null, today: '2026-01-06' }),
    });
    assert.equal(res.status, 400);
  });
});

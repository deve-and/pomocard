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

test('POST /api/reviews combina o agendamento SM-2 com a recompensa de gold', async () => {
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
    assert.equal(body.schedule.repetitions, 2);
    assert.equal(body.schedule.intervalDays, 6);
    assert.ok(body.goldEarned > 0);
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

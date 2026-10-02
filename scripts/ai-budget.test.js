const assert = require('node:assert/strict');
const test = require('node:test');
const { embeddingReservation, chatCharge, CHAT_RESERVATION, BudgetStoppedError,
  reserveBudget, finishBudget } = require('./ai-budget');

test('reserves the published full model context, not an average token estimate', () => {
  assert.equal(embeddingReservation(['one', 'two']), 130);
  assert.ok(CHAT_RESERVATION >= Math.ceil(131072 * 5500 / 1e6 + 1024 * 36400 / 1e6));
  assert.throws(() => embeddingReservation([]));
  assert.throws(() => embeddingReservation(Array(21).fill('x')));
  assert.throws(() => embeddingReservation(['x'.repeat(65537)]));
});

test('only verified successful chat usage can reduce the conservative reservation', () => {
  assert.equal(chatCharge({ prompt_tokens: 2000, completion_tokens: 500 }), 30);
  for (const usage of [null, {}, { prompt_tokens: -1, completion_tokens: 2 },
    { prompt_tokens: 1, completion_tokens: 1025 }, { prompt_tokens: 131073, completion_tokens: 0 },
    { prompt_tokens: 1.1, completion_tokens: 2 }]) assert.equal(chatCharge(usage), CHAT_RESERVATION);
});

test('missing reservation or failed storage never authorizes inference', async () => {
  await assert.rejects(reserveBudget(async () => [], 65), BudgetStoppedError);
  await assert.rejects(reserveBudget(async () => { throw new Error('private'); }, 65), BudgetStoppedError);
  await assert.rejects(reserveBudget(async () => [{ id: 'wrong' }], 65), BudgetStoppedError);
});

test('settlement never releases an uncertain reservation or retries a failed write', async () => {
  let calls = 0;
  const query = async () => { calls++; throw new Error('private'); };
  await finishBudget(query, 'id', 65);
  assert.equal(calls, 1);
  await assert.rejects(finishBudget(query, 'id', -1));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBillingService() {
  const context = vm.createContext({ console, Number, Math, Array, String, Boolean });
  for (const file of ['Validation.gs', 'BillingService.gs']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'gas', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}

function summary(userId, presentMinutes, unknownMinutes = 0) {
  return {
    userId,
    displayName: userId,
    presentMinutes,
    unknownMinutes
  };
}

test('allocates the full bill by presence ratio with exact yen total', () => {
  const gas = loadBillingService();
  const result = gas.allocateBill_(1001, [
    summary('user_A', 180),
    summary('user_B', 60)
  ]);

  assert.equal(result.status, 'CALCULATED');
  assert.equal(result.rows[0].ratio, 0.75);
  assert.equal(result.rows[1].ratio, 0.25);
  assert.equal(result.rows[0].rawAmountYen, 750.75);
  assert.equal(result.rows[0].amountYen, 751);
  assert.equal(result.rows[1].amountYen, 250);
  assert.equal(result.rows[0].amountYen + result.rows[1].amountYen, 1001);
});

test('allocates zero and one hundred percent when one user has no presence', () => {
  const gas = loadBillingService();
  const result = gas.allocateBill_(4321, [
    summary('user_A', 0),
    summary('user_B', 120)
  ]);

  assert.equal(result.rows[0].ratio, 0);
  assert.equal(result.rows[0].amountYen, 0);
  assert.equal(result.rows[1].ratio, 1);
  assert.equal(result.rows[1].amountYen, 4321);
});

test('does not automatically finalize when both users have zero presence', () => {
  const gas = loadBillingService();
  const result = gas.allocateBill_(5000, [
    summary('user_A', 0),
    summary('user_B', 0)
  ]);

  assert.equal(result.status, 'NEEDS_DECISION');
  assert.equal(result.rows[0].amountYen, '');
  assert.equal(result.rows[1].amountYen, '');
});

test('marks a provisional allocation for review when unknown time exists', () => {
  const gas = loadBillingService();
  const result = gas.allocateBill_(1000, [
    summary('user_A', 60, 30),
    summary('user_B', 60, 15)
  ]);

  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.totalUnknownMinutes, 45);
  assert.equal(result.rows[0].amountYen + result.rows[1].amountYen, 1000);
});

test('rejects invalid amounts and user counts', () => {
  const gas = loadBillingService();
  assert.throws(
    () => gas.allocateBill_(-1, [summary('user_A', 1), summary('user_B', 1)]),
    (error) => error.code === 'INVALID_BILL_AMOUNT'
  );
  assert.throws(
    () => gas.allocateBill_(100, [summary('user_A', 1)]),
    (error) => error.code === 'INVALID_USER_COUNT'
  );
});

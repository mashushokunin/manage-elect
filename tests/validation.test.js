const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGasValidation() {
  const context = vm.createContext({
    console,
    Date,
    Number,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest(_algorithm, value) {
        return [...crypto.createHash('sha256').update(String(value), 'utf8').digest()];
      },
      base64EncodeWebSafe(bytes) {
        return Buffer.from(bytes).toString('base64url');
      }
    }
  });

  for (const file of ['Config.gs', 'Validation.gs', 'SpreadsheetStore.gs']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'gas', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}

const SETTINGS = {
  maxPastEventHours: 168,
  maxFutureEventMinutes: 10
};

test('validates and normalizes a valid ENTER request', () => {
  const gas = loadGasValidation();
  const result = gas.validatePayload_(
    {
      token: 'secret-token',
      user_id: 'user_A',
      event: 'enter',
      timestamp: '2026-11-13T18:00:00+09:00',
      event_id: '7d4ce64e-3c43-4dfa-96c5-b37d16fef690',
      source: 'ios_shortcut'
    },
    SETTINGS,
    new Date('2026-11-13T09:01:00Z')
  );

  assert.equal(result.userId, 'user_A');
  assert.equal(result.eventType, 'ENTER');
  assert.equal(result.occurredAt.toISOString(), '2026-11-13T09:00:00.000Z');
  assert.equal(result.source, 'ios_shortcut');
});

test('rejects timestamps without a time zone', () => {
  const gas = loadGasValidation();
  assert.throws(
    () => gas.validatePayload_(
      {
        token: 'secret-token',
        user_id: 'user_A',
        event: 'ENTER',
        timestamp: '2026-11-13T18:00:00',
        event_id: 'manual-test-0001'
      },
      SETTINGS,
      new Date('2026-11-13T09:01:00Z')
    ),
    (error) => error.code === 'INVALID_TIMESTAMP'
  );
});

test('rejects events outside the configured past window', () => {
  const gas = loadGasValidation();
  assert.throws(
    () => gas.validatePayload_(
      {
        token: 'secret-token',
        user_id: 'user_A',
        event: 'EXIT',
        timestamp: '2026-11-01T09:00:00+09:00',
        event_id: 'manual-test-0002'
      },
      SETTINGS,
      new Date('2026-11-13T09:01:00Z')
    ),
    (error) => error.code === 'EVENT_TOO_OLD'
  );
});

test('rejects events too far in the future', () => {
  const gas = loadGasValidation();
  assert.throws(
    () => gas.validatePayload_(
      {
        token: 'secret-token',
        user_id: 'user_A',
        event: 'EXIT',
        timestamp: '2026-11-13T19:00:00+09:00',
        event_id: 'manual-test-0003'
      },
      SETTINGS,
      new Date('2026-11-13T09:01:00Z')
    ),
    (error) => error.code === 'EVENT_IN_FUTURE'
  );
});

test('creates the same fallback event ID for the same logical event', () => {
  const gas = loadGasValidation();
  const first = gas.createEventFingerprint_(
    'user_A',
    'ENTER',
    new Date('2026-11-13T09:00:00Z')
  );
  const second = gas.createEventFingerprint_(
    'user_A',
    'ENTER',
    new Date('2026-11-13T09:00:00Z')
  );

  assert.equal(first, second);
  assert.match(first, /^auto_[A-Za-z0-9_-]+$/);
});

test('compares authentication tokens by digest', () => {
  const gas = loadGasValidation();
  assert.equal(gas.constantTimeEquals_('same-secret', 'same-secret'), true);
  assert.equal(gas.constantTimeEquals_('same-secret', 'other-secret'), false);
});

function fakeEventsSheet(rows) {
  return {
    getLastRow() {
      return rows.length + 1;
    },
    getRange(row, column, rowCount, columnCount) {
      assert.equal(row, 2);
      assert.equal(column, 2);
      assert.equal(rowCount, rows.length);
      assert.equal(columnCount, 6);
      return {
        getValues() {
          return rows;
        }
      };
    }
  };
}

test('accepts a normal alternating event sequence', () => {
  const gas = loadGasValidation();
  const sheet = fakeEventsSheet([
    ['user_A', 'ENTER', new Date('2026-11-13T09:00:00Z'), new Date(), 'ios_shortcut', 'OK']
  ]);

  const result = gas.inspectEventSequence_(sheet, {
    userId: 'user_A',
    eventType: 'EXIT',
    occurredAt: new Date('2026-11-13T12:00:00Z')
  });

  assert.equal(result.status, 'OK');
  assert.equal(result.reason, '');
});

test('marks consecutive events for review without discarding them', () => {
  const gas = loadGasValidation();
  const sheet = fakeEventsSheet([
    ['user_A', 'ENTER', new Date('2026-11-13T09:00:00Z'), new Date(), 'ios_shortcut', 'OK']
  ]);

  const result = gas.inspectEventSequence_(sheet, {
    userId: 'user_A',
    eventType: 'ENTER',
    occurredAt: new Date('2026-11-13T12:00:00Z')
  });

  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'CONSECUTIVE_ENTER');
});

test('marks out-of-order events for review', () => {
  const gas = loadGasValidation();
  const sheet = fakeEventsSheet([
    ['user_A', 'ENTER', new Date('2026-11-13T09:00:00Z'), new Date(), 'ios_shortcut', 'OK'],
    ['user_A', 'EXIT', new Date('2026-11-13T12:00:00Z'), new Date(), 'ios_shortcut', 'OK']
  ]);

  const result = gas.inspectEventSequence_(sheet, {
    userId: 'user_A',
    eventType: 'ENTER',
    occurredAt: new Date('2026-11-13T10:00:00Z')
  });

  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'OUT_OF_ORDER');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPresenceService() {
  const context = vm.createContext({
    console,
    Date,
    Number,
    Math,
    Object,
    String,
    Boolean,
    Utilities: {
      formatDate(date, _timeZone, pattern) {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Tokyo',
          year: 'numeric',
          month: '2-digit'
        }).formatToParts(date);
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return pattern === 'yyyy' ? values.year : values.month;
      }
    }
  });
  for (const file of ['Config.gs', 'Validation.gs', 'PresenceService.gs']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'gas', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}

function event(eventId, userId, eventType, occurredAt, recordStatus = 'OK') {
  return {
    eventId,
    userId,
    eventType,
    occurredAt: new Date(occurredAt),
    source: 'test',
    recordStatus
  };
}

const USER = { userId: 'user_A', displayName: '自分' };
const START = new Date('2026-11-01T00:00:00+09:00');
const END = new Date('2026-11-02T00:00:00+09:00');

test('calculates presence across a period boundary and alternating events', () => {
  const gas = loadPresenceService();
  const result = gas.calculatePresenceSummaries_([
    event('event-0001', 'user_A', 'ENTER', '2026-10-31T23:00:00+09:00'),
    event('event-0002', 'user_A', 'EXIT', '2026-11-01T08:00:00+09:00'),
    event('event-0003', 'user_A', 'ENTER', '2026-11-01T18:00:00+09:00')
  ], [USER], START, END)[0];

  assert.equal(result.presentMinutes, 14 * 60);
  assert.equal(result.awayMinutes, 10 * 60);
  assert.equal(result.unknownMinutes, 0);
  assert.equal(result.calculationStatus, 'OK');
});

test('marks time before the first known event as unknown', () => {
  const gas = loadPresenceService();
  const result = gas.calculatePresenceSummaries_([
    event('event-0001', 'user_A', 'ENTER', '2026-11-01T08:00:00+09:00')
  ], [USER], START, END)[0];

  assert.equal(result.presentMinutes, 16 * 60);
  assert.equal(result.awayMinutes, 0);
  assert.equal(result.unknownMinutes, 8 * 60);
  assert.equal(result.calculationStatus, 'NEEDS_REVIEW');
});

test('keeps intervals around a review event unknown', () => {
  const gas = loadPresenceService();
  const result = gas.calculatePresenceSummaries_([
    event('event-0001', 'user_A', 'ENTER', '2026-10-31T23:00:00+09:00'),
    event(
      'event-0002',
      'user_A',
      'ENTER',
      '2026-11-01T08:00:00+09:00',
      'NEEDS_REVIEW'
    )
  ], [USER], START, END)[0];

  assert.equal(result.presentMinutes, 0);
  assert.equal(result.awayMinutes, 0);
  assert.equal(result.unknownMinutes, 24 * 60);
  assert.equal(result.calculationStatus, 'NEEDS_REVIEW');
});

test('VOID correction removes a bad event without overwriting the source row', () => {
  const gas = loadPresenceService();
  const corrected = gas.applyEventCorrections_([
    event('event-0001', 'user_A', 'ENTER', '2026-10-31T23:00:00+09:00'),
    event(
      'event-0002',
      'user_A',
      'ENTER',
      '2026-11-01T08:00:00+09:00',
      'NEEDS_REVIEW'
    ),
    event('event-0003', 'user_A', 'EXIT', '2026-11-01T20:00:00+09:00')
  ], [{
    correctionId: 'correct-0001',
    targetEventId: 'event-0002',
    action: 'VOID',
    sheetRow: 2
  }]);
  const result = gas.calculatePresenceSummaries_(corrected, [USER], START, END)[0];

  assert.equal(corrected.length, 2);
  assert.equal(result.presentMinutes, 20 * 60);
  assert.equal(result.awayMinutes, 4 * 60);
  assert.equal(result.unknownMinutes, 0);
});

test('ADD corrections create audited virtual events', () => {
  const gas = loadPresenceService();
  const corrected = gas.applyEventCorrections_([], [
    {
      correctionId: 'correct-0001',
      targetEventId: '',
      action: 'ADD',
      userId: 'user_A',
      eventType: 'ENTER',
      occurredAt: new Date('2026-11-01T02:00:00+09:00'),
      sheetRow: 2
    },
    {
      correctionId: 'correct-0002',
      targetEventId: '',
      action: 'ADD',
      userId: 'user_A',
      eventType: 'EXIT',
      occurredAt: new Date('2026-11-01T05:00:00+09:00'),
      sheetRow: 3
    }
  ]);
  const result = gas.calculatePresenceSummaries_(corrected, [USER], START, END)[0];

  assert.equal(result.presentMinutes, 3 * 60);
  assert.equal(result.awayMinutes, 19 * 60);
  assert.equal(result.unknownMinutes, 2 * 60);
});

test('returns one summary per enabled user', () => {
  const gas = loadPresenceService();
  const users = [USER, { userId: 'user_B', displayName: '友人' }];
  const summaries = gas.calculatePresenceSummaries_([], users, START, END);

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].unknownMinutes, 24 * 60);
  assert.equal(summaries[1].unknownMinutes, 24 * 60);
});

test('rejects an invalid calculation period', () => {
  const gas = loadPresenceService();
  assert.throws(
    () => gas.calculatePresenceSummaries_([], [USER], END, START),
    (error) => error.code === 'INVALID_PERIOD'
  );
});

test('builds current month boundaries in Asia/Tokyo', () => {
  const gas = loadPresenceService();
  const period = gas.getMonthPeriod_(new Date('2026-11-30T23:30:00+09:00'));

  assert.equal(period.start.toISOString(), '2026-10-31T15:00:00.000Z');
  assert.equal(period.end.toISOString(), '2026-11-30T15:00:00.000Z');
});

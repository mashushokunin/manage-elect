function refreshCurrentMonthPresenceSummary() {
  var now = new Date();
  var period = getMonthPeriod_(now);
  return refreshPresenceSummary_(period.start, now);
}

function refreshPresenceSummary(periodStart, periodEnd) {
  return refreshPresenceSummary_(
    normalizePeriodDate_(periodStart, 'periodStart'),
    normalizePeriodDate_(periodEnd, 'periodEnd')
  );
}

function refreshPresenceSummaryForMonth_(date, spreadsheet) {
  var period = getMonthPeriod_(date);
  var now = new Date();
  var periodEnd = now.getTime() >= period.start.getTime()
    && now.getTime() < period.end.getTime()
    ? now
    : period.end;
  return refreshPresenceSummary_(period.start, periodEnd, spreadsheet);
}

function refreshPresenceSummary_(periodStart, periodEnd, spreadsheet) {
  assertValidPeriod_(periodStart, periodEnd);
  var targetSpreadsheet = spreadsheet || getSpreadsheet_();
  var events = readPresenceEvents_(targetSpreadsheet);
  var corrections = readEventCorrections_(targetSpreadsheet);
  var correctedEvents = applyEventCorrections_(events, corrections);
  var users = readEnabledUsers_(targetSpreadsheet);
  var summaries = calculatePresenceSummaries_(
    correctedEvents,
    users,
    periodStart,
    periodEnd
  );

  writePresenceSummaries_(targetSpreadsheet, summaries, periodStart, periodEnd);
  var needsReview = summaries.some(function (summary) {
    return summary.calculationStatus !== 'OK';
  });
  appendAuditLog_(targetSpreadsheet, {
    requestId: Utilities.getUuid(),
    action: 'CALCULATE_PRESENCE',
    outcome: needsReview ? 'NEEDS_REVIEW' : 'OK',
    details: [
      'period_start=' + periodStart.toISOString(),
      'period_end=' + periodEnd.toISOString(),
      'users=' + summaries.length
    ].join(', ')
  });

  return {
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    summaries: summaries.map(function (summary) {
      return {
        user_id: summary.userId,
        display_name: summary.displayName,
        present_minutes: summary.presentMinutes,
        away_minutes: summary.awayMinutes,
        unknown_minutes: summary.unknownMinutes,
        period_minutes: summary.periodMinutes,
        calculation_status: summary.calculationStatus
      };
    })
  };
}

function normalizePeriodDate_(value, fieldName) {
  var date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError('INVALID_PERIOD', fieldName + 'を日時として解釈できません。');
  }
  return date;
}

function assertValidPeriod_(periodStart, periodEnd) {
  if (!(periodStart instanceof Date) || Number.isNaN(periodStart.getTime())) {
    throw new ApiError('INVALID_PERIOD', 'periodStartが不正です。');
  }
  if (!(periodEnd instanceof Date) || Number.isNaN(periodEnd.getTime())) {
    throw new ApiError('INVALID_PERIOD', 'periodEndが不正です。');
  }
  if (periodStart.getTime() >= periodEnd.getTime()) {
    throw new ApiError('INVALID_PERIOD', 'periodEndはperiodStartより後にしてください。');
  }
}

function getMonthPeriod_(date) {
  var normalized = normalizePeriodDate_(date, 'date');
  var year = Number(Utilities.formatDate(normalized, APP_CONFIG.TIME_ZONE, 'yyyy'));
  var month = Number(Utilities.formatDate(normalized, APP_CONFIG.TIME_ZONE, 'MM'));
  var nextYear = month === 12 ? year + 1 : year;
  var nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: new Date(
      year + '-' + padTwoDigits_(month) + '-01T00:00:00+09:00'
    ),
    end: new Date(
      nextYear + '-' + padTwoDigits_(nextMonth) + '-01T00:00:00+09:00'
    )
  };
}

function padTwoDigits_(value) {
  return value < 10 ? '0' + value : String(value);
}

function readPresenceEvents_(spreadsheet) {
  var eventsSheet = getRequiredSheet_(spreadsheet, APP_CONFIG.SHEETS.EVENTS);
  if (eventsSheet.getLastRow() < 2) {
    return [];
  }
  return eventsSheet
    .getRange(2, 1, eventsSheet.getLastRow() - 1, APP_CONFIG.HEADERS.EVENTS.length)
    .getValues()
    .map(function (row) {
      return {
        eventId: String(row[0] || '').trim(),
        userId: String(row[1] || '').trim(),
        eventType: String(row[2] || '').trim().toUpperCase(),
        occurredAt: row[3],
        source: String(row[5] || '').trim(),
        recordStatus: String(row[6] || '').trim().toUpperCase()
      };
    })
    .filter(function (event) {
      return event.eventId && event.userId;
    });
}

function readEventCorrections_(spreadsheet) {
  var correctionsSheet = getRequiredSheet_(spreadsheet, APP_CONFIG.SHEETS.CORRECTIONS);
  if (correctionsSheet.getLastRow() < 2) {
    return [];
  }
  var seenIds = {};
  return correctionsSheet
    .getRange(
      2,
      1,
      correctionsSheet.getLastRow() - 1,
      APP_CONFIG.HEADERS.CORRECTIONS.length
    )
    .getValues()
    .map(function (row, index) {
      return parseCorrectionRow_(row, index + 2, seenIds);
    })
    .filter(Boolean);
}

function parseCorrectionRow_(row, sheetRow, seenIds) {
  var values = row.map(function (value) {
    return value instanceof Date ? value : String(value || '').trim();
  });
  if (values.every(function (value) { return value === ''; })) {
    return null;
  }

  var correctionId = String(values[0] || '').trim();
  var targetEventId = String(values[1] || '').trim();
  var action = String(values[2] || '').trim().toUpperCase();
  var userId = String(values[3] || '').trim();
  var eventType = String(values[4] || '').trim().toUpperCase();
  var occurredAt = values[5] instanceof Date ? values[5] : new Date(values[5]);

  if (!/^[A-Za-z0-9_-]{8,128}$/.test(correctionId)) {
    throw invalidCorrection_(sheetRow, 'correction_idの形式が不正です。');
  }
  if (seenIds[correctionId]) {
    throw invalidCorrection_(sheetRow, 'correction_idが重複しています。');
  }
  seenIds[correctionId] = true;
  if (['ADD', 'REPLACE', 'VOID'].indexOf(action) === -1) {
    throw invalidCorrection_(sheetRow, 'actionはADD、REPLACE、VOIDのいずれかです。');
  }
  if ((action === 'REPLACE' || action === 'VOID') && !targetEventId) {
    throw invalidCorrection_(sheetRow, 'target_event_idが必要です。');
  }
  if (action !== 'VOID') {
    if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
      throw invalidCorrection_(sheetRow, 'user_idの形式が不正です。');
    }
    if (eventType !== 'ENTER' && eventType !== 'EXIT') {
      throw invalidCorrection_(sheetRow, 'event_typeはENTERまたはEXITです。');
    }
    if (Number.isNaN(occurredAt.getTime())) {
      throw invalidCorrection_(sheetRow, 'occurred_atが不正です。');
    }
  }

  return {
    correctionId: correctionId,
    targetEventId: targetEventId,
    action: action,
    userId: userId,
    eventType: eventType,
    occurredAt: occurredAt,
    sheetRow: sheetRow
  };
}

function invalidCorrection_(sheetRow, message) {
  return new ApiError(
    'INVALID_CORRECTION',
    APP_CONFIG.SHEETS.CORRECTIONS + 'の' + sheetRow + '行目: ' + message
  );
}

function applyEventCorrections_(events, corrections) {
  var originalById = {};
  var activeById = {};
  events.forEach(function (event) {
    originalById[event.eventId] = cloneEvent_(event);
    if (event.recordStatus !== 'VOID') {
      activeById[event.eventId] = cloneEvent_(event);
    }
  });

  corrections.forEach(function (correction) {
    if (correction.action === 'ADD') {
      var addedEventId = 'correction_' + correction.correctionId;
      activeById[addedEventId] = {
        eventId: addedEventId,
        userId: correction.userId,
        eventType: correction.eventType,
        occurredAt: new Date(correction.occurredAt.getTime()),
        source: 'manual_correction',
        recordStatus: 'OK'
      };
      return;
    }

    var target = activeById[correction.targetEventId]
      || originalById[correction.targetEventId];
    if (!target) {
      throw invalidCorrection_(
        correction.sheetRow,
        'target_event_idに一致するイベントがありません。'
      );
    }
    if (correction.action === 'VOID') {
      delete activeById[correction.targetEventId];
      return;
    }

    activeById[correction.targetEventId] = {
      eventId: correction.targetEventId,
      userId: correction.userId,
      eventType: correction.eventType,
      occurredAt: new Date(correction.occurredAt.getTime()),
      source: 'manual_correction',
      recordStatus: 'OK'
    };
  });

  return Object.keys(activeById).map(function (eventId) {
    return activeById[eventId];
  });
}

function cloneEvent_(event) {
  return {
    eventId: event.eventId,
    userId: event.userId,
    eventType: event.eventType,
    occurredAt: event.occurredAt instanceof Date
      ? new Date(event.occurredAt.getTime())
      : event.occurredAt,
    source: event.source,
    recordStatus: event.recordStatus
  };
}

function readEnabledUsers_(spreadsheet) {
  var usersSheet = getRequiredSheet_(spreadsheet, APP_CONFIG.SHEETS.USERS);
  if (usersSheet.getLastRow() < 2) {
    return [];
  }
  return usersSheet
    .getRange(2, 1, usersSheet.getLastRow() - 1, 3)
    .getValues()
    .filter(function (row) {
      return String(row[0] || '').trim() && isEnabledValue_(row[2]);
    })
    .map(function (row) {
      return {
        userId: String(row[0]).trim(),
        displayName: String(row[1] || row[0]).trim()
      };
    });
}

function calculatePresenceSummaries_(events, users, periodStart, periodEnd) {
  assertValidPeriod_(periodStart, periodEnd);
  return users.map(function (user) {
    var userEvents = events
      .filter(function (event) {
        return event.userId === user.userId
          && event.occurredAt instanceof Date
          && !Number.isNaN(event.occurredAt.getTime())
          && event.occurredAt.getTime() < periodEnd.getTime();
      })
      .sort(comparePresenceEvents_);
    return calculateUserPresence_(user, userEvents, periodStart, periodEnd);
  });
}

function comparePresenceEvents_(left, right) {
  var timeDifference = left.occurredAt.getTime() - right.occurredAt.getTime();
  return timeDifference || String(left.eventId).localeCompare(String(right.eventId));
}

function calculateUserPresence_(user, events, periodStart, periodEnd) {
  var previous = null;
  var inPeriod = [];
  events.forEach(function (event) {
    if (event.occurredAt.getTime() < periodStart.getTime()) {
      previous = event;
    } else {
      inPeriod.push(event);
    }
  });

  var presentMilliseconds = 0;
  var awayMilliseconds = 0;
  var unknownMilliseconds = 0;
  var cursor = periodStart.getTime();

  inPeriod.forEach(function (event) {
    var eventTime = Math.min(event.occurredAt.getTime(), periodEnd.getTime());
    var duration = Math.max(0, eventTime - cursor);
    var classification = classifyPresenceInterval_(previous, event);
    if (classification === 'PRESENT') {
      presentMilliseconds += duration;
    } else if (classification === 'AWAY') {
      awayMilliseconds += duration;
    } else {
      unknownMilliseconds += duration;
    }
    cursor = eventTime;
    previous = event;
  });

  var tailDuration = Math.max(0, periodEnd.getTime() - cursor);
  var tailClassification = classifyPresenceTail_(previous);
  if (tailClassification === 'PRESENT') {
    presentMilliseconds += tailDuration;
  } else if (tailClassification === 'AWAY') {
    awayMilliseconds += tailDuration;
  } else {
    unknownMilliseconds += tailDuration;
  }

  var periodMilliseconds = periodEnd.getTime() - periodStart.getTime();
  return {
    userId: user.userId,
    displayName: user.displayName,
    presentMinutes: millisecondsToMinutes_(presentMilliseconds),
    awayMinutes: millisecondsToMinutes_(awayMilliseconds),
    unknownMinutes: millisecondsToMinutes_(unknownMilliseconds),
    periodMinutes: millisecondsToMinutes_(periodMilliseconds),
    calculationStatus: unknownMilliseconds > 0 ? 'NEEDS_REVIEW' : 'OK'
  };
}

function classifyPresenceInterval_(previous, current) {
  if (!isReliablePresenceEvent_(previous) || !isReliablePresenceEvent_(current)) {
    return 'UNKNOWN';
  }
  if (previous.eventType === current.eventType) {
    return 'UNKNOWN';
  }
  return previous.eventType === 'ENTER' ? 'PRESENT' : 'AWAY';
}

function classifyPresenceTail_(event) {
  if (!isReliablePresenceEvent_(event)) {
    return 'UNKNOWN';
  }
  return event.eventType === 'ENTER' ? 'PRESENT' : 'AWAY';
}

function isReliablePresenceEvent_(event) {
  return Boolean(
    event
    && event.recordStatus === 'OK'
    && (event.eventType === 'ENTER' || event.eventType === 'EXIT')
  );
}

function millisecondsToMinutes_(milliseconds) {
  return Math.round(milliseconds / 600) / 100;
}

function writePresenceSummaries_(spreadsheet, summaries, periodStart, periodEnd) {
  var summarySheet = getRequiredSheet_(spreadsheet, APP_CONFIG.SHEETS.PRESENCE_SUMMARY);
  var lastRow = summarySheet.getLastRow();
  if (lastRow > 1) {
    summarySheet
      .getRange(2, 1, lastRow - 1, APP_CONFIG.HEADERS.PRESENCE_SUMMARY.length)
      .clearContent();
  }
  if (summaries.length === 0) {
    return;
  }

  var calculatedAt = new Date();
  var rows = summaries.map(function (summary) {
    return [
      periodStart,
      periodEnd,
      summary.userId,
      summary.displayName,
      summary.presentMinutes,
      summary.awayMinutes,
      summary.unknownMinutes,
      summary.periodMinutes,
      summary.calculationStatus,
      calculatedAt
    ];
  });
  summarySheet
    .getRange(2, 1, rows.length, APP_CONFIG.HEADERS.PRESENCE_SUMMARY.length)
    .setValues(rows);
}

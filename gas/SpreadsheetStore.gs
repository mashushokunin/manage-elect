function getSpreadsheet_() {
  return SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
}

function getRequiredSheet_(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new ApiError(
      'PROJECT_NOT_INITIALIZED',
      'setupProjectを実行してスプレッドシートを初期化してください。'
    );
  }
  return sheet;
}

function getRuntimeSettings_(spreadsheet) {
  var settingsSheet = getRequiredSheet_(spreadsheet, APP_CONFIG.SHEETS.SETTINGS);
  var values = settingsSheet.getDataRange().getValues();
  var settings = {};

  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    var key = String(values[rowIndex][0] || '').trim();
    if (key) {
      settings[key] = values[rowIndex][1];
    }
  }

  return {
    maxPastEventHours: readPositiveNumberSetting_(
      settings.MAX_PAST_EVENT_HOURS,
      APP_CONFIG.DEFAULTS.MAX_PAST_EVENT_HOURS
    ),
    maxFutureEventMinutes: readPositiveNumberSetting_(
      settings.MAX_FUTURE_EVENT_MINUTES,
      APP_CONFIG.DEFAULTS.MAX_FUTURE_EVENT_MINUTES
    )
  };
}

function readPositiveNumberSetting_(value, fallback) {
  if (value === '' || value == null) {
    return fallback;
  }
  var parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function assertUserEnabled_(spreadsheet, userId) {
  var usersSheet = getRequiredSheet_(spreadsheet, APP_CONFIG.SHEETS.USERS);
  var lastRow = usersSheet.getLastRow();
  if (lastRow < 2) {
    throw new ApiError('USER_NOT_FOUND', 'ユーザーが登録されていません。');
  }

  var rows = usersSheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (var index = 0; index < rows.length; index += 1) {
    if (String(rows[index][0]).trim() === userId) {
      if (!isEnabledValue_(rows[index][2])) {
        throw new ApiError('USER_DISABLED', 'このユーザーは無効です。');
      }
      return;
    }
  }
  throw new ApiError('USER_NOT_FOUND', 'ユーザーが登録されていません。');
}

function isEnabledValue_(value) {
  if (value === true || value === 1) {
    return true;
  }
  var normalized = String(value || '').trim().toUpperCase();
  return normalized === 'TRUE' || normalized === '1' || normalized === '有効';
}

function findEventRowById_(eventsSheet, eventId) {
  var lastRow = eventsSheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }
  var match = eventsSheet
    .getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(eventId)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : null;
}

function inspectEventSequence_(eventsSheet, eventData) {
  var lastRow = eventsSheet.getLastRow();
  if (lastRow < 2) {
    return { status: 'OK', reason: '' };
  }

  var rows = eventsSheet.getRange(2, 2, lastRow - 1, 6).getValues();
  var latest = null;
  for (var index = 0; index < rows.length; index += 1) {
    var userId = String(rows[index][0] || '').trim();
    var eventType = String(rows[index][1] || '').trim();
    var occurredAt = rows[index][2];
    var recordStatus = String(rows[index][5] || '').trim();

    if (
      userId !== eventData.userId ||
      !(occurredAt instanceof Date) ||
      Number.isNaN(occurredAt.getTime()) ||
      recordStatus === 'VOID'
    ) {
      continue;
    }

    if (!latest || occurredAt.getTime() > latest.occurredAt.getTime()) {
      latest = { eventType: eventType, occurredAt: occurredAt };
    }
  }

  if (!latest) {
    return { status: 'OK', reason: '' };
  }

  var reasons = [];
  if (eventData.occurredAt.getTime() <= latest.occurredAt.getTime()) {
    reasons.push('OUT_OF_ORDER');
  }
  if (eventData.eventType === latest.eventType) {
    reasons.push('CONSECUTIVE_' + eventData.eventType);
  }

  return reasons.length > 0
    ? { status: 'NEEDS_REVIEW', reason: reasons.join(',') }
    : { status: 'OK', reason: '' };
}

function appendAuditLog_(spreadsheet, entry) {
  var auditSheet = spreadsheet.getSheetByName(APP_CONFIG.SHEETS.AUDIT);
  if (!auditSheet) {
    return;
  }
  auditSheet.appendRow([
    new Date(),
    entry.requestId || '',
    entry.action || '',
    entry.userId || '',
    entry.outcome || '',
    entry.details || ''
  ]);
}

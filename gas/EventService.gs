function recordPresenceEvent_(payload, requestId) {
  var spreadsheet = getSpreadsheet_();
  var runtimeSettings = getRuntimeSettings_(spreadsheet);
  var now = new Date();
  var eventData = validatePayload_(payload, runtimeSettings, now);

  authenticateUser_(eventData.userId, eventData.token);
  assertUserEnabled_(spreadsheet, eventData.userId);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new ApiError('SERVICE_BUSY', '処理が混み合っています。少し待って再送してください。');
  }

  try {
    var eventsSheet = getRequiredSheet_(spreadsheet, APP_CONFIG.SHEETS.EVENTS);
    var duplicateRow = findEventRowById_(eventsSheet, eventData.eventId);
    if (duplicateRow) {
      appendAuditLog_(spreadsheet, {
        requestId: requestId,
        action: 'RECEIVE_EVENT',
        userId: eventData.userId,
        outcome: 'DUPLICATE',
        details: 'event_id=' + eventData.eventId + ', row=' + duplicateRow
      });
      return {
        duplicate: true,
        eventId: eventData.eventId,
        recordStatus: String(eventsSheet.getRange(duplicateRow, 7).getValue() || 'OK'),
        row: duplicateRow
      };
    }

    var sequence = inspectEventSequence_(eventsSheet, eventData);
    eventsSheet.appendRow([
      eventData.eventId,
      eventData.userId,
      eventData.eventType,
      eventData.occurredAt,
      now,
      eventData.source,
      sequence.status,
      sequence.reason,
      requestId
    ]);
    var appendedRow = eventsSheet.getLastRow();
    eventsSheet.getRange(appendedRow, 4, 1, 2).setNumberFormat('yyyy/MM/dd HH:mm:ss');

    appendAuditLog_(spreadsheet, {
      requestId: requestId,
      action: 'RECEIVE_EVENT',
      userId: eventData.userId,
      outcome: sequence.status,
      details: [
        'event_id=' + eventData.eventId,
        'event_type=' + eventData.eventType,
        sequence.reason ? 'reason=' + sequence.reason : ''
      ].filter(String).join(', ')
    });

    return {
      duplicate: false,
      eventId: eventData.eventId,
      recordStatus: sequence.status,
      reviewReason: sequence.reason,
      row: appendedRow
    };
  } finally {
    lock.releaseLock();
  }
}

function authenticateUser_(userId, suppliedToken) {
  var rawTokens = PropertiesService
    .getScriptProperties()
    .getProperty(APP_CONFIG.SCRIPT_PROPERTIES.USER_TOKENS_JSON);

  if (!rawTokens) {
    throw new ApiError('SECRET_NOT_CONFIGURED', '認証設定が完了していません。');
  }

  var tokens;
  try {
    tokens = JSON.parse(rawTokens);
  } catch (error) {
    throw new ApiError('SECRET_CONFIG_INVALID', '認証設定のJSONが不正です。');
  }

  var expectedToken = tokens && tokens[userId];
  if (!expectedToken || !constantTimeEquals_(suppliedToken, expectedToken)) {
    throw new ApiError('AUTH_FAILED', '認証に失敗しました。');
  }
}

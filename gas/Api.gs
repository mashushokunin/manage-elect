function doGet() {
  return jsonResponse_({
    ok: true,
    service: 'manage-elect',
    version: APP_CONFIG.VERSION,
    time_zone: APP_CONFIG.TIME_ZONE,
    server_time: new Date().toISOString()
  });
}

function doPost(event) {
  var requestId = Utilities.getUuid();
  try {
    var payload = parseRequestBody_(event);
    var result = recordPresenceEvent_(payload, requestId);
    return jsonResponse_({
      ok: true,
      request_id: requestId,
      duplicate: result.duplicate,
      event_id: result.eventId,
      record_status: result.recordStatus,
      review_reason: result.reviewReason || '',
      row: result.row
    });
  } catch (error) {
    var isExpected = error instanceof ApiError;
    var code = isExpected ? error.code : 'INTERNAL_ERROR';
    var message = isExpected ? error.message : 'サーバー内部でエラーが発生しました。';
    console.error(JSON.stringify({
      requestId: requestId,
      code: code,
      name: error && error.name,
      message: error && error.message
    }));
    return jsonResponse_({
      ok: false,
      request_id: requestId,
      code: code,
      message: message
    });
  }
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

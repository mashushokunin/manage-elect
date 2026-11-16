function handleLineWebhookRequest_(payload, requestId) {
  assertLineGatewaySecret_(payload.gateway_secret);

  if (!Array.isArray(payload.events)) {
    throw new ApiError('INVALID_LINE_WEBHOOK', 'LINEイベントの形式が不正です。');
  }

  var replies = [];
  payload.events.forEach(function (event) {
    if (!event || typeof event !== 'object') {
      return;
    }

    var replyToken = String(event.replyToken || '').trim();
    if (
      event.type !== 'message' ||
      !event.message ||
      event.message.type !== 'text' ||
      !replyToken
    ) {
      return;
    }

    replies.push({
      reply_token: replyToken,
      messages: buildLineReplyMessages_(event.message.text)
    });
  });

  var spreadsheet = getSpreadsheet_();
  appendAuditLog_(spreadsheet, {
    requestId: requestId,
    action: 'LINE_WEBHOOK',
    userId: '',
    outcome: 'OK',
    details: 'events=' + payload.events.length + ', replies=' + replies.length
  });

  return { processed: payload.events.length, replies: replies };
}

function assertLineGatewaySecret_(providedSecret) {
  var configuredSecret = PropertiesService.getScriptProperties().getProperty(
    APP_CONFIG.SCRIPT_PROPERTIES.LINE_GATEWAY_SECRET
  );
  if (!configuredSecret) {
    throw new ApiError(
      'LINE_GATEWAY_SECRET_NOT_CONFIGURED',
      'LINE連携用の認証設定が完了していません。'
    );
  }

  if (!providedSecret || !constantTimeEquals_(configuredSecret, String(providedSecret))) {
    throw new ApiError('LINE_GATEWAY_UNAUTHORIZED', 'LINE連携の認証に失敗しました。');
  }
}

function buildLineReplyMessages_(text) {
  var normalized = String(text || '').trim();
  var responseText;

  if (/^(接続テスト|テスト|ping)$/i.test(normalized)) {
    responseText = [
      '接続できています。',
      'LINE → Supabase → Apps Script → LINE の通信に成功しました。'
    ].join('\n');
  } else {
    responseText = [
      'メッセージを受信しました。',
      '現在は接続確認まで完了しています。',
      '「接続テスト」と送ると疎通確認ができます。'
    ].join('\n');
  }

  return [{ type: 'text', text: responseText }];
}

var ApiError = class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
};

function parseRequestBody_(event) {
  if (!event) {
    throw new ApiError('EMPTY_REQUEST', 'リクエストが空です。');
  }

  var contents = event.postData && event.postData.contents;
  if (contents) {
    try {
      var parsed = JSON.parse(contents);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('JSON object required');
      }
      return parsed;
    } catch (error) {
      throw new ApiError('INVALID_JSON', 'JSON形式のリクエスト本文が必要です。');
    }
  }

  if (event.parameter && Object.keys(event.parameter).length > 0) {
    return event.parameter;
  }

  throw new ApiError('EMPTY_BODY', 'リクエスト本文が空です。');
}

function validatePayload_(payload, runtimeSettings, now) {
  var userId = requireString_(payload.user_id, 'user_id', 64);
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
    throw new ApiError('INVALID_USER_ID', 'user_idの形式が不正です。');
  }

  var token = requireString_(payload.token, 'token', 256);
  var eventType = requireString_(payload.event || payload.event_type, 'event', 16).toUpperCase();
  if (eventType !== 'ENTER' && eventType !== 'EXIT') {
    throw new ApiError('INVALID_EVENT', 'eventはENTERまたはEXITを指定してください。');
  }

  var timestamp = requireString_(payload.timestamp || payload.occurred_at, 'timestamp', 64);
  var isoWithTimeZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoWithTimeZone.test(timestamp)) {
    throw new ApiError(
      'INVALID_TIMESTAMP',
      'timestampはタイムゾーン付きISO 8601形式で指定してください。'
    );
  }

  var occurredAt = new Date(timestamp);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new ApiError('INVALID_TIMESTAMP', 'timestampを日時として解釈できません。');
  }

  var referenceTime = now || new Date();
  var ageMilliseconds = referenceTime.getTime() - occurredAt.getTime();
  var maxPastMilliseconds = runtimeSettings.maxPastEventHours * 60 * 60 * 1000;
  var maxFutureMilliseconds = runtimeSettings.maxFutureEventMinutes * 60 * 1000;

  if (ageMilliseconds > maxPastMilliseconds) {
    throw new ApiError('EVENT_TOO_OLD', '許容期間を超えて古いイベントです。');
  }
  if (ageMilliseconds < -maxFutureMilliseconds) {
    throw new ApiError('EVENT_IN_FUTURE', '未来時刻のイベントは記録できません。');
  }

  var source = payload.source == null ? 'ios_shortcut' : requireString_(payload.source, 'source', 32);
  if (!/^[A-Za-z0-9_-]+$/.test(source)) {
    throw new ApiError('INVALID_SOURCE', 'sourceの形式が不正です。');
  }

  var eventId = payload.event_id == null || String(payload.event_id).trim() === ''
    ? createEventFingerprint_(userId, eventType, occurredAt)
    : requireString_(payload.event_id, 'event_id', 128);

  if (!/^[A-Za-z0-9_-]{8,128}$/.test(eventId)) {
    throw new ApiError('INVALID_EVENT_ID', 'event_idの形式が不正です。');
  }

  return {
    token: token,
    userId: userId,
    eventType: eventType,
    occurredAt: occurredAt,
    eventId: eventId,
    source: source
  };
}

function requireString_(value, fieldName, maxLength) {
  if (value == null || String(value).trim() === '') {
    throw new ApiError('MISSING_FIELD', fieldName + 'は必須です。');
  }
  var normalized = String(value).trim();
  if (normalized.length > maxLength) {
    throw new ApiError('FIELD_TOO_LONG', fieldName + 'が長すぎます。');
  }
  return normalized;
}

function createEventFingerprint_(userId, eventType, occurredAt) {
  var raw = [userId, eventType, occurredAt.toISOString()].join('|');
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw,
    Utilities.Charset.UTF_8
  );
  return 'auto_' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
}

function constantTimeEquals_(left, right) {
  var leftDigest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(left),
    Utilities.Charset.UTF_8
  );
  var rightDigest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(right),
    Utilities.Charset.UTF_8
  );

  var difference = leftDigest.length ^ rightDigest.length;
  var length = Math.max(leftDigest.length, rightDigest.length);
  for (var index = 0; index < length; index += 1) {
    difference |= (leftDigest[index] || 0) ^ (rightDigest[index] || 0);
  }
  return difference === 0;
}

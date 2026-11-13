var APP_CONFIG = Object.freeze({
  VERSION: '0.1.0',
  SPREADSHEET_ID: '1dDeKq9-aKaXM2ezV5It8_xqb-Wji8adMMTPNaPKkuTI',
  TIME_ZONE: 'Asia/Tokyo',
  SHEETS: Object.freeze({
    EVENTS: '在宅イベント',
    USERS: 'ユーザー',
    SETTINGS: '設定',
    AUDIT: '監査ログ'
  }),
  SCRIPT_PROPERTIES: Object.freeze({
    USER_TOKENS_JSON: 'USER_TOKENS_JSON'
  }),
  DEFAULTS: Object.freeze({
    MAX_PAST_EVENT_HOURS: 168,
    MAX_FUTURE_EVENT_MINUTES: 10
  }),
  HEADERS: Object.freeze({
    EVENTS: Object.freeze([
      'event_id',
      'user_id',
      'event_type',
      'occurred_at',
      'received_at',
      'source',
      'record_status',
      'review_reason',
      'request_id'
    ]),
    USERS: Object.freeze(['user_id', 'display_name', 'enabled']),
    SETTINGS: Object.freeze(['key', 'value', 'description']),
    AUDIT: Object.freeze([
      'logged_at',
      'request_id',
      'action',
      'user_id',
      'outcome',
      'details'
    ])
  })
});

var APP_CONFIG = Object.freeze({
  VERSION: '0.3.0',
  SPREADSHEET_ID: '1dDeKq9-aKaXM2ezV5It8_xqb-Wji8adMMTPNaPKkuTI',
  TIME_ZONE: 'Asia/Tokyo',
  SHEETS: Object.freeze({
    EVENTS: '在宅イベント',
    CORRECTIONS: 'イベント修正',
    PRESENCE_SUMMARY: '在宅集計',
    BILLING_ITEMS: '請求項目',
    BILLS: '請求履歴',
    ALLOCATIONS: '按分結果',
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
    CORRECTIONS: Object.freeze([
      'correction_id',
      'target_event_id',
      'action',
      'user_id',
      'event_type',
      'occurred_at',
      'reason',
      'corrected_by',
      'corrected_at'
    ]),
    PRESENCE_SUMMARY: Object.freeze([
      'period_start',
      'period_end',
      'user_id',
      'display_name',
      'present_minutes',
      'away_minutes',
      'unknown_minutes',
      'period_minutes',
      'calculation_status',
      'calculated_at'
    ]),
    BILLING_ITEMS: Object.freeze([
      'billing_item_id',
      'provider_name',
      'display_name',
      'enabled',
      'display_order'
    ]),
    BILLS: Object.freeze([
      'bill_id',
      'billing_item_id',
      'period_start',
      'period_end',
      'amount_yen',
      'entered_by',
      'entered_at',
      'calculation_status',
      'calculated_at',
      'unknown_minutes',
      'notes'
    ]),
    ALLOCATIONS: Object.freeze([
      'calculation_id',
      'bill_id',
      'user_id',
      'display_name',
      'present_minutes',
      'unknown_minutes',
      'ratio',
      'raw_amount_yen',
      'amount_yen',
      'calculated_at'
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

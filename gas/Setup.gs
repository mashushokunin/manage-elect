function setupProject() {
  var spreadsheet = getSpreadsheet_();
  spreadsheet.setSpreadsheetTimeZone(APP_CONFIG.TIME_ZONE);

  var eventsSheet = getOrCreateEventsSheet_(spreadsheet);
  var usersSheet = getOrCreateSheet_(spreadsheet, APP_CONFIG.SHEETS.USERS);
  var settingsSheet = getOrCreateSheet_(spreadsheet, APP_CONFIG.SHEETS.SETTINGS);
  var auditSheet = getOrCreateSheet_(spreadsheet, APP_CONFIG.SHEETS.AUDIT);

  ensureHeaders_(eventsSheet, APP_CONFIG.HEADERS.EVENTS);
  ensureHeaders_(usersSheet, APP_CONFIG.HEADERS.USERS);
  ensureHeaders_(settingsSheet, APP_CONFIG.HEADERS.SETTINGS);
  ensureHeaders_(auditSheet, APP_CONFIG.HEADERS.AUDIT);

  seedUsers_(usersSheet);
  seedSettings_(settingsSheet);
  formatProjectSheets_(eventsSheet, usersSheet, settingsSheet, auditSheet);

  appendAuditLog_(spreadsheet, {
    requestId: 'MANUAL_SETUP',
    action: 'SETUP_PROJECT',
    outcome: 'OK',
    details: 'version=' + APP_CONFIG.VERSION
  });

  var result = checkProjectSetup();
  console.log(JSON.stringify(result));
  return result;
}

function checkProjectSetup() {
  var spreadsheet = getSpreadsheet_();
  var missingSheets = Object.keys(APP_CONFIG.SHEETS)
    .map(function (key) { return APP_CONFIG.SHEETS[key]; })
    .filter(function (sheetName) { return !spreadsheet.getSheetByName(sheetName); });

  var tokenProperty = PropertiesService
    .getScriptProperties()
    .getProperty(APP_CONFIG.SCRIPT_PROPERTIES.USER_TOKENS_JSON);

  var tokenUsers = [];
  var tokenConfigValid = false;
  if (tokenProperty) {
    try {
      var parsedTokens = JSON.parse(tokenProperty);
      tokenUsers = Object.keys(parsedTokens || {});
      tokenConfigValid = parsedTokens && typeof parsedTokens === 'object' && !Array.isArray(parsedTokens);
    } catch (error) {
      tokenConfigValid = false;
    }
  }

  return {
    ready: missingSheets.length === 0 && tokenConfigValid && tokenUsers.length >= 2,
    spreadsheet_id: APP_CONFIG.SPREADSHEET_ID,
    time_zone: spreadsheet.getSpreadsheetTimeZone(),
    missing_sheets: missingSheets,
    token_configured: Boolean(tokenProperty),
    token_config_valid: tokenConfigValid,
    token_users: tokenUsers,
    version: APP_CONFIG.VERSION
  };
}

function getOrCreateEventsSheet_(spreadsheet) {
  var existing = spreadsheet.getSheetByName(APP_CONFIG.SHEETS.EVENTS);
  if (existing) {
    return existing;
  }

  var sheets = spreadsheet.getSheets();
  if (sheets.length === 1) {
    var onlySheet = sheets[0];
    var isDefaultName = onlySheet.getName() === 'シート1' || onlySheet.getName() === 'Sheet1';
    if (isDefaultName && onlySheet.getLastRow() === 0 && onlySheet.getLastColumn() === 0) {
      onlySheet.setName(APP_CONFIG.SHEETS.EVENTS);
      return onlySheet;
    }
  }
  return spreadsheet.insertSheet(APP_CONFIG.SHEETS.EVENTS);
}

function getOrCreateSheet_(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function ensureHeaders_(sheet, expectedHeaders) {
  var lastColumn = sheet.getLastColumn();
  if (sheet.getLastRow() === 0 || lastColumn === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    return;
  }

  var existingHeaders = sheet.getRange(1, 1, 1, expectedHeaders.length).getValues()[0];
  var matches = expectedHeaders.every(function (header, index) {
    return String(existingHeaders[index] || '').trim() === header;
  });
  if (!matches) {
    throw new Error(sheet.getName() + 'のヘッダーが想定と異なります。既存データを確認してください。');
  }
}

function seedUsers_(usersSheet) {
  if (usersSheet.getLastRow() >= 2) {
    return;
  }
  usersSheet.getRange(2, 1, 2, 3).setValues([
    ['user_A', '自分', true],
    ['user_B', '友人', true]
  ]);
}

function seedSettings_(settingsSheet) {
  var existingKeys = {};
  if (settingsSheet.getLastRow() >= 2) {
    settingsSheet
      .getRange(2, 1, settingsSheet.getLastRow() - 1, 1)
      .getValues()
      .forEach(function (row) { existingKeys[String(row[0] || '').trim()] = true; });
  }

  var rows = [
    [
      'MAX_PAST_EVENT_HOURS',
      APP_CONFIG.DEFAULTS.MAX_PAST_EVENT_HOURS,
      'この時間より古いイベントを拒否する'
    ],
    [
      'MAX_FUTURE_EVENT_MINUTES',
      APP_CONFIG.DEFAULTS.MAX_FUTURE_EVENT_MINUTES,
      'この分数より未来のイベントを拒否する'
    ]
  ].filter(function (row) { return !existingKeys[row[0]]; });

  if (rows.length > 0) {
    settingsSheet.getRange(settingsSheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  }
}

function formatProjectSheets_(eventsSheet, usersSheet, settingsSheet, auditSheet) {
  [eventsSheet, usersSheet, settingsSheet, auditSheet].forEach(function (sheet) {
    sheet.setFrozenRows(1);
    var headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
    headerRange.setFontWeight('bold').setBackground('#d9ead3');
    sheet.autoResizeColumns(1, sheet.getLastColumn());
  });

  eventsSheet.getRange('D:E').setNumberFormat('yyyy/MM/dd HH:mm:ss');
  auditSheet.getRange('A:A').setNumberFormat('yyyy/MM/dd HH:mm:ss');
  usersSheet.getRange('C2:C').insertCheckboxes();
}

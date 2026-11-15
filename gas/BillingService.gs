function processPendingBills() {
  var spreadsheet = getSpreadsheet_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new ApiError('SERVICE_BUSY', '処理が混み合っています。少し待って再実行してください。');
  }

  try {
    return processPendingBills_(spreadsheet);
  } finally {
    lock.releaseLock();
  }
}

function processPendingBills_(spreadsheet) {
  var billingItems = readBillingItems_(spreadsheet);
  var users = readEnabledUsers_(spreadsheet);
  if (users.length !== 2) {
    throw new ApiError('INVALID_USER_COUNT', '請求按分には有効なユーザーが2人必要です。');
  }

  var events = applyEventCorrections_(
    readPresenceEvents_(spreadsheet),
    readEventCorrections_(spreadsheet)
  );
  var pendingBills = readPendingBills_(spreadsheet);
  var results = [];

  pendingBills.forEach(function (bill) {
    try {
      validatePendingBill_(bill, billingItems);
      var summaries = calculatePresenceSummaries_(
        events,
        users,
        bill.periodStart,
        bill.periodEnd
      );
      var allocation = allocateBill_(bill.amountYen, summaries);
      var calculationId = Utilities.getUuid();
      var calculatedAt = new Date();
      appendAllocationResults_(
        spreadsheet,
        calculationId,
        bill.billId,
        allocation,
        calculatedAt
      );
      updateBillCalculation_(
        spreadsheet,
        bill.sheetRow,
        allocation.status,
        calculatedAt,
        allocation.totalUnknownMinutes,
        bill.notes
      );
      appendAuditLog_(spreadsheet, {
        requestId: calculationId,
        action: 'CALCULATE_BILL',
        userId: bill.enteredBy,
        outcome: allocation.status,
        details: [
          'bill_id=' + bill.billId,
          'billing_item_id=' + bill.billingItemId,
          'amount_yen=' + bill.amountYen
        ].join(', ')
      });
      results.push({
        bill_id: bill.billId,
        calculation_id: calculationId,
        status: allocation.status,
        allocations: allocation.rows
      });
    } catch (error) {
      var code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
      var message = error && error.message ? error.message : String(error);
      updateBillCalculation_(
        spreadsheet,
        bill.sheetRow,
        'ERROR',
        new Date(),
        '',
        appendBillNote_(bill.notes, '[' + code + '] ' + message)
      );
      appendAuditLog_(spreadsheet, {
        requestId: Utilities.getUuid(),
        action: 'CALCULATE_BILL',
        userId: bill.enteredBy,
        outcome: 'ERROR',
        details: 'bill_id=' + bill.billId + ', code=' + code + ', message=' + message
      });
      results.push({ bill_id: bill.billId, status: 'ERROR', code: code, message: message });
    }
  });

  return { processed: results.length, results: results };
}

function readBillingItems_(spreadsheet) {
  var sheet = getRequiredSheet_(spreadsheet, APP_CONFIG.SHEETS.BILLING_ITEMS);
  var items = {};
  if (sheet.getLastRow() < 2) {
    return items;
  }
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues().forEach(function (row) {
    var itemId = String(row[0] || '').trim();
    if (itemId) {
      items[itemId] = {
        billingItemId: itemId,
        providerName: String(row[1] || '').trim(),
        displayName: String(row[2] || itemId).trim(),
        enabled: isEnabledValue_(row[3]),
        displayOrder: Number(row[4]) || 0
      };
    }
  });
  return items;
}

function readPendingBills_(spreadsheet) {
  var sheet = getRequiredSheet_(spreadsheet, APP_CONFIG.SHEETS.BILLS);
  if (sheet.getLastRow() < 2) {
    return [];
  }
  var seenBillIds = {};
  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, APP_CONFIG.HEADERS.BILLS.length)
    .getValues()
    .map(function (row, index) {
      var billId = String(row[0] || '').trim();
      var status = String(row[7] || '').trim().toUpperCase();
      if (!billId || (status && status !== 'PENDING')) {
        return null;
      }
      if (seenBillIds[billId]) {
        throw new ApiError('DUPLICATE_BILL_ID', 'bill_idが重複しています: ' + billId);
      }
      seenBillIds[billId] = true;
      return {
        sheetRow: index + 2,
        billId: billId,
        billingItemId: String(row[1] || '').trim(),
        periodStart: row[2],
        periodEnd: row[3],
        amountYen: Number(row[4]),
        enteredBy: String(row[5] || '').trim(),
        enteredAt: row[6],
        notes: String(row[10] || '').trim()
      };
    })
    .filter(Boolean);
}

function validatePendingBill_(bill, billingItems) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(bill.billId)) {
    throw new ApiError('INVALID_BILL_ID', 'bill_idは8文字以上の英数字・ハイフン・アンダースコアにしてください。');
  }
  var item = billingItems[bill.billingItemId];
  if (!item || !item.enabled) {
    throw new ApiError('BILLING_ITEM_DISABLED', '有効な請求項目を指定してください。');
  }
  if (!(bill.periodStart instanceof Date) || Number.isNaN(bill.periodStart.getTime())) {
    throw new ApiError('INVALID_BILL_PERIOD', 'period_startが不正です。');
  }
  if (!(bill.periodEnd instanceof Date) || Number.isNaN(bill.periodEnd.getTime())) {
    throw new ApiError('INVALID_BILL_PERIOD', 'period_endが不正です。');
  }
  assertValidPeriod_(bill.periodStart, bill.periodEnd);
  if (!Number.isInteger(bill.amountYen) || bill.amountYen < 0) {
    throw new ApiError('INVALID_BILL_AMOUNT', 'amount_yenは0以上の整数にしてください。');
  }
  if (!bill.enteredBy) {
    throw new ApiError('MISSING_ENTERED_BY', 'entered_byを入力してください。');
  }
}

function allocateBill_(amountYen, summaries) {
  if (!Number.isInteger(amountYen) || amountYen < 0) {
    throw new ApiError('INVALID_BILL_AMOUNT', '請求額は0以上の整数にしてください。');
  }
  if (!Array.isArray(summaries) || summaries.length !== 2) {
    throw new ApiError('INVALID_USER_COUNT', '請求按分には2人分の集計が必要です。');
  }

  var totalPresentMinutes = summaries.reduce(function (total, summary) {
    return total + summary.presentMinutes;
  }, 0);
  var totalUnknownMinutes = summaries.reduce(function (total, summary) {
    return total + summary.unknownMinutes;
  }, 0);

  if (totalPresentMinutes <= 0) {
    return {
      status: 'NEEDS_DECISION',
      totalPresentMinutes: 0,
      totalUnknownMinutes: totalUnknownMinutes,
      rows: summaries.map(function (summary) {
        return allocationRow_(summary, '', '', '');
      })
    };
  }

  var firstRatio = summaries[0].presentMinutes / totalPresentMinutes;
  var secondRatio = summaries[1].presentMinutes / totalPresentMinutes;
  var firstRawAmount = amountYen * firstRatio;
  var secondRawAmount = amountYen * secondRatio;
  var firstAmount = Math.round(firstRawAmount);
  var secondAmount = amountYen - firstAmount;
  var status = totalUnknownMinutes > 0 ? 'NEEDS_REVIEW' : 'CALCULATED';

  return {
    status: status,
    totalPresentMinutes: totalPresentMinutes,
    totalUnknownMinutes: totalUnknownMinutes,
    rows: [
      allocationRow_(summaries[0], firstRatio, firstRawAmount, firstAmount),
      allocationRow_(summaries[1], secondRatio, secondRawAmount, secondAmount)
    ]
  };
}

function allocationRow_(summary, ratio, rawAmountYen, amountYen) {
  return {
    userId: summary.userId,
    displayName: summary.displayName,
    presentMinutes: summary.presentMinutes,
    unknownMinutes: summary.unknownMinutes,
    ratio: ratio,
    rawAmountYen: rawAmountYen,
    amountYen: amountYen
  };
}

function appendAllocationResults_(
  spreadsheet,
  calculationId,
  billId,
  allocation,
  calculatedAt
) {
  var sheet = getRequiredSheet_(spreadsheet, APP_CONFIG.SHEETS.ALLOCATIONS);
  var rows = allocation.rows.map(function (row) {
    return [
      calculationId,
      billId,
      row.userId,
      row.displayName,
      row.presentMinutes,
      row.unknownMinutes,
      row.ratio,
      row.rawAmountYen,
      row.amountYen,
      calculatedAt
    ];
  });
  sheet
    .getRange(sheet.getLastRow() + 1, 1, rows.length, APP_CONFIG.HEADERS.ALLOCATIONS.length)
    .setValues(rows);
}

function updateBillCalculation_(
  spreadsheet,
  sheetRow,
  status,
  calculatedAt,
  unknownMinutes,
  notes
) {
  getRequiredSheet_(spreadsheet, APP_CONFIG.SHEETS.BILLS)
    .getRange(sheetRow, 8, 1, 4)
    .setValues([[status, calculatedAt, unknownMinutes, notes]]);
}

function appendBillNote_(existingNote, message) {
  return [existingNote, message].filter(String).join(' | ');
}

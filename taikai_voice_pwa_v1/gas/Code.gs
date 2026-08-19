function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");
    const ss = openSpreadsheet_(data.sheetId);
    const action = String(data.action || "").trim().toUpperCase();

    if (action === "DELETE") {
      return deleteRecord_(ss, data);
    }

    let sheetName = sanitizeSheetName_(data.point || "未設定");
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);

    const headers = [
      "受信日時","大会名","開催日","方式","地点","担当者",
      "ナンバー","認識","周回","重複","ムリ","記録時刻","記録ID"
    ];

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      new Date(),
      data.event || "",
      data.date || "",
      data.mode || "",
      data.point || "",
      data.staff || "",
      data.value || "",
      data.recognized ? "番号認識" : "ムリ",
      data.lap || "",
      data.duplicate ? "重複" : "",
      data.recognized ? "" : "ムリ",
      data.time || "",
      data.id || ""
    ]);

    return jsonOut_({ ok: true, action: "ADD", spreadsheet: ss.getName(), sheet: sheetName });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || "").trim().toUpperCase();
  if (action === "PING") {
    const callback = String(e.parameter.callback || "").replace(/[^A-Za-z0-9_$]/g, "");
    let result;
    try {
      const ss = openSpreadsheet_(e.parameter.sheetId || "");
      result = { ok: true, name: ss.getName(), id: ss.getId() };
    } catch (err) {
      result = { ok: false, error: String(err) };
    }
    if (callback) {
      return ContentService
        .createTextOutput(callback + "(" + JSON.stringify(result) + ");")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return jsonOut_(result);
  }
  return ContentService.createTextOutput("大会ナンバー受付：接続OK");
}

function openSpreadsheet_(sheetId) {
  const id = String(sheetId || "").trim();
  if (id) return SpreadsheetApp.openById(id);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function deleteRecord_(ss, data) {
  const targetId = String(data.id || "").trim();
  const targetValue = String(data.value || "").trim();
  const point = String(data.point || "").trim();
  const targetSheetName = point ? sanitizeSheetName_(point) : "";
  const targetSheet = targetSheetName ? ss.getSheetByName(targetSheetName) : null;

  if (targetSheet && targetId) {
    const row = findRowById_(targetSheet, targetId);
    if (row > 0) {
      targetSheet.deleteRow(row);
      return jsonOut_({ ok: true, deleted: true, matchedBy: "id", spreadsheet: ss.getName(), sheet: targetSheet.getName(), row: row });
    }
  }

  if (targetId) {
    const sheets = ss.getSheets();
    for (let s = 0; s < sheets.length; s++) {
      const sheet = sheets[s];
      if (targetSheet && sheet.getSheetId() === targetSheet.getSheetId()) continue;
      const row = findRowById_(sheet, targetId);
      if (row > 0) {
        sheet.deleteRow(row);
        return jsonOut_({ ok: true, deleted: true, matchedBy: "id", spreadsheet: ss.getName(), sheet: sheet.getName(), row: row });
      }
    }
  }

  if (targetSheet && targetValue) {
    const row = findLatestRowByValue_(targetSheet, targetValue);
    if (row > 0) {
      targetSheet.deleteRow(row);
      return jsonOut_({ ok: true, deleted: true, matchedBy: "value", spreadsheet: ss.getName(), sheet: targetSheet.getName(), row: row });
    }
  }

  return jsonOut_({ ok: true, deleted: false, id: targetId, value: targetValue, point: point, error: "削除対象が見つかりませんでした" });
}

function findRowById_(sheet, targetId) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return 0;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const idIndex = headers.indexOf("記録ID");
  if (idIndex < 0) return 0;
  const values = sheet.getRange(2, idIndex + 1, lastRow - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0] || "").trim() === targetId) return i + 2;
  }
  return 0;
}

function findLatestRowByValue_(sheet, targetValue) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return 0;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const valueIndex = headers.indexOf("ナンバー");
  if (valueIndex < 0) return 0;
  const values = sheet.getRange(2, valueIndex + 1, lastRow - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0] || "").trim() === targetValue) return i + 2;
  }
  return 0;
}

function sanitizeSheetName_(name) {
  let sheetName = String(name || "未設定")
    .trim()
    .replace(/[\\\/\?\*\[\]\:]/g, " ");
  if (!sheetName) sheetName = "未設定";
  return sheetName.substring(0, 100);
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

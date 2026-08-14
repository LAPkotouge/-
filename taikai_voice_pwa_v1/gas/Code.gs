function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 地点名をシート名に使用。空欄の場合は「未設定」。
    // Googleスプレッドシートで使えない文字や長すぎる名称を安全に整形。
    let sheetName = String(data.point || '未設定')
      .replace(/[\\\/\?\*\[\]:]/g, ' ')
      .trim() || '未設定';
    sheetName = sheetName.substring(0, 100);

    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);

    const headers = ['受信日時','大会名','開催日','方式','地点','担当者','ナンバー','認識','周回','重複','ムリ','記録時刻','記録ID'];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      new Date(),
      data.event || '',
      data.date || '',
      data.mode || '',
      data.point || '',
      data.staff || '',
      data.value || '',
      data.recognized ? '番号認識' : 'ムリ',
      data.lap || '',
      data.duplicate ? '重複' : '',
      data.recognized ? '' : 'ムリ',
      data.time || '',
      data.id || ''
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ok:true, sheet:sheetName}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ok:false,error:String(err)}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput('大会ナンバー受付：接続OK');
}
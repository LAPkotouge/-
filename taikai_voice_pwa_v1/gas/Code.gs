function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 指定番号削除：記録IDで最新の該当1件を安全に削除
    if (data.action === 'delete') {
      const id = String(data.id || '');
      if (!id) {
        return ContentService
          .createTextOutput(JSON.stringify({ok:false,error:'削除対象の記録IDがありません'}))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const sheetNames = ss.getSheets().map(s => s.getName());
      for (const name of sheetNames) {
        const sheet = ss.getSheetByName(name);
        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn();
        if (lastRow < 2 || lastCol < 13) continue;

        // 13列目「記録ID」だけを検索
        const ids = sheet.getRange(2, 13, lastRow - 1, 1).getValues();
        for (let i = ids.length - 1; i >= 0; i--) {
          if (String(ids[i][0]) === id) {
            sheet.deleteRow(i + 2);
            return ContentService
              .createTextOutput(JSON.stringify({ok:true, action:'delete', id:id, sheet:name}))
              .setMimeType(ContentService.MimeType.JSON);
          }
        }
      }

      return ContentService
        .createTextOutput(JSON.stringify({ok:false,error:'該当する記録IDが見つかりませんでした',id:id}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 通常の受付データ登録
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
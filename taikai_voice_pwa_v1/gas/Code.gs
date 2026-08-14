const SHEET_NAME = '記録データ';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['受信日時','大会名','開催日','方式','地点','担当者','ナンバー','認識','周回','重複','ムリ','記録時刻','ID']);
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

    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(err)})).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput('大会ナンバー受付：接続OK');
}
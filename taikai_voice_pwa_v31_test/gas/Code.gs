const RECORD_HEADERS=["No.","受信日時","大会名","開催日","方式","地点","担当者","記録時刻","ナンバー","認識","周回","重複","ムリ","記録ID"];

function doGet(e){
  const p=(e&&e.parameter)||{},action=String(p.action||"").trim().toUpperCase(),cb=String(p.callback||"").replace(/[^A-Za-z0-9_$]/g,"");
  try{
    let out;
    if(action==="CREATE_EVENT") out=createEvent_(p);
    else if(action==="MASTER_LIST") out=masterList_(p);
    else if(action==="PING"){const ss=openSpreadsheet_(p.sheetId);out={ok:true,name:ss.getName(),id:ss.getId()};}
    else if(action==="RECORD_ADD") out=addRecord_(openSpreadsheet_(p.sheetId),p);
    else out={ok:true,message:"LAP NUMBER V31 GAS"};
    return output_(out,cb);
  }catch(err){return output_({ok:false,error:String(err)},cb);}
}
function doPost(e){
  try{
    const d=JSON.parse((e.postData&&e.postData.contents)||"{}"),a=String(d.action||"").trim().toUpperCase();
    if(a==="CREATE_EVENT") return jsonOut_(createEvent_(d));
    if(a==="MASTER_LIST") return jsonOut_(masterList_(d));
    if(a==="MASTER_SAVE") return jsonOut_(masterSave_(d));
    if(a==="MASTER_DELETE") return jsonOut_(masterDelete_(d));
    const ss=openSpreadsheet_(d.sheetId);
    if(a==="PING") return jsonOut_({ok:true,name:ss.getName(),id:ss.getId()});
    if(a==="DELETE") return jsonOut_(deleteRecord_(ss,d));
    if(a==="CLEAR_POINT") return jsonOut_(clearPoint_(ss,d));
    return jsonOut_(addRecord_(ss,d));
  }catch(err){return jsonOut_({ok:false,error:String(err)});}
}
function createEvent_(d){
  const masterId=String(d.masterId||"").trim(),year=String(d.year||"").trim(),event=String(d.event||"").trim(),date=String(d.date||"").trim(),mode=String(d.mode||"").trim();
  if(!masterId)throw new Error("共有マスタIDが未設定です"); if(!event)throw new Error("大会名が未設定です");
  const master=SpreadsheetApp.openById(masterId),ms=ensureMasterSheet_(master),vals=ms.getDataRange().getValues();
  for(let i=1;i<vals.length;i++)if(String(vals[i][0])===year&&String(vals[i][1])===event)return {ok:true,exists:true,sheetId:String(vals[i][7]||""),sheetName:String(vals[i][1]||event)};
  const cleanEvent=event.replace(new RegExp("^"+year+"[ _　-]*"),"").trim()||event;
  const ss=SpreadsheetApp.create(year+"_"+cleanEvent+"_記録データ"),info=ss.getSheets()[0];info.setName("大会情報");
  info.getRange(1,1,5,2).setValues([["項目","内容"],["大会名",event],["開催日",date],["方式",mode],["作成日時",new Date()]]);
  masterSave_({masterId,year,event,date,mode,top:"",relayGap:d.relayGap||"",sheetId:ss.getId(),endpoint:d.endpoint||""});
  return {ok:true,exists:false,sheetId:ss.getId(),sheetName:ss.getName(),url:ss.getUrl()};
}
function ensureMasterSheet_(ss){
  let sh=ss.getSheetByName("大会マスタ");if(!sh)sh=ss.insertSheet("大会マスタ");
  const h=["年","大会名","開催日","方式","TOP予想","周回差","保存先スプレッドシートID","Apps Script URL","更新日時","記録データ"];
  if(sh.getLastRow()===0)sh.getRange(1,1,1,h.length).setValues([h]);
  return sh;
}
function masterSave_(d){
  const ss=SpreadsheetApp.openById(String(d.masterId||"").trim()),sh=ensureMasterSheet_(ss),year=String(d.year||""),event=String(d.event||""),vals=sh.getDataRange().getValues();
  const sid=String(d.sheetId||"").trim(),link=sid?`=HYPERLINK("https://docs.google.com/spreadsheets/d/${sid}/edit","記録シートを開く")`:"";
  const row=[year,event,d.date||"",d.mode||"",d.top||"",d.relayGap||"",sid,d.endpoint||"",new Date(),link];
  for(let i=1;i<vals.length;i++)if(String(vals[i][0])===year&&String(vals[i][1])===event){sh.getRange(i+1,1,1,row.length).setValues([row]);return {ok:true,updated:true};}
  sh.appendRow(row);return {ok:true,updated:false};
}
function masterList_(d){
  const ss=SpreadsheetApp.openById(String(d.masterId||"").trim()),sh=ensureMasterSheet_(ss),v=sh.getDataRange().getValues(),year=String(d.year||"");
  const items=[];for(let i=1;i<v.length;i++)if(!year||String(v[i][0])===year)items.push({year:v[i][0],event:v[i][1],date:v[i][2],mode:v[i][3],top:v[i][4],relayGap:v[i][5],sheetId:v[i][6],endpoint:v[i][7]});
  return {ok:true,items};
}
function masterDelete_(d){const ss=SpreadsheetApp.openById(String(d.masterId||"").trim()),sh=ensureMasterSheet_(ss),v=sh.getDataRange().getValues();for(let i=v.length-1;i>=1;i--)if(String(v[i][0])===String(d.year||"")&&String(v[i][1])===String(d.event||""))sh.deleteRow(i+1);return {ok:true};}
function addRecord_(ss,d){
  const lock=LockService.getScriptLock();lock.waitLock(20000);try{
    const sh=ensureRecordSheet_(ss,sanitizeSheetName_(d.point||"未設定")),id=String(d.id||"").trim();
    if(id&&findRowById_(sh,id)>0)return {ok:true,duplicateId:true,id};
    const no=Math.max(0,sh.getLastRow()-1)+1;
    sh.appendRow([no,new Date(),d.event||"",d.date||"",d.mode||"",d.point||"",d.staff||"",d.time||"",d.value||"",d.recognized?"番号認識":"ムリ",d.lap||"",d.duplicate?"重複":"",d.recognized?"":"ムリ",id]);
    sh.getRange(sh.getLastRow(),1).setNumberFormat("0");return {ok:true,action:"ADD",no,id,sheet:sh.getName()};
  }finally{lock.releaseLock();}
}
function ensureRecordSheet_(ss,name){
  let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);
  if(sh.getLastRow()===0){sh.getRange(1,1,1,RECORD_HEADERS.length).setValues([RECORD_HEADERS]);sh.setFrozenRows(1);return sh;}
  const old=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  if(RECORD_HEADERS.every((h,i)=>old[i]===h))return sh;
  const data=sh.getDataRange().getValues(),map={};old.forEach((h,i)=>map[h]=i);const rows=[RECORD_HEADERS];
  for(let r=1;r<data.length;r++)rows.push(RECORD_HEADERS.map(h=>map[h]!==undefined?data[r][map[h]]:""));
  sh.clearContents();sh.getRange(1,1,rows.length,RECORD_HEADERS.length).setValues(rows);sh.setFrozenRows(1);return sh;
}
function clearPoint_(ss,d){const sh=ss.getSheetByName(sanitizeSheetName_(d.point||""));if(sh&&sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();return {ok:true};}
function deleteRecord_(ss,d){const id=String(d.id||""),point=sanitizeSheetName_(d.point||"");let sheets=point&&ss.getSheetByName(point)?[ss.getSheetByName(point)]:ss.getSheets();for(const sh of sheets){const row=findRowById_(sh,id);if(row>1){sh.deleteRow(row);return {ok:true,deleted:true};}}return {ok:true,deleted:false};}
function findRowById_(sh,id){if(!id||sh.getLastRow()<2)return 0;const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String),ix=h.indexOf("記録ID");if(ix<0)return 0;const v=sh.getRange(2,ix+1,sh.getLastRow()-1,1).getValues();for(let i=v.length-1;i>=0;i--)if(String(v[i][0]||"").trim()===id)return i+2;return 0;}
function openSpreadsheet_(id){id=String(id||"").trim();if(!id)throw new Error("保存先スプレッドシートIDが未設定です");return SpreadsheetApp.openById(id);}
function sanitizeSheetName_(n){return (String(n||"未設定").trim().replace(/[\\\/\?\*\[\]\:]/g," ")||"未設定").substring(0,100);}
function output_(o,cb){return cb?ContentService.createTextOutput(cb+"("+JSON.stringify(o)+");").setMimeType(ContentService.MimeType.JAVASCRIPT):jsonOut_(o);}
function jsonOut_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}

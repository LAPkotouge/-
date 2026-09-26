const $ = id => document.getElementById(id);
const KEY_CFG = "taikai_voice_cfg_v1";
const KEY_REC = "taikai_voice_rec_v1";
const KEY_QUEUE = "taikai_voice_queue_v1";
const KEY_MAN = "taikai_voice_man_mode_v1";
const KEY_SEQ = "taikai_voice_seq_v1";
const KEY_PACK = "lap_number_v31_pack_mode";
const KEY_FIELD_LOCK = "lap_number_v31_field_lock";

let cfg = { event:"大会名未設定", date:"", mode:"MARATHON", point:"地点未設定", staff:"", top:"", relayGap:1, endpoint:"", sheetId:"", sheetName:"" };
let records = [], sendQueue = [], ok = 0, muri = 0, recognition = null, listening = false, restartTimer = null, deferredInstall = null, isSending = false, manMode = false, seqCounter = 0;
let lastSpeech = "—";
let speechCandidateTs = 0;
let packMode = false;
let lastRecognitionConfidence = 0;
let lastRecognitionDelayMs = 0;
let fieldLock = false;
let micTestPassed = false;
let raceLiveMode = false;
let packExpectedCount = 0;
let pendingGapCount = 0;
let pendingGapCaptureTs = 0;

function load(){
  try{ Object.assign(cfg, JSON.parse(localStorage.getItem(KEY_CFG)||"{}")); }catch{}
  cfg.relayGap = Math.max(1, Math.min(60, Number(cfg.relayGap)||1));
  cfg.sheetId = String(cfg.sheetId||"").trim();
  cfg.sheetName = String(cfg.sheetName||"").trim();
  try{ records = JSON.parse(localStorage.getItem(KEY_REC)||"[]"); }catch{ records=[]; }
  try{ sendQueue = JSON.parse(localStorage.getItem(KEY_QUEUE)||"[]"); }catch{ sendQueue=[]; }
  manMode = localStorage.getItem(KEY_MAN)==="1";
  packMode = localStorage.getItem(KEY_PACK)==="1";
  fieldLock = localStorage.getItem(KEY_FIELD_LOCK)==="1";
  seqCounter = Number(localStorage.getItem(KEY_SEQ)||0) || 0;
  migrateSequenceNumbers();
  recount(); render(); processQueue();
}

function migrateSequenceNumbers(){
  const oldest=[...records].sort((a,b)=>(Number(a.ts)||0)-(Number(b.ts)||0));
  let max=seqCounter;
  for(const r of oldest){
    if(Number(r.seqNo)>0){ max=Math.max(max,Number(r.seqNo)); continue; }
    max+=1; r.seqNo=max;
  }
  seqCounter=max;
  save();
}

function save(){
  localStorage.setItem(KEY_CFG, JSON.stringify(cfg));
  localStorage.setItem(KEY_REC, JSON.stringify(records));
  localStorage.setItem(KEY_QUEUE, JSON.stringify(sendQueue));
  localStorage.setItem(KEY_MAN, manMode ? "1" : "0");
  localStorage.setItem(KEY_SEQ, String(seqCounter));
  localStorage.setItem(KEY_PACK, packMode ? "1" : "0");
  localStorage.setItem(KEY_FIELD_LOCK, fieldLock ? "1" : "0");
}

function nextSeq(){ seqCounter+=1; return seqCounter; }
function recount(){ ok=records.filter(r=>r.recognized&&!r.cancelled&&!r.invalidGap).length; muri=records.filter(r=>!r.recognized&&!r.cancelled).length; }
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function now(){ return new Date().toLocaleTimeString("ja-JP",{hour12:false}); }
function modeName(){ return cfg.mode==="EKIDEN" ? "駅伝" : cfg.mode==="RELAY" ? "リレーマラソン" : "マラソン"; }
function fmtDate(s){ if(!s)return ""; const p=s.split("-"); return p.length===3?`${Number(p[0])}年${Number(p[1])}月${Number(p[2])}日`:s; }
function destinationLabel(){ if(cfg.sheetName)return cfg.sheetName; if(cfg.sheetId)return `ID:${cfg.sheetId}`; return "標準スプレッドシート"; }
function topRemain(){ if(!cfg.top)return "未設定"; const p=cfg.top.split(":").map(Number); if(p.length<2)return "未設定"; const n=new Date(),t=new Date(); t.setHours(p[0],p[1],p[2]||0,0); let sec=Math.floor((t-n)/1000),sign=sec<0?"+":"-"; sec=Math.abs(sec); return sign+String(Math.floor(sec/3600)).padStart(2,"0")+":"+String(Math.floor(sec%3600/60)).padStart(2,"0")+":"+String(sec%60).padStart(2,"0"); }

function renderHistory(){
  const h=$("history"); if(!h)return;
  const active=records.filter(r=>!r.cancelled).slice(0,6);
  h.innerHTML=active.map(r=>{
    let tag="";
    if(r.mode==="RELAY"&&r.invalidGap) tag='<span class="historyTag duplicateTag">時差重複</span>';
    else if(r.mode==="RELAY"&&r.lap) tag=`<span class="historyTag relayTag">${esc(r.lap)}周目</span>`;
    else if(r.suspiciousRepeat) tag='<span class="historyTag duplicateTag">重複候補</span>';
    else if(r.duplicate) tag='<span class="historyTag duplicateTag">再登場</span>';
    else if(r.invalidGap) tag='<span class="historyTag invalidTag">無効</span>';
    return `<div class="row"><span>${esc(r.seqNo||"")}</span><span class="numberCell"><span class="historyNumber">${esc(r.value)}</span>${tag}</span><span>${esc(r.time)}</span></div>`;
  }).join("");
}




function confirmCriticalAction(label,phrase){
  if(fieldLock){const s=$("status");if(s)s.textContent="🔒 誤操作防止ON：先にロックを解除してください";return false;}
  if(!confirm("【重大操作】"+label+"\n\nこの操作は通常の受付中には使用しません。\n続行しますか？"))return false;
  const entered=prompt("最終確認です。実行する場合は「"+phrase+"」と入力してください。","");
  if(entered!==phrase){const s=$("status");if(s)s.textContent="重大操作を中止しました";return false;}
  return true;
}

function renderFieldLock(){
  const btn=$("v31FieldLockBtn");if(!btn)return;
  btn.textContent=fieldLock?"🔒 誤操作防止 ON":"🔓 誤操作防止 OFF";btn.classList.toggle("on",fieldLock);
  // Keep reception, direct input, MURI and last-cancel usable. Lock setup/destructive controls.
  const protectedIds=["settingsBtn","clearBtn","sheetClearBtn","restoreBtn","sharedSaveBtn","sharedDeleteBtn","createEventBtn"];
  protectedIds.forEach(id=>{const el=$(id);if(el)el.classList.toggle("v31LockedControl",fieldLock);});
}
function toggleFieldLock(){
  fieldLock=!fieldLock;save();renderFieldLock();
  const s=$("status");if(s)s.textContent=fieldLock?"🔒 誤操作防止ON：受付操作だけ使用できます":"🔓 誤操作防止を解除しました";
}


function renderStartFlow(){
  const wrap=$("v31StartSteps"),btn=$("v31StartBtn");if(!wrap||!btn)return;
  const eventOk=!!(cfg.event&&cfg.point&&cfg.staff);
  const speechOk=!!(window.SpeechRecognition||window.webkitSpeechRecognition);
  const networkOk=navigator.onLine;
  const steps=[
    ["大会・地点",eventOk],["音声対応",speechOk],["通信",networkOk],["音声テスト",micTestPassed],["誤操作防止",fieldLock]
  ];
  wrap.innerHTML=steps.map(([n,ok])=>`<span class="${ok?"ok":"ng"}">${ok?"✓":"△"} ${n}</span>`).join("");
  btn.disabled=!(eventOk&&speechOk&&micTestPassed&&fieldLock);
  btn.textContent=raceLiveMode?"● 本番受付中":"本番受付を開始";
}


let flashTimer=0;

function flashPackAccepted(values,confidence=0){
  if(!raceLiveMode||!values||values.length<2)return;
  const box=$("v31Flash"),no=$("v31FlashNo"),meta=$("v31FlashMeta");if(!box||!no||!meta)return;
  clearTimeout(flashTimer);
  const low=Number(confidence)>0&&Number(confidence)<0.45;
  box.className="v31Flash show"+(low?" warn":"");
  no.style.fontSize=values.length>=5?"min(16vw,82px)":values.length>=3?"min(20vw,105px)":"min(26vw,135px)";
  no.textContent=values.join(" → ");
  meta.textContent=low?`⚠ 集団 ${values.length}人・認識注意 ${Math.round(Number(confidence)*100)}%`:`✓ 集団受付 ${values.length}人`;
  flashTimer=setTimeout(()=>{box.className="v31Flash";no.style.fontSize="";},1100);
}

function flashAccepted(value,confidence=0,isMuri=false){
  if(!raceLiveMode)return;
  const box=$("v31Flash"),no=$("v31FlashNo"),meta=$("v31FlashMeta");if(!box||!no||!meta)return;
  clearTimeout(flashTimer);
  const low=Number(confidence)>0&&Number(confidence)<0.45;
  box.className="v31Flash show"+(isMuri?" muri":low?" warn":"");
  no.textContent=isMuri?"ムリ":value;
  meta.textContent=isMuri?"1人カウント":low?`⚠ 認識注意　確信度 ${Math.round(Number(confidence)*100)}%`:"✓ 受付";
  flashTimer=setTimeout(()=>{box.className="v31Flash";},650);
}

function latestUndoableRecord(){
  return records.find(r=>!r.cancelled&&!r.invalidGap)||null;
}
function renderQuickUndo(){
  const b=$("v31QuickUndoBtn"),i=$("v31UndoInfo");if(!b||!i)return;
  const r=latestUndoableRecord();
  b.disabled=!r;
  i.textContent=r?`取消対象：No.${r.seqNo}　${r.value}　${r.time}`:"取消対象：なし";
}
function quickUndoLatest(){
  const r=latestUndoableRecord();if(!r){$("status").textContent="取消できる直前データがありません";return;}
  const age=Math.max(0,Math.round((Date.now()-(Number(r.captureTs)||Number(r.ts)||Date.now()))/1000));
  if(age>30&&!confirm(`直前記録「${r.value}」は${age}秒前です。取消しますか？`))return;
  cancelRecord(r.id);
  $("status").textContent=`↩ 直前1件を取消：${r.value}`;
  renderQuickUndo();
}

function setRaceLiveMode(on){
  raceLiveMode=!!on;document.body.classList.toggle("v31-race-live",raceLiveMode);
  const exitBtn=$("v31ExitRaceBtn");if(exitBtn)exitBtn.hidden=!raceLiveMode;
  renderStartFlow();renderQuickUndo();
}
function startRaceReception(){
  if(!fieldLock){$("status").textContent="誤操作防止をONにしてください";return;}
  if(!micTestPassed){$("status").textContent="先に端末音声テストを実施してください";return;}
  setRaceLiveMode(true);if(!listening)startRecognition();
}


function renderLiveCounters(){
  const active=records.filter(r=>!r.cancelled&&!r.invalidGap);
  const muri=active.filter(r=>!r.recognized||r.value==="ムリ").length;
  const bib=active.length-muri;
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=String(v);};
  set("v31CountBib",bib);set("v31CountMuri",muri);set("v31CountTotal",active.length);set("v31CountQueue",sendQueue.length);
  const q=$("v31CountQueue");if(q&&q.parentElement)q.parentElement.classList.toggle("queueWarn",sendQueue.length>0);
}

function renderFieldAlert(){
  const box=$("v31FieldAlert"),main=$("v31FieldAlertMain"),sub=$("v31FieldAlertSub");if(!box||!main||!sub)return;
  const q=sendQueue.length;
  if(!navigator.onLine){box.className="v31FieldAlert offline";main.textContent="オフライン";sub.textContent=q?`端末保存中・未送信 ${q}件`:"端末保存で受付継続";return;}
  if(q>=10){box.className="v31FieldAlert danger";main.textContent="未送信増加";sub.textContent=`${q}件を端末保持・自動再送中`;return;}
  if(q>0){box.className="v31FieldAlert warn";main.textContent="送信待ち";sub.textContent=`未送信 ${q}件`;return;}
  if(lastRecognitionConfidence>0&&lastRecognitionConfidence<0.45){box.className="v31FieldAlert warn";main.textContent="音声認識 注意";sub.textContent=`確信度 ${Math.round(lastRecognitionConfidence*100)}%`;return;}
  box.className="v31FieldAlert ok";main.textContent=listening?"音声受付 正常":"受付準備OK";sub.textContent=lastRecognitionDelayMs?`直近認識 約${lastRecognitionDelayMs}ms`:"未送信 0件";
}

function render(){
  $("event").textContent=cfg.event; $("eventDate").textContent=fmtDate(cfg.date); $("point").textContent=cfg.point||"地点未設定"; $("staff").textContent="担当："+(cfg.staff||"未設定"); $("destination").textContent="保存先："+destinationLabel();
  if($("modeBadge")) $("modeBadge").textContent=modeName();
  $("connectionState").textContent=navigator.onLine?"● 接続中":"● オフライン"; $("connectionState").className=navigator.onLine?"connected":"offline";
  $("currentTime").textContent=now(); $("countdown").textContent=topRemain(); recount();
  $("okCount").textContent=ok; $("muriCount").textContent=muri; $("totalCount").textContent=ok+muri;
  const latest=records.find(r=>!r.cancelled); $("latest").textContent=latest?.value||"—"; if($("latestSub"))$("latestSub").textContent=""; if($("rawSpeechValue"))$("rawSpeechValue").textContent=lastSpeech||"—"; renderHistory();
  $("voiceBtn").textContent=listening?"🛑 音声受付停止":"🎤 ナンバー読み上げ開始"; $("voiceBtn").classList.toggle("on",listening);
  $("status").textContent=(listening?"●音声受付中":"停止中")+(sendQueue.length?` ⚠未送信${sendQueue.length}件`:""); $("status").classList.toggle("voiceActiveStatus",listening);
  const pb=$("packModeBtn");if(pb){pb.textContent=packMode?"集団モード ON":"集団モード OFF";pb.classList.toggle("on",packMode);}
  const ph=$("packModeHint");if(ph)ph.textContent=packMode?"連続番号をまとめて読み上げ可":"通常受付";
  const b=$("manModeBtn"); if(b){b.hidden=cfg.mode==="EKIDEN";b.innerHTML=`<span>万台</span><span>モード</span>`;b.style.background=manMode?"#0b57d0":"#fff";b.style.color=manMode?"#fff":"#c64b14";b.title=manMode?"万台番号モード ON":"万台番号モード OFF";}
  const mh=$("manModeHint");if(mh)mh.hidden=cfg.mode==="EKIDEN"; const rw=$("relayGapWrap");if(rw)rw.hidden=cfg.mode!=="RELAY"; renderFieldAlert(); renderFieldLock(); renderStartFlow(); renderPackCountControls(); renderLiveCounters();
}
function refreshClock(){ if($("currentTime"))$("currentTime").textContent=now(); if($("countdown"))$("countdown").textContent=topRemain(); }

function normalizeSpeech(s){ return (s||"").normalize("NFKC").replace(/[\s・,、。]/g,"").replace(/[ー－―—]/g,"-").replace(/の区/g,"区"); }
const digitKana={ゼロ:"0",レイ:"0",イチ:"1",イッ:"1",ニ:"2",ニー:"2",サン:"3",ヨン:"4",シ:"4",ゴ:"5",ロク:"6",ナナ:"7",シチ:"7",ハチ:"8",キュウ:"9",キュー:"9",ク:"9"};
const jpRead={ゼロ:"零",レイ:"零",イチ:"一",イッ:"一",ニ:"二",ニー:"二",サン:"三",ヨン:"四",シ:"四",ゴ:"五",ロク:"六",ナナ:"七",シチ:"七",ハチ:"八",キュウ:"九",キュー:"九",ク:"九",マン:"万",マンク:"万",セン:"千",ゼン:"千",ヒャク:"百",ビャク:"百",ピャク:"百",ジュウ:"十",ジュー:"十"};
const jpDigit={零:0,〇:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
function kanaDigitsToNumber(s){ let x=normalizeSpeech(s),out="",keys=Object.keys(digitKana).sort((a,b)=>b.length-a.length); while(x){let found=false;for(const k of keys)if(x.startsWith(k)){out+=digitKana[k];x=x.slice(k.length);found=true;break}if(!found)return null}if(!out||out.length>5)return null;const n=Number(out);return n>=1&&n<=99999?n:null; }
function jpToNumber(s){ let x=normalizeSpeech(s);Object.keys(jpRead).sort((a,b)=>b.length-a.length).forEach(k=>x=x.replaceAll(k,jpRead[k]));let total=0,section=0,num=0,has=false;for(const ch of x){if(jpDigit[ch]!==undefined){num=jpDigit[ch];has=true}else if(ch==="十"||ch==="百"||ch==="千"){section+=(num||1)*({十:10,百:100,千:1000}[ch]);num=0;has=true}else if(ch==="万"){section+=num;total+=section*10000;section=0;num=0;has=true}else return null}return has?total+section+num:null; }
function digitTextToNumber(s){ const d=s.replace(/[^0-9]/g,"");if(!d)return null;const n=Number(d);return d&&n>=1&&n<=99999?n:null; }
function parseNumber(raw){ const s=normalizeSpeech(raw); if(/むり|無理/i.test(s))return "MURI"; if(/キャンセル|きゃんせる|取り消し|とりけし|取消|戻す|もどす/.test(s))return "CANCEL"; if(cfg.mode==="EKIDEN"){let m=s.match(/(\d{1,4})-(\d{1,2})/);if(!m)m=s.match(/(\d{1,4}).{0,3}?(\d{1,2})区/);if(!m)m=s.match(/(\d{1,4})の(\d{1,2})/);if(!m)return null;const a=Number(m[1]),b=Number(m[2]);return a>=1&&a<=9999&&b>=1&&b<=25?`${a}-${b}`:null;} if(manMode){const n=digitTextToNumber(s)??kanaDigitsToNumber(s);return n&&n>=10000?String(n):null;} const candidates=[];const d=digitTextToNumber(s);if(d!==null)candidates.push({n:d,score:1});const kd=kanaDigitsToNumber(s);if(kd!==null)candidates.push({n:kd,score:8});const j=jpToNumber(s);if(j!==null)candidates.push({n:j,score:/万|千|百|十/.test(s)?10:2});candidates.sort((a,b)=>b.score-a.score);for(const c of candidates)if(c.n>=1&&c.n<=99999)return String(c.n);return null; }
function relayLast(value){
  // V31: old records may have been created before mode was stored consistently.
  // For relay reception, find the latest valid same-number record in the current event/point.
  const target=String(value);
  return records.find(r=>{
    if(r.cancelled||r.invalidGap||!r.recognized||String(r.value)!==target)return false;
    if(r.event&&cfg.event&&r.event!==cfg.event)return false;
    if(r.point&&cfg.point&&r.point!==cfg.point)return false;
    return true;
  })||null;
}
function timeFromTs(ts){ return new Date(ts||Date.now()).toLocaleTimeString("ja-JP",{hour12:false}); }
function makeRecordBase(value,recognized,rawSpeech,captureTs,confidence=0,inputType=""){
  const recognizedTs=Date.now(), acceptedTs=Number(captureTs)||recognizedTs;
  return {id:recognizedTs+"_"+Math.random().toString(36).substr(2,5),seqNo:nextSeq(),value,recognized,time:timeFromTs(acceptedTs),ts:acceptedTs,captureTs:acceptedTs,recognizedTs,recognitionDelayMs:Math.max(0,recognizedTs-acceptedTs),confidence:Number(confidence)||0,inputType:inputType||(recognized?"音声認識":"ボタン"),event:cfg.event,date:cfg.date,point:cfg.point,staff:cfg.staff,mode:cfg.mode,rawSpeech,sheetId:cfg.sheetId||""};
}

function add(value,recognized=true,rawSpeech="",captureTs=0,confidence=0,inputType=""){
  if(rawSpeech)lastSpeech=rawSpeech;
  if(cfg.mode==="RELAY"&&recognized){const prev=relayLast(value);if(prev){const currentTs=Number(captureTs)||Date.now(),prevTs=Number(prev.captureTs)||Number(prev.ts)||0,diff=Math.max(0,(currentTs-prevTs)/1000);if(diff<=cfg.relayGap*60){const rec={...makeRecordBase(value,true,rawSpeech,captureTs,confidence,inputType),invalidGap:true,invalidSeconds:Math.round(diff),duplicate:true,duplicateSeconds:Math.round(diff),suspiciousRepeat:true,lap:prev.lap};records.unshift(rec);if(cfg.endpoint)sendQueue.push(rec);save();render();(window.v31ReliableSend?window.v31ReliableSend():processQueue());$("status").textContent=`⚠ ${value}：${Math.round(diff)}秒差・時差重複（${prev.lap||1}周目のまま）`;return;}}const lap=prev?(Number(prev.lap)||1)+1:1;const rec={...makeRecordBase(value,true,rawSpeech,captureTs,confidence,inputType),duplicate:false,lap};records.unshift(rec);if(cfg.endpoint)sendQueue.push(rec);save();render();(window.v31ReliableSend?window.v31ReliableSend():processQueue());return;}
  const previous=recognized?records.find(r=>!r.cancelled&&!r.invalidGap&&r.recognized&&r.value===value):null;
  const duplicate=!!previous;
  const duplicateSeconds=previous?Math.max(0,Math.round(((Number(captureTs)||Date.now())-(Number(previous.captureTs)||Number(previous.ts)||0))/1000)):0;
  const suspiciousRepeat=!!previous&&duplicateSeconds<=300;
  const rec={...makeRecordBase(value,recognized,rawSpeech,captureTs,confidence,inputType),duplicate,duplicateSeconds,suspiciousRepeat};
  flashAccepted(value,confidence,!recognized||value==="ムリ");records.unshift(rec);if(cfg.endpoint)sendQueue.push(rec);save();render();(window.v31ReliableSend?window.v31ReliableSend():processQueue());if(suspiciousRepeat)$("status").textContent=`⚠ ${value}：${duplicateSeconds}秒前にも受付（重複候補）`;
  else if(duplicate)$("status").textContent=`△ ${value}：過去にも受付あり（${duplicateSeconds}秒前）`;
}
function showRecognitionRaw(s){ lastSpeech=s||"（空）";if($("rawSpeechValue"))$("rawSpeechValue").textContent=lastSpeech; }
function cancelLast(){ const i=records.findIndex(r=>!r.cancelled);if(i<0){$("status").textContent="キャンセルする登録データがありません";return}const r=records[i];r.cancelled=true;r.cancelledAt=now();r.cancelledBy="キャンセル";sendQueue=sendQueue.filter(q=>q.id!==r.id);save();render();$("status").textContent=`直前の「${r.value}」をキャンセルしました`; }

async function deleteNumber(){const input=$("deleteNumberInput");if(!input)return;const target=parseNumber(input.value.trim());if(!target||target==="MURI"||target==="CANCEL"){alert(cfg.mode==="EKIDEN"?"削除する駅伝番号を 125-3 の形式で入力してください。":"削除するナンバーを1～99999で入力してください。");input.focus();return;}const i=records.findIndex(r=>!r.cancelled&&!r.invalidGap&&r.value===target);if(i<0){$("status").textContent=`「${target}」は現在のアプリ内登録にありません`;input.select();return;}const r=records[i],lapText=r.mode==="RELAY"&&r.lap?`（${r.lap}周目）`:"";if(!confirm(`「${target}」${lapText}を削除しますか？\n\n最も新しい登録1件だけを削除します。\nこの操作は元に戻せません。`))return;r.cancelled=true;r.cancelledAt=now();r.cancelledBy="番号指定削除";sendQueue=sendQueue.filter(q=>q.id!==r.id);save();render();input.value="";$("status").textContent=`「${target}」${lapText}を削除しました`;if(cfg.endpoint&&navigator.onLine){try{await fetch(cfg.endpoint,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"DELETE",id:r.id||"",seqNo:r.seqNo||"",point:r.point||cfg.point||"",value:r.value||"",mode:r.mode||cfg.mode||"",event:r.event||cfg.event||"",date:r.date||cfg.date||"",staff:r.staff||cfg.staff||"",lap:r.lap||"",time:r.time||"",sheetId:r.sheetId||cfg.sheetId||""})});$("status").textContent=`「${target}」削除送信完了`;}catch{$("status").textContent=`「${target}」はアプリから削除済・シート削除送信失敗`;}}input.focus();}

async function processQueue(){if(isSending||!sendQueue.length||!cfg.endpoint||!navigator.onLine)return;isSending=true;while(sendQueue.length&&navigator.onLine){const item=sendQueue[0];try{const payload={...item,sheetId:item.sheetId||cfg.sheetId||""};const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);await fetch(cfg.endpoint,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:c.signal});clearTimeout(t);sendQueue.shift();save();render();}catch{break}}isSending=false;}
function registerManual(){const v=parseNumber($("numberInput").value.trim());if(v==="CANCEL"){cancelLast();$("numberInput").value="";return}if(!v){alert(cfg.mode==="RELAY"?"1～99999の番号を入力してください。":manMode?"万台モードでは10,000～99,999を入力するか1桁ずつ読んでください。":cfg.mode==="EKIDEN"?"駅伝は 125-3（1～9999×1～25区）で入力してください。":"1～99999の番号を入力してください。");return}add(v==="MURI"?"ムリ":v,v!=="MURI",$("numberInput").value.trim(),0,0,"手入力");$("numberInput").value="";$("numberInput").focus();}

function recognitionQuality(conf){
  const n=Number(conf)||0;
  if(!n)return {label:"確信度なし",mark:"△"};
  if(n>=0.75)return {label:"良好 "+Math.round(n*100)+"%",mark:"●"};
  if(n>=0.45)return {label:"注意 "+Math.round(n*100)+"%",mark:"△"};
  return {label:"低い "+Math.round(n*100)+"%",mark:"⚠"};
}
function runMicTest(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const state=$("v31MicState"),quality=$("v31Quality"),result=$("v31MicTestResult"),btn=$("v31MicTestBtn");
  if(!SR){state.textContent="非対応";quality.textContent="⚠";result.textContent="このブラウザでは音声認識を使用できません。";return;}
  if(listening){result.textContent="本番音声受付を停止してから端末テストしてください。";return;}
  const test=new SR();test.lang="ja-JP";test.interimResults=false;test.continuous=false;
  let started=0;
  btn.disabled=true;state.textContent="待機中";quality.textContent="—";result.textContent="「1234」など、実際のゼッケン番号のように読み上げてください。";
  test.onspeechstart=()=>{started=Date.now();state.textContent="音声検知";};
  test.onresult=e=>{const alt=e.results[0][0],raw=alt.transcript,conf=Number(alt.confidence)||0,v=parseNumber(raw),q=recognitionQuality(conf),delay=started?Date.now()-started:0;micTestPassed=!!v;state.textContent=v?"認識OK":"認識注意";quality.textContent=q.mark+" "+q.label;result.textContent=v?`認識：「${raw}」 → ナンバー ${v} ／ 認識時間 約${delay}ms`:`認識：「${raw}」 → ナンバー化できませんでした`;};
  test.onerror=e=>{state.textContent="エラー";quality.textContent="⚠";result.textContent="音声認識エラー："+e.error;};
  test.onend=()=>{btn.disabled=false;renderStartFlow();};
  try{test.start();}catch(e){btn.disabled=false;state.textContent="開始失敗";result.textContent="音声テストを開始できませんでした。";}
}


function setPackExpectedCount(n){
  packExpectedCount=Number(n)||0;
  document.querySelectorAll("[data-pack-count]").forEach(b=>b.classList.toggle("on",Number(b.dataset.packCount)===packExpectedCount));
  const e=$("v31PackExpected");if(e)e.textContent=packExpectedCount?(packExpectedCount>=5?"5人以上":packExpectedCount+"人"):"未指定";
}
function renderPackCountControls(){
  const row=$("v31PackCountRow");if(row)row.hidden=!packMode;
  setPackExpectedCount(packExpectedCount);
}

function showGapFill(count,captureTs){
  pendingGapCount=Math.max(0,Number(count)||0);pendingGapCaptureTs=Number(captureTs)||Date.now();
  const box=$("v31GapFill"),txt=$("v31GapFillText");if(!box||!txt)return;
  box.hidden=pendingGapCount<1;txt.textContent=`人数抜け：${pendingGapCount}人`;
}
function clearGapFill(){pendingGapCount=0;pendingGapCaptureTs=0;const b=$("v31GapFill");if(b)b.hidden=true;}
function fillGapWithMuri(){
  if(pendingGapCount<1)return;
  const n=pendingGapCount,base=pendingGapCaptureTs||Date.now();
  for(let i=0;i<n;i++)add("ムリ",false,"集団人数抜け補完",base+i*250,0);
  $("status").textContent=`人数抜け ${n}人を「ムリ」で補完しました`;
  clearGapFill();
}

function warnPackCountMismatch(expected,actual,values,captureTs){
  if(!expected)return;
  const shortage=expected>=5?actual<5:actual<expected;
  if(!shortage)return;
  const missing=expected>=5?Math.max(1,5-actual):Math.max(0,expected-actual);showGapFill(missing,captureTs);
  const box=$("v31Flash"),no=$("v31FlashNo"),meta=$("v31FlashMeta");if(box&&no&&meta){
    clearTimeout(flashTimer);box.className="v31Flash show warn";
    no.style.fontSize="min(20vw,105px)";no.textContent=values.join(" → ")||"—";
    meta.textContent=`⚠ 人数抜け疑い：見えた ${expected>=5?"5+":expected}人 ／ 認識 ${actual}人`;
    flashTimer=setTimeout(()=>{box.className="v31Flash";no.style.fontSize="";},1800);
  }
  const s=$("status");if(s)s.textContent=`⚠ 集団の人数抜け疑い：想定 ${expected>=5?"5+":expected}人、認識 ${actual}人`;
}

function parsePackNumbers(raw){
  const normalized=(raw||"").normalize("NFKC").replace(/[、，,／/・]+/g," ").trim();
  if(!normalized)return [];
  const chunks=normalized.split(/\s+/).filter(Boolean);
  const vals=[];
  for(const chunk of chunks){const v=parseNumber(chunk);if(v&&v!=="MURI"&&v!=="CANCEL")vals.push(v);}
  return vals;
}
function addPack(values,rawSpeech,captureTs,confidence=0){
  const unique=[];
  for(const v of values){if(v&&!unique.includes(v))unique.push(v);}
  if(unique.length<2)return false;
  const base=Number(captureTs)||Date.now();
  unique.forEach((v,i)=>add(v,true,rawSpeech,base+i*250,confidence,"音声認識"));
  flashPackAccepted(unique,confidence);
  warnPackCountMismatch(packExpectedCount,unique.length,unique,base);
  packExpectedCount=0;renderPackCountControls();
  $("status").textContent=`集団受付：${unique.length}人（${unique.join("・")}）`;
  return true;
}
function startRecognition(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){alert("このブラウザは音声認識に対応していません。Chromeを使用してください。");return}recognition=new SR();recognition.lang="ja-JP";recognition.interimResults=false;recognition.continuous=false;recognition.onaudiostart=()=>{speechCandidateTs=Date.now();};
recognition.onspeechstart=()=>{recognition._speechStartTs=Date.now();};
recognition.onresult=e=>{const alt=e.results[0][0];const confidence=Number(alt.confidence)||0;const captureTs=recognition._speechStartTs||speechCandidateTs||Date.now();recognition._speechStartTs=0;speechCandidateTs=0;lastRecognitionConfidence=confidence;lastRecognitionDelayMs=Math.max(0,Date.now()-captureTs);const t=alt.transcript;showRecognitionRaw(t);
if(packMode){const pack=parsePackNumbers(t);if(pack.length>=2){addPack(pack,t,captureTs,confidence);return;}if(packExpectedCount>=2&&pack.length===1){add(pack[0],true,t,captureTs,confidence,"音声認識");warnPackCountMismatch(packExpectedCount,1,pack,captureTs);packExpectedCount=0;renderPackCountControls();return;}}
const v=parseNumber(t);if(v==="CANCEL")cancelLast();else if(v==="MURI")add("ムリ",false,t,captureTs,confidence,"音声認識");else if(v)add(v,true,t,captureTs,confidence,"音声認識");else $("status").textContent=`認識できません：「${t}」`;};recognition.onerror=e=>{speechCandidateTs=0;if(e.error!=="aborted")$("status").textContent="音声認識エラー："+e.error;};recognition.onend=()=>{if(listening){clearTimeout(restartTimer);restartTimer=setTimeout(()=>{try{recognition.start()}catch{}},180)}};listening=true;render();try{recognition.start()}catch{}}
function stopRecognition(){listening=false;clearTimeout(restartTimer);try{recognition&&recognition.abort()}catch{}render()}
function fillSettings(){$("sEvent").value=cfg.event==="大会名未設定"?"":cfg.event;$("sDate").value=cfg.date;$("sMode").value=cfg.mode;$("sPoint").value=cfg.point==="地点未設定"?"":cfg.point;$("sStaff").value=cfg.staff;$("sTop").value=cfg.top;$("sRelayGap").value=cfg.relayGap;$("sEndpoint").value=cfg.endpoint;$("sSheetId").value=cfg.sheetId||"";const rw=$("relayGapWrap");if(rw)rw.hidden=cfg.mode!=="RELAY";const cs=$("connectionStatus");if(cs)cs.textContent=cfg.sheetName?`現在の保存先：${cfg.sheetName}`:"";}
function saveSettings(){cfg.event=$("sEvent").value||"大会名未設定";cfg.date=$("sDate").value;cfg.mode=$("sMode").value;cfg.point=$("sPoint").value||"地点未設定";cfg.staff=$("sStaff").value;cfg.top=$("sTop").value;cfg.relayGap=Math.max(1,Math.min(60,Number($("sRelayGap").value)||1));cfg.endpoint=$("sEndpoint").value.trim();cfg.sheetId=$("sSheetId").value.trim();cfg.sheetName="";save();$("settingsPanel").hidden=true;render();processQueue();}
function clearRecords(){if(!confirm("この端末の登録データを全て消去します。No.も1から再開します。よろしいですか？"))return;records=[];sendQueue=[];seqCounter=0;lastSpeech="—";save();render();}
function testDestination(){const status=$("connectionStatus"),endpoint=$("sEndpoint").value.trim(),sheetId=$("sSheetId").value.trim();if(!endpoint){status.textContent="❌ Google Apps Script URLを入力してください";return}if(!sheetId){status.textContent="❌ 保存先スプレッドシートIDを入力してください";return}status.textContent="接続確認中…";const payload={action:"PING",sheetId,event:$("sEvent").value||"接続確認",date:$("sDate").value||"",mode:$("sMode").value||"MARATHON",point:$("sPoint").value||"接続確認",staff:$("sStaff").value||"",time:now(),id:"PING_"+Date.now()};const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);fetch(endpoint,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:c.signal}).then(()=>{clearTimeout(timer);cfg.sheetId=sheetId;cfg.sheetName="";status.textContent="✅ 接続要求を送信できました。保存後、テスト番号を1件登録して確認してください。";}).catch(()=>{clearTimeout(timer);status.textContent="❌ 接続確認できませんでした。URL・ID・通信状態を確認してください。";});}

$("voiceBtn").addEventListener("click",()=>listening?stopRecognition():startRecognition());
$("packModeBtn")?.addEventListener("click",()=>{packMode=!packMode;if(!packMode)packExpectedCount=0;save();render();});
document.querySelectorAll("[data-pack-count]").forEach(b=>b.addEventListener("click",()=>setPackExpectedCount(Number(b.dataset.packCount))));
$("v31MicTestBtn")?.addEventListener("click",runMicTest);
$("v31FieldLockBtn")?.addEventListener("click",()=>{toggleFieldLock();renderStartFlow();});
$("v31StartBtn")?.addEventListener("click",startRaceReception);
$("v31QuickUndoBtn")?.addEventListener("click",quickUndoLatest);
$("v31GapFillBtn")?.addEventListener("click",fillGapWithMuri);
$("v31GapDismissBtn")?.addEventListener("click",()=>{clearGapFill();$("status").textContent="人数抜け補完を見送りました";});
$("v31ExitRaceBtn")?.addEventListener("click",()=>{if(!confirm("本番モードを終了しますか？\n受付データは消えません。"))return;stopRecognition();setRaceLiveMode(false);});
window.addEventListener("online",renderStartFlow);window.addEventListener("offline",renderStartFlow);$("registerBtn").addEventListener("click",registerManual);$("numberInput").addEventListener("keydown",e=>{if(e.key==="Enter")registerManual()});$("muriBtn").addEventListener("click",()=>add("ムリ",false,"ボタン",0,0,"ボタン"));$("cancelLastBtn").addEventListener("click",cancelLast);$("deleteNumberBtn").addEventListener("click",deleteNumber);$("deleteNumberInput").addEventListener("keydown",e=>{if(e.key==="Enter")deleteNumber()});$("manModeBtn").addEventListener("click",()=>{manMode=!manMode;save();render();});$("settingsBtn").addEventListener("click",()=>{fillSettings();$("settingsPanel").hidden=false});$("closeSettings").addEventListener("click",()=>$("settingsPanel").hidden=true);$("saveSettings").addEventListener("click",saveSettings);$("clearRecordsBtn").addEventListener("click",clearRecords);$("testConnectionBtn").addEventListener("click",testDestination);$("sMode").addEventListener("change",()=>{const rw=$("relayGapWrap");if(rw)rw.hidden=$("sMode").value!=="RELAY";});window.addEventListener("online",()=>{render();(window.v31ReliableSend?window.v31ReliableSend():processQueue());});window.addEventListener("offline",render);setInterval(refreshClock,500);window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("installBtn").hidden=false});$("installBtn").addEventListener("click",async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("installBtn").hidden=true}});if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js");load();window.deleteNumber=deleteNumber;

// =====================================================
// V30：大会別記録スプレッドシート自動作成
// =====================================================
(function setupV30(){
  const VERSION_TEXT="LAP NUMBER　V＝３１ DEV r3";
  const MASTER_ID_KEY="taikai_voice_shared_master_id_v1";

  const style=document.createElement("style");
  style.textContent=`
    .eventDate::before{content:"${VERSION_TEXT}"!important}
    .dialog h2::after{content:"${VERSION_TEXT}"!important}
    .v30CreateBox{border:1px solid #7bb993;background:#f5fbf7;border-radius:11px;padding:11px;margin:4px 0 14px}
    .v30CreateTitle{font-size:17px;font-weight:900;color:#176b36;margin-bottom:6px}
    .v30CreateHint{font-size:11px;color:#667085;line-height:1.45;margin:4px 0 8px}
    .v30CreateBtn{width:100%;min-height:46px;border:0;border-radius:9px;background:#176b36;color:#fff;font-weight:900;font-size:16px;padding:8px}
    .v30CreateBtn:disabled{opacity:.55}
    .v30CreateStatus{font-size:12px;color:#667085;margin-top:7px;line-height:1.45;overflow-wrap:anywhere}
  `;
  document.head.appendChild(style);

  const sharedBox=document.getElementById("sharedMasterId")?.closest(".eventProfileBox");
  if(!sharedBox)return;

  const box=document.createElement("div");
  box.className="v30CreateBox";
  box.innerHTML=`
    <div class="v30CreateTitle">新規大会作成</div>
    <div class="v30CreateHint">大会名・開催日・方式を入力して実行すると、記録用スプレッドシートを自動作成し、保存先ID設定と共有大会マスタ登録まで行います。同じ「年＋大会名」が既にある場合は新規作成しません。</div>
    <button type="button" id="createEventSpreadsheetV30" class="v30CreateBtn">新規大会＋記録シートを作成</button>
    <div id="createEventStatusV30" class="v30CreateStatus"></div>
  `;
  sharedBox.parentNode.insertBefore(box,sharedBox);

  // V31 / GAS V7 iframe bridge: no dynamic JSONP.
  async function createEventViaPost(params){
    const endpoint=(document.getElementById("sEndpoint")?.value||cfg.endpoint||"").trim();
    if(!endpoint)throw new Error("Google Apps Script URLが未設定です");
    await fetch(endpoint,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(params)});
    return {ok:true,queued:true};
  }

  async function createEventSpreadsheetV30(){
    const btn=document.getElementById("createEventSpreadsheetV30");
    const status=document.getElementById("createEventStatusV30");
    const event=(document.getElementById("sEvent")?.value||"").trim();
    const date=document.getElementById("sDate")?.value||"";
    const mode=document.getElementById("sMode")?.value||"MARATHON";
    const year=Number((date||"").slice(0,4))||Number(document.getElementById("profileYear")?.value)||new Date().getFullYear();
    const masterId=(document.getElementById("sharedMasterId")?.value||localStorage.getItem(MASTER_ID_KEY)||"").trim();
    const endpoint=(document.getElementById("sEndpoint")?.value||cfg.endpoint||"").trim();

    if(!event){alert("大会名を入力してください。");return;}
    if(!date){alert("開催日を入力してください。");return;}
    if(!masterId){alert("共有マスタ スプレッドシートIDを入力してください。");return;}
    if(!endpoint){alert("Google Apps Script URLを入力してください。");return;}
    if(!navigator.onLine){alert("オフラインのため新規大会を作成できません。");return;}

    const cleanEvent=event.replace(new RegExp("^"+year+"[ _　-]*"),"").trim()||event;
    const filename=`${year}_${cleanEvent}_記録データ`;
    const relayGap=(document.getElementById("sRelayGap")?.value||"").trim();
    if(!confirm(`${filename}\n\n記録用スプレッドシートを新規作成し、共有大会マスタへ登録します。\nよろしいですか？`))return;

    btn.disabled=true;
    status.textContent="新規大会を作成中… Googleドライブと共有大会マスタを確認しています。";
    try{
      const res=await createEventViaPost({
        action:"CREATE_EVENT",
        masterId,
        year:String(year),
        event,
        date,
        mode,
        relayGap,
        endpoint
      });
      if(document.getElementById("profileYear"))document.getElementById("profileYear").value=year;
      if(document.getElementById("sharedYear"))document.getElementById("sharedYear").value=year;
      localStorage.setItem(MASTER_ID_KEY,masterId);
      localStorage.setItem("lap_number_active_master_id",masterId);
      document.getElementById("sSheetId").value="";
      status.textContent=`✅ ${filename} の作成命令を送信しました。V9では保存先IDをスマホへ返さず、共有マスタからGAS側で自動解決します。`;
      document.getElementById("saveSettings")?.click();
    }catch(e){
      status.textContent=`❌ 新規大会を作成できませんでした：${e.message||e}。Apps Script V9・共有大会マスタID・通信状態を確認してください。`;
    }finally{
      btn.disabled=false;
    }
  }

  document.getElementById("createEventSpreadsheetV30").addEventListener("click",createEventSpreadsheetV30);
})();
const $ = id => document.getElementById(id);
const KEY_CFG = "taikai_voice_cfg_v1";
const KEY_REC = "taikai_voice_rec_v1";
const KEY_QUEUE = "taikai_voice_queue_v1";
const KEY_MAN = "taikai_voice_man_mode_v1";
const KEY_SEQ = "taikai_voice_seq_v1";

let cfg = { event:"大会名未設定", date:"", mode:"MARATHON", point:"地点未設定", staff:"", top:"", relayGap:1, endpoint:"", sheetId:"", sheetName:"" };
let records = [], sendQueue = [], ok = 0, muri = 0, recognition = null, listening = false, restartTimer = null, deferredInstall = null, isSending = false, manMode = false, seqCounter = 0;
let lastSpeech = "—";

function load(){
  try{ Object.assign(cfg, JSON.parse(localStorage.getItem(KEY_CFG)||"{}")); }catch{}
  cfg.relayGap = Math.max(1, Math.min(60, Number(cfg.relayGap)||1));
  cfg.sheetId = String(cfg.sheetId||"").trim();
  cfg.sheetName = String(cfg.sheetName||"").trim();
  try{ records = JSON.parse(localStorage.getItem(KEY_REC)||"[]"); }catch{ records=[]; }
  try{ sendQueue = JSON.parse(localStorage.getItem(KEY_QUEUE)||"[]"); }catch{ sendQueue=[]; }
  manMode = localStorage.getItem(KEY_MAN)==="1";
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
    if(r.mode==="RELAY"&&r.lap) tag=`<span class="historyTag relayTag">${esc(r.lap)}周目</span>`;
    else if(r.duplicate) tag='<span class="historyTag duplicateTag">重複</span>';
    else if(r.invalidGap) tag='<span class="historyTag invalidTag">無効</span>';
    return `<div class="row"><span>${esc(r.seqNo||"")}</span><span class="numberCell"><span class="historyNumber">${esc(r.value)}</span>${tag}</span><span>${esc(r.time)}</span></div>`;
  }).join("");
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
  const b=$("manModeBtn"); if(b){b.hidden=cfg.mode==="EKIDEN";b.innerHTML=`<span>万台</span><span>モード</span>`;b.style.background=manMode?"#0b57d0":"#fff";b.style.color=manMode?"#fff":"#c64b14";b.title=manMode?"万台番号モード ON":"万台番号モード OFF";}
  const mh=$("manModeHint");if(mh)mh.hidden=cfg.mode==="EKIDEN"; const rw=$("relayGapWrap");if(rw)rw.hidden=cfg.mode!=="RELAY";
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
function relayLast(value){ return records.find(r=>!r.cancelled&&!r.invalidGap&&r.mode==="RELAY"&&r.value===value); }
function makeRecordBase(value,recognized,rawSpeech){ return {id:Date.now()+"_"+Math.random().toString(36).substr(2,5),seqNo:nextSeq(),value,recognized,time:now(),ts:Date.now(),event:cfg.event,date:cfg.date,point:cfg.point,staff:cfg.staff,mode:cfg.mode,rawSpeech,sheetId:cfg.sheetId||""}; }

function add(value,recognized=true,rawSpeech=""){
  if(rawSpeech)lastSpeech=rawSpeech;
  if(cfg.mode==="RELAY"&&recognized){const prev=relayLast(value);if(prev){const diff=(Date.now()-prev.ts)/1000;if(diff<cfg.relayGap*60){const rec={...makeRecordBase(value,true,rawSpeech),invalidGap:true,invalidSeconds:Math.round(diff),lap:prev.lap};records.unshift(rec);save();render();$("status").textContent=`⚠ ${value}：${cfg.relayGap}分未満なので無効`;return;}}const lap=prev?(Number(prev.lap)||1)+1:1;const rec={...makeRecordBase(value,true,rawSpeech),duplicate:false,lap};records.unshift(rec);if(cfg.endpoint)sendQueue.push(rec);save();render();processQueue();return;}
  const duplicate=recognized&&records.some(r=>!r.cancelled&&!r.invalidGap&&r.recognized&&r.value===value);const rec={...makeRecordBase(value,recognized,rawSpeech),duplicate};records.unshift(rec);if(cfg.endpoint)sendQueue.push(rec);save();render();processQueue();if(duplicate)$("status").textContent=`⚠ ${value} は重複です`;
}
function showRecognitionRaw(s){ lastSpeech=s||"（空）";if($("rawSpeechValue"))$("rawSpeechValue").textContent=lastSpeech; }
function cancelLast(){ const i=records.findIndex(r=>!r.cancelled);if(i<0){$("status").textContent="キャンセルする登録データがありません";return}const r=records[i];r.cancelled=true;r.cancelledAt=now();r.cancelledBy="キャンセル";sendQueue=sendQueue.filter(q=>q.id!==r.id);save();render();$("status").textContent=`直前の「${r.value}」をキャンセルしました`; }

async function deleteNumber(){const input=$("deleteNumberInput");if(!input)return;const target=parseNumber(input.value.trim());if(!target||target==="MURI"||target==="CANCEL"){alert(cfg.mode==="EKIDEN"?"削除する駅伝番号を 125-3 の形式で入力してください。":"削除するナンバーを1～99999で入力してください。");input.focus();return;}const i=records.findIndex(r=>!r.cancelled&&!r.invalidGap&&r.value===target);if(i<0){$("status").textContent=`「${target}」は現在のアプリ内登録にありません`;input.select();return;}const r=records[i],lapText=r.mode==="RELAY"&&r.lap?`（${r.lap}周目）`:"";if(!confirm(`「${target}」${lapText}を削除しますか？\n\n最も新しい登録1件だけを削除します。\nこの操作は元に戻せません。`))return;r.cancelled=true;r.cancelledAt=now();r.cancelledBy="番号指定削除";sendQueue=sendQueue.filter(q=>q.id!==r.id);save();render();input.value="";$("status").textContent=`「${target}」${lapText}を削除しました`;if(cfg.endpoint&&navigator.onLine){try{await fetch(cfg.endpoint,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"DELETE",id:r.id||"",seqNo:r.seqNo||"",point:r.point||cfg.point||"",value:r.value||"",mode:r.mode||cfg.mode||"",event:r.event||cfg.event||"",date:r.date||cfg.date||"",staff:r.staff||cfg.staff||"",lap:r.lap||"",time:r.time||"",sheetId:r.sheetId||cfg.sheetId||""})});$("status").textContent=`「${target}」削除送信完了`;}catch{$("status").textContent=`「${target}」はアプリから削除済・シート削除送信失敗`;}}input.focus();}

async function processQueue(){if(isSending||!sendQueue.length||!cfg.endpoint||!navigator.onLine)return;isSending=true;while(sendQueue.length&&navigator.onLine){const item=sendQueue[0];try{const payload={...item,sheetId:item.sheetId||cfg.sheetId||""};const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);await fetch(cfg.endpoint,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:c.signal});clearTimeout(t);sendQueue.shift();save();render();}catch{break}}isSending=false;}
function registerManual(){const v=parseNumber($("numberInput").value.trim());if(v==="CANCEL"){cancelLast();$("numberInput").value="";return}if(!v){alert(cfg.mode==="RELAY"?"1～99999の番号を入力してください。":manMode?"万台モードでは10,000～99,999を入力するか1桁ずつ読んでください。":cfg.mode==="EKIDEN"?"駅伝は 125-3（1～9999×1～25区）で入力してください。":"1～99999の番号を入力してください。");return}add(v==="MURI"?"ムリ":v,v!=="MURI",$("numberInput").value.trim());$("numberInput").value="";$("numberInput").focus();}
function startRecognition(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){alert("このブラウザは音声認識に対応していません。Chromeを使用してください。");return}recognition=new SR();recognition.lang="ja-JP";recognition.interimResults=false;recognition.continuous=false;recognition.onresult=e=>{const t=e.results[0][0].transcript;showRecognitionRaw(t);const v=parseNumber(t);if(v==="CANCEL")cancelLast();else if(v==="MURI")add("ムリ",false,t);else if(v)add(v,true,t);else $("status").textContent=`認識できません：「${t}」`;};recognition.onerror=e=>{if(e.error!=="aborted")$("status").textContent="音声認識エラー："+e.error;};recognition.onend=()=>{if(listening){clearTimeout(restartTimer);restartTimer=setTimeout(()=>{try{recognition.start()}catch{}},180)}};listening=true;render();try{recognition.start()}catch{}}
function stopRecognition(){listening=false;clearTimeout(restartTimer);try{recognition&&recognition.abort()}catch{}render()}
function fillSettings(){$("sEvent").value=cfg.event==="大会名未設定"?"":cfg.event;$("sDate").value=cfg.date;$("sMode").value=cfg.mode;$("sPoint").value=cfg.point==="地点未設定"?"":cfg.point;$("sStaff").value=cfg.staff;$("sTop").value=cfg.top;$("sRelayGap").value=cfg.relayGap;$("sEndpoint").value=cfg.endpoint;$("sSheetId").value=cfg.sheetId||"";const rw=$("relayGapWrap");if(rw)rw.hidden=cfg.mode!=="RELAY";const cs=$("connectionStatus");if(cs)cs.textContent=cfg.sheetName?`現在の保存先：${cfg.sheetName}`:"";}
function saveSettings(){cfg.event=$("sEvent").value||"大会名未設定";cfg.date=$("sDate").value;cfg.mode=$("sMode").value;cfg.point=$("sPoint").value||"地点未設定";cfg.staff=$("sStaff").value;cfg.top=$("sTop").value;cfg.relayGap=Math.max(1,Math.min(60,Number($("sRelayGap").value)||1));cfg.endpoint=$("sEndpoint").value.trim();cfg.sheetId=$("sSheetId").value.trim();cfg.sheetName="";save();$("settingsPanel").hidden=true;render();processQueue();}
function clearRecords(){if(!confirm("この端末の登録データを全て消去します。No.も1から再開します。よろしいですか？"))return;records=[];sendQueue=[];seqCounter=0;lastSpeech="—";save();render();}
function testDestination(){const status=$("connectionStatus"),endpoint=$("sEndpoint").value.trim(),sheetId=$("sSheetId").value.trim();if(!endpoint){status.textContent="❌ Google Apps Script URLを入力してください";return}if(!sheetId){status.textContent="❌ 保存先スプレッドシートIDを入力してください";return}status.textContent="接続確認中…";const payload={action:"PING",sheetId,event:$("sEvent").value||"接続確認",date:$("sDate").value||"",mode:$("sMode").value||"MARATHON",point:$("sPoint").value||"接続確認",staff:$("sStaff").value||"",time:now(),id:"PING_"+Date.now()};const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);fetch(endpoint,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:c.signal}).then(()=>{clearTimeout(timer);cfg.sheetId=sheetId;cfg.sheetName="";status.textContent="✅ 接続要求を送信できました。保存後、テスト番号を1件登録して確認してください。";}).catch(()=>{clearTimeout(timer);status.textContent="❌ 接続確認できませんでした。URL・ID・通信状態を確認してください。";});}

$("voiceBtn").addEventListener("click",()=>listening?stopRecognition():startRecognition());$("registerBtn").addEventListener("click",registerManual);$("numberInput").addEventListener("keydown",e=>{if(e.key==="Enter")registerManual()});$("muriBtn").addEventListener("click",()=>add("ムリ",false,"ボタン"));$("cancelLastBtn").addEventListener("click",cancelLast);$("deleteNumberBtn").addEventListener("click",deleteNumber);$("deleteNumberInput").addEventListener("keydown",e=>{if(e.key==="Enter")deleteNumber()});$("manModeBtn").addEventListener("click",()=>{manMode=!manMode;save();render();});$("settingsBtn").addEventListener("click",()=>{fillSettings();$("settingsPanel").hidden=false});$("closeSettings").addEventListener("click",()=>$("settingsPanel").hidden=true);$("saveSettings").addEventListener("click",saveSettings);$("clearRecordsBtn").addEventListener("click",clearRecords);$("testConnectionBtn").addEventListener("click",testDestination);$("sMode").addEventListener("change",()=>{const rw=$("relayGapWrap");if(rw)rw.hidden=$("sMode").value!=="RELAY";});window.addEventListener("online",()=>{render();processQueue();});window.addEventListener("offline",render);setInterval(refreshClock,500);window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("installBtn").hidden=false});$("installBtn").addEventListener("click",async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("installBtn").hidden=true}});if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js");load();window.deleteNumber=deleteNumber;
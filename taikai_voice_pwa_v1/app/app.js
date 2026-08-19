const $ = id => document.getElementById(id);
const KEY_CFG = "taikai_voice_cfg_v1";
const KEY_REC = "taikai_voice_rec_v1";
const KEY_QUEUE = "taikai_voice_queue_v1";
const KEY_MAN = "taikai_voice_man_mode_v1";

let cfg = { event:"大会名未設定", date:"", mode:"MARATHON", point:"地点未設定", staff:"", top:"", relayGap:1, endpoint:"", sheetId:"", sheetName:"" };
let records = [], sendQueue = [], ok = 0, muri = 0, recognition = null, listening = false, restartTimer = null, deferredInstall = null, isSending = false, manMode = false;

function load(){
  try{ Object.assign(cfg, JSON.parse(localStorage.getItem(KEY_CFG)||"{}")); }catch{}
  cfg.relayGap = Math.max(1, Math.min(60, Number(cfg.relayGap)||1));
  cfg.sheetId = String(cfg.sheetId||"").trim();
  cfg.sheetName = String(cfg.sheetName||"").trim();
  try{ records = JSON.parse(localStorage.getItem(KEY_REC)||"[]"); }catch{ records=[]; }
  try{ sendQueue = JSON.parse(localStorage.getItem(KEY_QUEUE)||"[]"); }catch{ sendQueue=[]; }
  manMode = localStorage.getItem(KEY_MAN)==="1";
  recount(); render(); processQueue();
}
function save(){
  localStorage.setItem(KEY_CFG, JSON.stringify(cfg));
  localStorage.setItem(KEY_REC, JSON.stringify(records));
  localStorage.setItem(KEY_QUEUE, JSON.stringify(sendQueue));
  localStorage.setItem(KEY_MAN, manMode ? "1" : "0");
}
function recount(){
  ok = records.filter(r=>r.recognized&&!r.cancelled&&!r.invalidGap).length;
  muri = records.filter(r=>!r.recognized&&!r.cancelled).length;
}
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function now(){ return new Date().toLocaleTimeString("ja-JP",{hour12:false}); }
function updateCountdown(){ $("countdown").textContent = cfg.top ? `TOP予想 ${cfg.top} ${countdownText()}` : "TOP予想：未設定"; }
function modeName(){ return cfg.mode==="EKIDEN" ? "駅伝" : cfg.mode==="RELAY" ? "リレーマラソン" : "マラソン"; }
function destinationLabel(){
  if(cfg.sheetName) return cfg.sheetName;
  if(cfg.sheetId) return `ID:${cfg.sheetId.slice(0,8)}…`;
  return "標準スプレッドシート";
}

function render(){
  $("event").textContent = cfg.event + (cfg.date ? ` ${cfg.date}` : "");
  $("point").textContent = modeName()+" "+cfg.point;
  $("staff").textContent = "担当："+(cfg.staff||"未設定");
  const dest=$("destination"); if(dest) dest.textContent="保存先："+destinationLabel();
  $("modeBadge").textContent = modeName();
  updateCountdown(); recount();
  $("okCount").textContent=ok; $("muriCount").textContent=muri; $("totalCount").textContent=ok+muri;
  const latest=records.find(r=>!r.cancelled);
  $("latest").textContent=latest?.value||"—";
  $("latestSub").textContent=latest ? (latest.invalidGap ? `⚠ ${cfg.relayGap}分未満・無効` : latest.recognized ? (cfg.mode==="RELAY" ? `${latest.lap}周目　番号認識` : (latest.duplicate ? "重複・番号認識" : "番号認識")) : "ムリ（番号不明）") : "";
  $("history").innerHTML=records.filter(r=>!r.cancelled).slice(0,10).map(r=>{
    const sub=r.mode==="RELAY"&&r.lap ? ` <small>${r.lap}周目</small>` : "";
    const flag=r.invalidGap ? ` <span style="color:#b3261e;font-weight:700;margin-left:6px;">${cfg.relayGap}分未満・無効</span>` : r.duplicate&&r.mode!=="RELAY" ? ` <span style="color:#d32f2f;font-weight:700;margin-left:6px;">重複</span>` : "";
    return `<div class="row"><span>${esc(r.value)}${sub}${flag}</span><span>${esc(r.time)}</span></div>`;
  }).join("");
  $("voiceBtn").textContent=listening ? "🛑 音声受付停止" : cfg.mode==="EKIDEN" ? "🎤 通過ナンバー開始" : cfg.mode==="RELAY" ? "🎤 周回ナンバー開始" : "🎤 フィニッシュナンバー開始";
  $("voiceBtn").classList.toggle("on",listening);
  $("status").textContent=(listening?"🟢 音声受付中":"停止中")+(sendQueue.length?` ⚠️未送信${sendQueue.length}件`:"");
  const b=$("manModeBtn");
  if(b){ b.hidden=cfg.mode==="EKIDEN"; b.textContent=`🔢 万台番号モード：${manMode?"ON":"OFF"}`; b.style.background=manMode?"#0b57d0":"#fff"; b.style.color=manMode?"#fff":"#0b57d0"; }
  const h=$("manModeHint"); if(h) h.hidden=cfg.mode==="EKIDEN";
  const rw=$("relayGapWrap"); if(rw) rw.hidden=cfg.mode!=="RELAY";
}

function normalizeSpeech(s){ return (s||"").normalize("NFKC").replace(/[\s・,、。]/g,"").replace(/[ー－―—]/g,"-").replace(/の区/g,"区"); }
const digitKana={ゼロ:"0",レイ:"0",イチ:"1",イッ:"1",ニ:"2",ニー:"2",サン:"3",ヨン:"4",シ:"4",ゴ:"5",ロク:"6",ナナ:"7",シチ:"7",ハチ:"8",キュウ:"9",キュー:"9",ク:"9"};
const jpRead={ゼロ:"零",レイ:"零",イチ:"一",イッ:"一",ニ:"二",ニー:"二",サン:"三",ヨン:"四",シ:"四",ゴ:"五",ロク:"六",ナナ:"七",シチ:"七",ハチ:"八",キュウ:"九",キュー:"九",ク:"九",マン:"万",マンク:"万",セン:"千",ゼン:"千",ヒャク:"百",ビャク:"百",ピャク:"百",ジュウ:"十",ジュー:"十"};
const jpDigit={零:0,〇:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
function kanaDigitsToNumber(s){ let x=normalizeSpeech(s),out="",keys=Object.keys(digitKana).sort((a,b)=>b.length-a.length); while(x){let found=false;for(const k of keys)if(x.startsWith(k)){out+=digitKana[k];x=x.slice(k.length);found=true;break}if(!found)return null}if(!out||out.length>5)return null;const n=Number(out);return n>=1&&n<=99999?n:null; }
function jpToNumber(s){ let x=normalizeSpeech(s);Object.keys(jpRead).sort((a,b)=>b.length-a.length).forEach(k=>x=x.replaceAll(k,jpRead[k]));let total=0,section=0,num=0,has=false;for(const ch of x){if(jpDigit[ch]!==undefined){num=jpDigit[ch];has=true}else if(ch==="十"||ch==="百"||ch==="千"){section+=(num||1)*({十:10,百:100,千:1000}[ch]);num=0;has=true}else if(ch==="万"){section+=num;total+=section*10000;section=0;num=0;has=true}else return null}return has?total+section+num:null; }
function digitTextToNumber(s){ const d=s.replace(/[^0-9]/g,"");if(!d)return null;const n=Number(d);return d&&n>=1&&n<=99999?n:null; }
function parseNumber(raw){
  const s=normalizeSpeech(raw);
  if(/むり|無理/i.test(s)) return "MURI";
  if(/キャンセル|きゃんせる|取り消し|とりけし|取消|戻す|もどす/.test(s)) return "CANCEL";
  if(cfg.mode==="EKIDEN"){
    let m=s.match(/(\d{1,4})-(\d{1,2})/); if(!m)m=s.match(/(\d{1,4}).{0,3}?(\d{1,2})区/); if(!m)m=s.match(/(\d{1,4})の(\d{1,2})/); if(!m)return null;
    const a=Number(m[1]),b=Number(m[2]); return a>=1&&a<=9999&&b>=1&&b<=25?`${a}-${b}`:null;
  }
  if(manMode){ const n=digitTextToNumber(s)??kanaDigitsToNumber(s); return n&&n>=10000?String(n):null; }
  const candidates=[]; const d=digitTextToNumber(s); if(d!==null)candidates.push({n:d,score:1}); const kd=kanaDigitsToNumber(s);if(kd!==null)candidates.push({n:kd,score:8}); const j=jpToNumber(s);if(j!==null)candidates.push({n:j,score:/万|千|百|十/.test(s)?10:2});
  candidates.sort((a,b)=>b.score-a.score); for(const c of candidates)if(c.n>=1&&c.n<=99999)return String(c.n); return null;
}
function relayLast(value){ return records.find(r=>!r.cancelled&&!r.invalidGap&&r.mode==="RELAY"&&r.value===value); }
function makeRecordBase(value,recognized,rawSpeech){ return {id:Date.now()+"_"+Math.random().toString(36).substr(2,5),value,recognized,time:now(),ts:Date.now(),event:cfg.event,date:cfg.date,point:cfg.point,staff:cfg.staff,mode:cfg.mode,rawSpeech,sheetId:cfg.sheetId||""}; }
function add(value,recognized=true,rawSpeech=""){
  if(cfg.mode==="RELAY"&&recognized){
    const prev=relayLast(value);
    if(prev){ const diff=(Date.now()-prev.ts)/1000; if(diff<cfg.relayGap*60){ const rec={...makeRecordBase(value,true,rawSpeech),invalidGap:true,invalidSeconds:Math.round(diff),lap:prev.lap}; records.unshift(rec);save();render();$("status").textContent=`⚠ ${value}：${cfg.relayGap}分未満なので無効`;return; } }
    const lap=prev?(Number(prev.lap)||1)+1:1; const rec={...makeRecordBase(value,true,rawSpeech),duplicate:false,lap}; records.unshift(rec);if(cfg.endpoint)sendQueue.push(rec);save();render();processQueue();return;
  }
  const duplicate=recognized&&records.some(r=>!r.cancelled&&!r.invalidGap&&r.recognized&&r.value===value);
  const rec={...makeRecordBase(value,recognized,rawSpeech),duplicate};
  records.unshift(rec);if(cfg.endpoint)sendQueue.push(rec);save();render();processQueue();if(duplicate)$("status").textContent=`⚠️ ${value} は重複です`;
}
function showRecognitionRaw(s){ let el=$("rawSpeech");if(!el){el=document.createElement("div");el.id="rawSpeech";el.style.cssText="margin-top:8px;padding:8px 10px;border-radius:8px;background:#f1f3f4;color:#444;font-size:13px;word-break:break-all;white-space:pre-wrap";$("status").parentNode.appendChild(el)}el.textContent=`音声認識候補：${s||"（空）"}`; }
function cancelLast(){ const i=records.findIndex(r=>!r.cancelled);if(i<0){$("status").textContent="キャンセルする登録データがありません";return}const r=records[i];r.cancelled=true;r.cancelledAt=now();r.cancelledBy="キャンセル";sendQueue=sendQueue.filter(q=>q.id!==r.id);save();render();$("status").textContent=`直前の「${r.value}」をキャンセルしました`; }
function deleteNumber(){
  const input=$("deleteNumberInput");
  if(!input){return;}
  const target=parseNumber(input.value.trim());
  if(!target||target==="MURI"||target==="CANCEL"){
    alert(cfg.mode==="EKIDEN"?"削除する駅伝番号を 125-3 の形式で入力してください。":"削除するナンバーを1～99999で入力してください。");
    input.focus(); return;
  }
  const i=records.findIndex(r=>!r.cancelled&&!r.invalidGap&&r.value===target);
  if(i<0){ $("status").textContent=`「${target}」は現在のアプリ内登録にありません`; input.select(); return; }
  const r=records[i];
  const lapText=r.mode==="RELAY"&&r.lap?`（${r.lap}周目）`:"";
  if(!confirm(`「${target}」${lapText}をアプリから削除しますか？\n\n最も新しい登録1件だけを削除します。\nこの操作は元に戻せません。`))return;
  r.cancelled=true; r.cancelledAt=now(); r.cancelledBy="番号指定削除";
  sendQueue=sendQueue.filter(q=>q.id!==r.id);
  save(); render();
  $("status").textContent=`「${target}」${lapText}を削除しました（アプリ内）`;
  input.value=""; input.focus();
}
async function processQueue(){
  if(isSending||!sendQueue.length||!cfg.endpoint||!navigator.onLine)return;isSending=true;
  while(sendQueue.length&&navigator.onLine){const item=sendQueue[0];try{const payload={...item,sheetId:item.sheetId||cfg.sheetId||""};const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);await fetch(cfg.endpoint,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:c.signal});clearTimeout(t);sendQueue.shift();save();render();}catch{break}}
  isSending=false;
}
function registerManual(){
  const v=parseNumber($("numberInput").value.trim());
  if(v==="CANCEL"){cancelLast();$("numberInput").value="";return}
  if(!v){alert(cfg.mode==="RELAY"?"1～99999の番号を入力してください。":manMode?"万台モードでは10,000～99,999を入力するか1桁ずつ読んでください。":cfg.mode==="EKIDEN"?"駅伝は 125-3（1～9999×1～25区）で入力してください。":"1～99999の番号を入力してください。");return}
  add(v==="MURI"?"ムリ":v,v!=="MURI",$("numberInput").value.trim());$("numberInput").value="";$("numberInput").focus();
}
function startRecognition(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){$("status").textContent="このブラウザでは音声認識を利用できません。直接入力をご利用ください。";return}if(listening){stopRecognition();return}listening=true;render();startOne();}
function startOne(){if(!listening)return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return;try{if(recognition){recognition.onend=null;recognition.onerror=null;try{recognition.abort()}catch{}}recognition=new SR();recognition.lang="ja-JP";recognition.interimResults=false;recognition.continuous=false;recognition.maxAlternatives=5;recognition.onresult=e=>{const alts=[...e.results[0]].map(x=>x.transcript);let v=null;for(const x of alts){const p=parseNumber(x);if(p&&!v)v=p}showRecognitionRaw(alts.join(" / "));if(v==="CANCEL")cancelLast();else if(v==="MURI")add("ムリ",false,alts[0]||"");else if(v)add(v,true,alts[0]||"");else $("status").textContent=manMode?"万台モード：1～5桁を1桁ずつ読んでください。":"聞き取りましたが番号判定できません。もう一度。"};recognition.onerror=e=>{if(listening&&e.error!=="aborted")$("status").textContent=`音声エラー：${e.error}（直接入力も使用できます）`};recognition.onend=()=>{if(listening)restartTimer=setTimeout(startOne,200)};recognition.start()}catch{if(listening)restartTimer=setTimeout(startOne,500)}}
function stopRecognition(){listening=false;clearTimeout(restartTimer);if(recognition){recognition.onend=null;try{recognition.stop()}catch{}recognition=null}render();}
function openSettings(){$("sEvent").value=cfg.event;$("sDate").value=cfg.date;$("sMode").value=cfg.mode;$("sPoint").value=cfg.point;$("sStaff").value=cfg.staff;$("sTop").value=cfg.top;$("sRelayGap").value=cfg.relayGap;$("sEndpoint").value=cfg.endpoint;$("sSheetId").value=cfg.sheetId||"";const cs=$("connectionStatus");if(cs)cs.textContent=cfg.sheetName?`接続先：${cfg.sheetName}`:"";$("settingsPanel").hidden=false;render();}
function doCloseSettings(){$("settingsPanel").hidden=true;}
function doSaveSettings(){cfg={event:$("sEvent").value||"大会名未設定",date:$("sDate").value,mode:$("sMode").value,point:$("sPoint").value||"地点未設定",staff:$("sStaff").value,top:$("sTop").value,relayGap:Math.max(1,Math.min(60,Number($("sRelayGap").value)||1)),endpoint:$("sEndpoint").value.trim(),sheetId:$("sSheetId").value.trim(),sheetName:cfg.sheetName||""};save();render();doCloseSettings();}
function countdownText(){if(!cfg.top)return"";const[h,m,s]=cfg.top.split(":").map(Number);if(!Number.isFinite(h)||!Number.isFinite(m))return"";const t=new Date();t.setHours(h,m,s||0,0);let d=t-Date.now(),past=d<0;d=Math.abs(d);const sec=Math.floor(d/1000);return past?`経過 ${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`:`あと ${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;}
async function testConnection(){
  const endpoint=$("sEndpoint").value.trim();
  const sheetId=$("sSheetId").value.trim();
  const out=$("connectionStatus");
  if(!endpoint){out.textContent="Apps Script URLを入力してください";return;}
  if(!sheetId){out.textContent="スプレッドシートIDを入力してください";return;}
  if(!navigator.onLine){out.textContent="❌ オフラインです。通信状態を確認してください";return;}

  out.textContent="接続確認中…";
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),15000);
  try{
    await fetch(endpoint,{
      method:"POST",
      mode:"no-cors",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({action:"PING",sheetId:sheetId}),
      signal:c.signal
    });
    clearTimeout(timer);
    cfg.sheetId=sheetId;
    cfg.sheetName="";
    save();
    render();
    out.textContent="✅ 接続要求を送信できました。保存後、テスト番号を1件登録してスプレッドシートへの記録を確認してください。";
  }catch(e){
    clearTimeout(timer);
    out.textContent="❌ 接続確認を送信できませんでした。通信状態またはApps Script URLを確認してください。";
  }
}

$("voiceBtn").onclick=startRecognition;$("registerBtn").onclick=registerManual;$("muriBtn").onclick=()=>add("ムリ",false);$("numberInput").addEventListener("keydown",e=>{if(e.key==="Enter")registerManual()});$("settingsBtn").onclick=openSettings;$("closeSettings").onclick=doCloseSettings;$("saveSettings").onclick=doSaveSettings;$("testConnectionBtn")?.addEventListener("click",testConnection);$("manModeBtn")?.addEventListener("click",()=>{manMode=!manMode;save();render();$("status").textContent=manMode?"万台モードON：10,000～99,999は1桁ずつ読んでください。":"万台モードOFF：通常の番号読み上げに戻しました。"});$("clearRecordsBtn").onclick=()=>{if(confirm("登録されている番号データをすべて削除します。\nこの操作は元に戻せません。\n大会設定は残ります。\n\n本当に削除しますか？")){records=[];sendQueue=[];save();render();$("status").textContent="登録データを全消去しました"}};$("cancelLastBtn")?.addEventListener("click",cancelLast);$("deleteNumberBtn")?.addEventListener("click",deleteNumber);$("deleteNumberInput")?.addEventListener("keydown",e=>{if(e.key==="Enter")deleteNumber()});window.addEventListener("online",()=>{render();processQueue()});window.addEventListener("offline",render);setInterval(processQueue,15000);setInterval(()=>{if(cfg.top)updateCountdown()},1000);window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("installBtn").hidden=false});$("installBtn").onclick=async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("installBtn").hidden=true}};if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});load();
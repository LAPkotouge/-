const $=id=>document.getElementById(id);
const KEY="taikai_voice_v1";
let cfg={event:"大会名未設定",date:"",mode:"MARATHON",point:"地点未設定",staff:"",top:"",endpoint:""};
let records=[], ok=0, muri=0, recognition=null, listening=false, restartTimer=null, deferredInstall=null;

function load(){try{Object.assign(cfg,JSON.parse(localStorage.getItem(KEY)||"{}"));}catch{} render();}
function save(){localStorage.setItem(KEY,JSON.stringify(cfg));}
function render(){
 $("event").textContent=cfg.event+(cfg.date?`　${cfg.date}`:"");
 $("point").textContent=(cfg.mode==="EKIDEN"?"駅伝":"マラソン")+"　"+cfg.point;
 $("staff").textContent="担当："+(cfg.staff||"未設定");
 $("modeBadge").textContent=cfg.mode==="EKIDEN"?"駅伝":"マラソン";
 $("countdown").textContent=cfg.top?`TOP予想 ${cfg.top}　${countdownText()}`:"TOP予想：未設定";
 $("okCount").textContent=ok;$("muriCount").textContent=muri;$("totalCount").textContent=ok+muri;
 $("latest").textContent=records[0]?.value||"—";
 $("latestSub").textContent=records[0]?(records[0].recognized?"番号認識":"ムリ（番号不明）"):"";
 $("history").innerHTML=records.slice(0,10).map(r=>`<div class="row"><span>${esc(r.value)}</span><span>${esc(r.time)}</span></div>`).join("");
 $("voiceBtn").textContent=listening?"🛑 音声受付停止":(cfg.mode==="EKIDEN"?"🎤 通過ナンバー開始":"🎤 フィニッシュナンバー開始");
 $("voiceBtn").classList.toggle("on",listening);
 $("status").textContent=listening?"🟢 音声受付中":"停止中";
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function now(){return new Date().toLocaleTimeString("ja-JP",{hour12:false});}
function normalizeSpeech(s){
 return s.replace(/\s/g,"").replace(/ー/g,"-").replace(/－/g,"-").replace(/―/g,"-").replace(/の区/g,"区");
}
function parseNumber(raw){
 const s=normalizeSpeech(raw);
 if(/むり|無理/i.test(s)) return "MURI";
 if(cfg.mode==="EKIDEN"){
   let m=s.match(/(\d{1,4})-(\d{1,2})/);
   if(!m) m=s.match(/(\d{1,4}).{0,3}?(\d{1,2})区/);
   if(!m){
     // common Japanese speech variants: "125 の 3", "125 3"
     m=s.match(/(\d{1,4})の(\d{1,2})/);
   }
   if(!m)return null;
   const a=Number(m[1]),b=Number(m[2]);
   return a>=1&&a<=9999&&b>=1&&b<=25?`${a}-${b}`:null;
 }
 const d=s.replace(/[^\d]/g,"");
 const n=Number(d);
 return d && n>=1 && n<=99999?String(n):null;
}
function add(value,recognized=true){
 const rec={value,recognized,time:now(),event:cfg.event,date:cfg.date,point:cfg.point,staff:cfg.staff,mode:cfg.mode};
 records.unshift(rec);records=records.slice(0,100);
 if(recognized)ok++;else muri++;
 render();send(rec);
}
function registerManual(){
 const v=parseNumber($("numberInput").value.trim());
 if(!v){alert(cfg.mode==="EKIDEN"?"駅伝は 125-3（1～9999×1～25区）で入力してください。":"1～99999の番号を入力してください。");return;}
 if(v==="MURI")add("ムリ",false);else add(v,true);
 $("numberInput").value="";$("numberInput").focus();
}
function startRecognition(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR){$("status").textContent="このブラウザでは音声認識を利用できません。直接入力をご利用ください。";return;}
 if(listening){stopRecognition();return;}
 recognition=new SR();recognition.lang="ja-JP";recognition.interimResults=false;recognition.continuous=false;recognition.maxAlternatives=5;
 recognition.onresult=e=>{
   const alts=[...e.results[0]].map(x=>x.transcript);
   let v=null;
   for(const x of alts){v=parseNumber(x);if(v)break;}
   if(v==="MURI")add("ムリ",false);else if(v)add(v,true);
   else $("status").textContent="聞き取りましたが番号判定できません。もう一度。";
 };
 recognition.onerror=e=>{
   if(listening) $("status").textContent=`音声エラー：${e.error}　（直接入力も使用できます）`;
 };
 recognition.onend=()=>{if(listening)restartTimer=setTimeout(startOne,180);};
 listening=true;render();startOne();
}
function startOne(){
 if(!listening||!recognition)return;
 try{recognition.start();}catch(e){}
}
function stopRecognition(){listening=false;clearTimeout(restartTimer);try{recognition?.stop()}catch{};recognition=null;render();}
function openSettings(){
 $("sEvent").value=cfg.event;$("sDate").value=cfg.date;$("sMode").value=cfg.mode;$("sPoint").value=cfg.point;$("sStaff").value=cfg.staff;$("sTop").value=cfg.top;$("sEndpoint").value=cfg.endpoint;
 $("settingsPanel").hidden=false;
}
function closeSettings(){$("settingsPanel").hidden=true;}
function saveSettings(){
 cfg={event:$("sEvent").value||"大会名未設定",date:$("sDate").value,mode:$("sMode").value,point:$("sPoint").value||"地点未設定",staff:$("sStaff").value,top:$("sTop").value,endpoint:$("sEndpoint").value};
 save();render();closeSettings();
}
function countdownText(){
 const [h,m,s]=cfg.top.split(":").map(Number);if(!Number.isFinite(h)||!Number.isFinite(m))return "";
 const t=new Date();t.setHours(h,m,s||0,0);let d=t-Date.now(),past=d<0;d=Math.abs(d);const sec=Math.floor(d/1000);return past?`経過 ${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`:`あと ${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;
}
function send(rec){
 if(!cfg.endpoint)return;
 fetch(cfg.endpoint,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(rec)}).catch(()=>{});
}
$("voiceBtn").onclick=startRecognition;$("registerBtn").onclick=registerManual;$("muriBtn").onclick=()=>add("ムリ",false);
$("numberInput").addEventListener("keydown",e=>{if(e.key==="Enter")registerManual();});
$("settingsBtn").onclick=openSettings;$("closeSettings").onclick=closeSettings;$("saveSettings").onclick=saveSettings;
setInterval(()=>{if(cfg.top)render()},1000);
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("installBtn").hidden=false;});
$("installBtn").onclick=async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("installBtn").hidden=true;}};
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
load();
// =====================================================
// V30安定化：受付データ送信をJSONP ACK方式へ変更
// ・Apps Scriptが実際に登録成功した時だけ送信キューから削除
// ・通信失敗／タイムアウト時はキューを保持して自動再送
// ・同一記録IDの再送はApps Script側で重複登録を防止
// =====================================================
(function setupReliableRecordTransport(){
  let sending=false;
  function payload(item){return {...item,sheetId:item.sheetId||cfg.sheetId||'',action:'RECORD_ADD'};}
  async function drain(){
    if(sending||!sendQueue.length||!cfg.endpoint||!navigator.onLine)return;
    sending=true;
    try{
      while(sendQueue.length&&navigator.onLine){
        const item=sendQueue[0];
        try{
          await fetch(String(cfg.endpoint).trim(),{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(item))});
          sendQueue.shift(); save(); render();
        }catch(e){break;}
      }
    }finally{
      sending=false;
      if(sendQueue.length&&navigator.onLine)setTimeout(drain,100);
    }
  }
  window.v31ReliableSend=drain;
  window.v31ProcessQueue=drain;
  setInterval(()=>{if(sendQueue.length&&navigator.onLine)drain();},1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)drain();});
  window.addEventListener('focus',drain);
  setTimeout(drain,100);
})();

// =====================================================
// V30安定化：受付データ送信をJSONP ACK方式へ変更
// ・Apps Scriptが実際に登録成功した時だけ送信キューから削除
// ・通信失敗／タイムアウト時はキューを保持して自動再送
// ・同一記録IDの再送はApps Script側で重複登録を防止
// =====================================================
(function setupReliableRecordTransport(){
  function jsonpRecordSend(item){
    return new Promise((resolve,reject)=>{
      const endpoint=String(cfg.endpoint||'').trim();
      if(!endpoint){reject(new Error('endpoint'));return;}

      const cb='recordAck_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
      const params=new URLSearchParams({
        action:'RECORD_ADD',
        callback:cb,
        sheetId:String(item.sheetId||cfg.sheetId||''),
        id:String(item.id||''),
        seqNo:String(item.seqNo||''),
        value:String(item.value||''),
        recognized:item.recognized?'1':'0',
        inputType:String(item.inputType||(item.recognized?'音声認識':'ボタン')),
        invalidGap:item.invalidGap?'1':'0',
        duplicate:item.duplicate?'1':'0',
        duplicateSeconds:String(item.duplicateSeconds||''),
        suspiciousRepeat:item.suspiciousRepeat?'1':'0',
        lap:String(item.lap||''),
        mode:String(item.mode||cfg.mode||''),
        event:String(item.event||cfg.event||''),
        date:String(item.date||cfg.date||''),
        point:String(item.point||cfg.point||''),
        staff:String(item.staff||cfg.staff||''),
        time:String(item.time||''),
        captureTs:String(item.captureTs||item.ts||''),
        recognizedTs:String(item.recognizedTs||''),
        recognitionDelayMs:String(item.recognitionDelayMs||''),
        confidence:String(item.confidence||''),
        recovery:item.recovery?'1':'0'
      });

      const script=document.createElement('script');
      let finished=false;
      const timer=setTimeout(()=>{
        if(finished)return;
        finished=true;
        cleanup();
        reject(new Error('timeout'));
      },15000);

      function cleanup(){
        clearTimeout(timer);
        try{delete window[cb];}catch{}
        script.remove();
      }

      window[cb]=res=>{
        if(finished)return;
        finished=true;
        cleanup();
        if(res&&res.ok)resolve(res);
        else reject(new Error((res&&res.error)||'server'));
      };

      script.onerror=()=>{
        if(finished)return;
        finished=true;
        cleanup();
        reject(new Error('network'));
      };

      // GAS Webアプリは長いGET(JSONP)で失敗することがあるため、診断用URLを保持
      script.src=endpoint+(endpoint.includes('?')?'&':'?')+params.toString();
      document.body.appendChild(script);
    });
  }

  // 既存processQueueを安定化版へ差し替え
  processQueue=async function(){
    if(isSending||!sendQueue.length||!cfg.endpoint||!navigator.onLine)return;
    isSending=true;
    try{
      while(sendQueue.length&&navigator.onLine){
        const item=sendQueue[0];
        try{
          const res=await jsonpRecordSend({...item,sheetId:item.sheetId||cfg.sheetId||''});
          // サーバーから明示的にOKが返った時だけ削除
          if(!res||!res.ok)throw new Error('ack');
          sendQueue.shift();
          save();
          render();
          await new Promise(r=>setTimeout(r,40));
        }catch(e){
          // キューを残したまま次回再送。原因を画面にも出して現場で切り分け可能にする。
          try{
            const s=document.getElementById('status');
            if(s) s.textContent=`送信エラー(${e&&e.message?e.message:'unknown'}) ⚠未送信${sendQueue.length}件`;
            const a=document.getElementById('v31FieldAlertSub');
            if(a) a.textContent=`GAS応答なし: ${e&&e.message?e.message:'unknown'} ／ 未送信 ${sendQueue.length}件`;
          }catch{}
          break;
        }
      }
    }finally{
      isSending=false;
      // 送信完了直後に新規受付が追加された競合を取りこぼさない。
      // キューが残っていれば短時間後に必ず次の送信処理を起動する。
      if(sendQueue.length&&navigator.onLine){
        setTimeout(()=>processQueue(),120);
      }
    }
  };

  // app.js 側から確実に安定化送信を呼べる専用入口。
  window.v31ProcessQueue=()=>processQueue();

  // 未送信が残っていれば3秒ごとに再送
  setInterval(()=>{
    if(sendQueue.length&&navigator.onLine)processQueue();
  },3000);

  // スマホ画面へ戻った時にも再送
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&sendQueue.length&&navigator.onLine)processQueue();
  });

  window.addEventListener('focus',()=>{
    if(sendQueue.length&&navigator.onLine)processQueue();
  });

  // この追加スクリプト読み込み時点で既存未送信も処理
  setTimeout(()=>processQueue(),200);
})();

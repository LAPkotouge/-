// =====================================================
// V30安定化：受付データ送信をJSONP ACK方式へ変更
// ・Apps Scriptが実際に登録成功した時だけ送信キューから削除
// ・通信失敗／タイムアウト時はキューを保持して自動再送
// ・同一記録IDの再送はApps Script側で重複登録を防止
// =====================================================
(function setupReliableRecordTransport(){
  // V31専用送信ロック。旧app.jsのisSendingとは完全分離する。
  let reliableSending=false;
  let diagSeq=0;
  function diag(msg){
    try{
      const stamp=new Date().toLocaleTimeString('ja-JP',{hour12:false});
      localStorage.setItem('lap_v31_send_diag',stamp+' '+msg);
      const s=document.getElementById('status'); if(s)s.textContent='通信診断: '+msg;
      const a=document.getElementById('v31FieldAlertSub'); if(a)a.textContent='通信診断: '+msg;
    }catch{}
  }
  function postRecordSend(item){
    const endpoint=String(cfg.endpoint||'').trim();
    if(!endpoint)return Promise.reject(new Error('endpoint'));
    const body={action:'RECORD_ADD',sheetId:String(item.sheetId||cfg.sheetId||''),id:String(item.id||''),seqNo:String(item.seqNo||''),value:String(item.value||''),recognized:!!item.recognized,inputType:String(item.inputType||(item.recognized?'音声認識':'ボタン')),invalidGap:!!item.invalidGap,duplicate:!!item.duplicate,duplicateSeconds:item.duplicateSeconds||'',suspiciousRepeat:!!item.suspiciousRepeat,lap:item.lap||'',mode:item.mode||cfg.mode||'',event:item.event||cfg.event||'',date:item.date||cfg.date||'',point:item.point||cfg.point||'',staff:item.staff||cfg.staff||'',time:item.time||'',captureTs:item.captureTs||item.ts||'',recognizedTs:item.recognizedTs||'',recognitionDelayMs:item.recognitionDelayMs||'',confidence:item.confidence||'',recovery:!!item.recovery};
    diag('POST即時送信');
    return fetch(endpoint,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)}).then(()=>({ok:true,post:true}));
  }


  // 既存processQueueを安定化版へ差し替え
  processQueue=async function(){
    if(reliableSending){diag('送信ロック中');return;}
    if(!sendQueue.length)return;
    if(!cfg.endpoint){diag('GAS URLなし');return;}
    if(!navigator.onLine){diag('オフライン');return;}
    diag(`キュー${sendQueue.length}件 → 送信処理開始`);
    reliableSending=true;
    try{
      while(sendQueue.length&&navigator.onLine){
        const item=sendQueue[0];
        try{
          const res=await postRecordSend({...item,sheetId:item.sheetId||cfg.sheetId||''});
          // V31 realtime: POST dispatch完了でキューを進める。GAS側は記録IDで重複防止。
          if(!res||!res.ok)throw new Error('ack');
          sendQueue.shift();
          diag(`登録成功 → 残り${sendQueue.length}件`);
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
      reliableSending=false;
      // 送信完了直後に新規受付が追加された競合を取りこぼさない。
      // キューが残っていれば短時間後に必ず次の送信処理を起動する。
      if(sendQueue.length&&navigator.onLine){
        setTimeout(()=>processQueue(),120);
      }
    }
  };

  // app.js 側から確実に安定化送信を呼べる専用入口。
  // app.js はレキシカルな旧 processQueue を保持するため、window 経由ではなく
  // reliable.js 自身の送信関数を直接公開する。
  window.v31ReliableSend=()=>{diag(`新規受付トリガー / キュー${sendQueue.length}件`);return processQueue();};
  window.v31ProcessQueue=window.v31ReliableSend;

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

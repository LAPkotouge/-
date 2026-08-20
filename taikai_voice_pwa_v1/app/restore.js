// =====================================================
// V30：送信安定化＋アプリ内データ再送信
// =====================================================

// アプリ内クリア：危険操作として黒×黄色の縞模様
(function setupDangerClearStyle(){
  const style=document.createElement('style');
  style.textContent=`
    .appClearBtn{
      border:2px solid #111 !important;
      color:#111 !important;
      font-weight:900 !important;
      text-shadow:0 1px 0 rgba(255,255,255,.8);
      background:repeating-linear-gradient(
        135deg,
        #f4d000 0,
        #f4d000 14px,
        #111 14px,
        #111 28px
      ) !important;
    }
  `;
  document.head.appendChild(style);
})();

// -----------------------------------------------------
// 通常送信キューを安定化
// ・5秒タイムアウトで途中停止しない
// ・未送信が残っていれば定期的に再試行
// ・同一レコードIDの重複防止はApps Script側で行う
// -----------------------------------------------------
processQueue = async function(){
  if(isSending || !sendQueue.length || !cfg.endpoint || !navigator.onLine) return;

  isSending = true;

  try{
    while(sendQueue.length && navigator.onLine){
      const item = sendQueue[0];
      const payload = {...item, sheetId:item.sheetId || cfg.sheetId || ""};

      try{
        await fetch(cfg.endpoint,{
          method:"POST",
          mode:"no-cors",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify(payload)
        });

        // 送信要求をブラウザが正常に受理したらキューから外す
        sendQueue.shift();
        save();
        render();

        // 連続送信時のApps Script負荷を少し緩和
        await new Promise(resolve=>setTimeout(resolve,120));
      }catch(err){
        // 通信失敗時は先頭データを残したまま次回再試行
        break;
      }
    }
  }finally{
    isSending = false;
  }
};

// 未送信データが残った場合は自動再試行
setInterval(()=>{
  if(navigator.onLine && sendQueue.length) processQueue();
},3000);

window.addEventListener('focus',()=>{
  if(navigator.onLine && sendQueue.length) processQueue();
});

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden && navigator.onLine && sendQueue.length) processQueue();
});


// =====================================================
// V30：アプリ内データを現在の地点シートへ再送信
// 誤って「シート全消去」した場合の復旧用
// =====================================================
(function setupV30Restore(){
  const clearActions=document.querySelector('.clearActions');
  if(!clearActions || document.getElementById('resendLocalRecordsV30')) return;

  const wrap=document.createElement('div');
  wrap.style.marginTop='8px';
  wrap.innerHTML=`
    <button type="button" id="resendLocalRecordsV30" class="testBtn" style="border-color:#176b36;color:#176b36;font-weight:900;">
      アプリ内データをシートへ再送信
    </button>
    <div id="resendLocalStatusV30" class="hint"></div>
    <p class="small" style="margin-top:5px;">
      誤って現在地点のシートを全消去した場合の復旧用です。Apps Script V30安定化版では同じ記録IDは二重登録しません。
    </p>`;
  clearActions.insertAdjacentElement('afterend',wrap);

  const btn=document.getElementById('resendLocalRecordsV30');
  const status=document.getElementById('resendLocalStatusV30');

  function currentFormValue(id,fallback=''){
    const el=document.getElementById(id);
    return String((el && el.value) || fallback || '').trim();
  }

  function matchingRecords(){
    const event=currentFormValue('sEvent',cfg.event);
    const date=currentFormValue('sDate',cfg.date);
    const point=currentFormValue('sPoint',cfg.point);

    return records
      .filter(r=>{
        if(r.cancelled || r.invalidGap) return false;
        if(String(r.event||'').trim()!==event) return false;
        if(String(r.date||'').trim()!==date) return false;
        if(String(r.point||'').trim()!==point) return false;
        return true;
      })
      .sort((a,b)=>(Number(a.seqNo)||0)-(Number(b.seqNo)||0) || (Number(a.ts)||0)-(Number(b.ts)||0));
  }

  async function resendLocalRecords(){
    const endpoint=currentFormValue('sEndpoint',cfg.endpoint);
    const sheetId=currentFormValue('sSheetId',cfg.sheetId);
    const point=currentFormValue('sPoint',cfg.point);
    const event=currentFormValue('sEvent',cfg.event);
    const date=currentFormValue('sDate',cfg.date);
    const items=matchingRecords();

    if(!endpoint){ alert('Google Apps Script URLを設定してください。'); return; }
    if(!sheetId){ alert('保存先スプレッドシートIDを設定してください。'); return; }
    if(!point || point==='地点未設定'){ alert('地点名を設定してください。'); return; }
    if(!navigator.onLine){ alert('オフラインのため再送信できません。'); return; }
    if(!items.length){
      status.textContent='再送信できるアプリ内データがありません。現在の大会・開催日・地点を確認してください。';
      return;
    }

    const ok1=confirm(
      `【復旧用 再送信】\n\n大会：${event}\n開催日：${date||'未設定'}\n地点：${point}\n対象：${items.length}件\n\nアプリ内データを現在の地点シートへ再送信します。\nApps Script V30安定化版では、同じ記録IDが既に存在する行は追加しません。\n\n実行しますか？`
    );
    if(!ok1) return;

    const ok2=confirm(
      `最終確認です。\n\nアプリ内の ${items.length}件 を「${point}」シートへ再送信します。\nよろしいですか？`
    );
    if(!ok2) return;

    btn.disabled=true;
    let sent=0;
    status.textContent=`再送信中… 0 / ${items.length}件`;

    try{
      for(const r of items){
        const payload={
          action:'ADD',
          id:r.id||'',
          seqNo:r.seqNo||'',
          value:r.value||'',
          recognized:!!r.recognized,
          duplicate:!!r.duplicate,
          lap:r.lap||'',
          mode:r.mode||cfg.mode||'',
          event:r.event||event,
          date:r.date||date,
          point:r.point||point,
          staff:r.staff||currentFormValue('sStaff',cfg.staff),
          time:r.time||'',
          sheetId:sheetId,
          recovery:true
        };

        await fetch(endpoint,{
          method:'POST',
          mode:'no-cors',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload)
        });

        sent++;
        status.textContent=`再送信中… ${sent} / ${items.length}件`;
        await new Promise(resolve=>setTimeout(resolve,120));
      }

      status.textContent=`✅ ${sent}件の再送信要求を完了しました。スプレッドシートの「${point}」シートで件数とNo.を確認してください。アプリ内データは削除していません。`;
    }catch(err){
      status.textContent=`⚠ ${sent}件まで送信しましたが途中で停止しました。通信状態を確認して、もう一度実行してください。同じ記録IDはApps Script側で重複登録を防止します。`;
    }finally{
      btn.disabled=false;
    }
  }

  btn.addEventListener('click',resendLocalRecords);
})();

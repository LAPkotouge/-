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
      誤って現在地点のシートを全消去した場合の復旧用です。シートが空であることを確認してから実行してください。
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
      `【復旧用 再送信】\n\n大会：${event}\n開催日：${date||'未設定'}\n地点：${point}\n対象：${items.length}件\n\n現在の地点シートが空であることを確認してください。\nシートにデータが残っている状態で実行すると重複登録になります。\n\n再送信しますか？`
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

        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),10000);
        await fetch(endpoint,{
          method:'POST',
          mode:'no-cors',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload),
          signal:controller.signal
        });
        clearTimeout(timer);
        sent++;
        status.textContent=`再送信中… ${sent} / ${items.length}件`;
        await new Promise(resolve=>setTimeout(resolve,80));
      }

      status.textContent=`✅ ${sent}件を再送信しました。スプレッドシートの「${point}」シートで件数とNo.を確認してください。アプリ内データは削除していません。`;
    }catch(err){
      status.textContent=`⚠ ${sent}件まで送信しましたが途中で停止しました。通信状態を確認してください。再実行すると重複する可能性があるため、先にシート内容を確認してください。`;
    }finally{
      btn.disabled=false;
    }
  }

  btn.addEventListener('click',resendLocalRecords);
})();

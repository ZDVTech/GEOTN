(() => {
  'use strict';
  const API = 'https://drill-monitor-storyboard.zdvtech.chatgpt.site/api/review';
  const byId = id => document.getElementById(id);
  const panel = document.createElement('section');
  panel.id='discussion';panel.className='review-panel';panel.tabIndex=-1;
  panel.innerHTML=`<div class="eyebrow">Заметки к сценарию</div><h2>Все замечания — на этой странице</h2>
    <p>Напишите замечание под нужным блоком и нажмите «Сохранить». Каждая запись добавляется в историю блока под новым номером. Сохранённые заметки видны всем, кто откроет эту ссылку.</p>
    <div class="review-tools"><button id="review-refresh" type="button">Обновить заметки</button><span id="review-total">Загрузка заметок…</span></div>
    <p id="review-status" role="status" aria-live="polite">Загружаем сохранённые заметки…</p>`;
  document.querySelector('.hero').after(panel);
  const go=document.createElement('button');go.type='button';go.textContent='Заметки';
  go.addEventListener('click',()=>{document.body.classList.remove('view-text');byId('voiceButton').textContent='Текст диктора';panel.scrollIntoView({behavior:'smooth',block:'start'});panel.focus({preventScroll:true});});
  document.querySelector('.actions').prepend(go);
  const comments=new Map(),pending=new Map(),items=[];
  let cursor=0,polling=false,loaded=false;
  function status(text,bad=false){byId('review-status').textContent=text;byId('review-status').classList.toggle('review-error',bad);}
  function render(){
    const sorted=[...comments.values()].sort((a,b)=>a.seq-b.seq);
    for(const item of items){
      const own=sorted.filter(c=>c.scene===item.id);
      item.title.textContent='Заметки · '+own.length;
      const signature=own.map(c=>c.id).join(',')+'|'+loaded;
      if(signature===item.signature)continue;
      item.signature=signature;item.list.replaceChildren();
      if(!own.length){const p=document.createElement('p');p.className='review-muted';p.textContent=loaded?'В этом блоке пока нет сохранённых заметок.':'Загрузка сохранённых заметок…';item.list.append(p);}
      for(const comment of own){
        const article=document.createElement('article');article.className='review-comment';article.dataset.noteNumber=comment.number;
        const meta=document.createElement('div');meta.className='review-comment-meta';
        const number=document.createElement('b');number.textContent='Заметка № '+comment.number;
        const date=document.createElement('time');date.dateTime=comment.createdAt;date.textContent=new Date(comment.createdAt).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
        const text=document.createElement('p');text.textContent=comment.message;
        meta.append(number,date);article.append(meta,text);item.list.append(article);
      }
    }
    byId('review-total').textContent='Сохранено заметок: '+comments.size;
  }
  function readableError(error){return error.name==='AbortError'?'Сервер не ответил вовремя. Повторите попытку.':error.message;}
  async function api(method,payload,after){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(API+(method==='GET'?'?after='+after:''),{method,headers:payload?{'Content-Type':'application/json'}:{},...(payload?{body:JSON.stringify(payload)}:{}),credentials:'omit',cache:'no-store',signal:controller.signal});
      let data;try{data=await response.json();}catch{throw new Error('Хранилище заметок временно недоступно.');}
      if(!response.ok){const errors={rate_limited:'Слишком много сохранений. Подождите минуту.',invalid_comment:'Введите текст до 4000 символов.',id_conflict:'Этот запрос уже сохранён с другим текстом. Измените текст и повторите.'};throw new Error(errors[data.error]||'Не удалось связаться с хранилищем заметок.');}
      return data;
    }finally{clearTimeout(timeout);}
  }
  async function sync(){
    if(polling)return;polling=true;
    try{
      let more;
      do{const data=await api('GET',null,cursor);for(const c of data.comments)comments.set(c.id,c);cursor=data.cursor;more=data.more;}while(more);
      loaded=true;render();status('Все заметки загружены. Обновлено в '+new Date().toLocaleTimeString('ru-RU')+'. Проверяем новые записи каждые 20 секунд.');
    }catch(error){status('Не удалось обновить заметки. '+readableError(error),true);}
    finally{polling=false;}
  }
  for(const textarea of document.querySelectorAll('.notes[data-note]')){
    const id=Number(textarea.dataset.note),detail=textarea.closest('details'),title=detail.querySelector('summary');
    detail.classList.add('review-thread');detail.open=true;
    textarea.maxLength=4000;textarea.placeholder='Напишите, что хотите изменить в этом блоке…';textarea.setAttribute('aria-label','Новая заметка к блоку '+id);
    const list=document.createElement('div');list.className='review-comments';list.setAttribute('aria-live','polite');
    const hint=document.createElement('p');hint.className='review-muted';hint.textContent='Каждое нажатие «Сохранить» добавляет новую заметку. Предыдущие записи остаются в истории.';
    const bar=document.createElement('div');bar.className='review-send-row';
    const save=document.createElement('button');save.type='button';save.textContent='Сохранить';
    const feedback=document.createElement('span');feedback.className='review-feedback';feedback.setAttribute('role','status');
    detail.insertBefore(list,textarea);detail.insertBefore(hint,textarea);bar.append(save,feedback);detail.append(bar);
    const item={id,detail,title,list,textarea,save,feedback,saving:false,signature:null};items.push(item);
    save.addEventListener('click',async()=>{
      if(item.saving)return;
      const message=textarea.value.trim();
      if(!message){feedback.textContent='Введите текст заметки.';textarea.focus();return;}
      if(message.length>4000){feedback.textContent='Максимум 4000 символов.';return;}
      let payload=pending.get(id);
      if(!payload||payload.message!==message){payload={id:crypto.randomUUID(),scene:id,message};pending.set(id,payload);}
      item.saving=true;save.disabled=true;save.textContent='Сохранение…';feedback.textContent='';
      try{
        const data=await api('POST',payload);pending.delete(id);comments.set(data.comment.id,data.comment);
        if(textarea.value.trim()===message){textarea.value='';textarea.dispatchEvent(new Event('input',{bubbles:true}));}
        feedback.textContent='Сохранено · заметка № '+data.comment.number;render();void sync();
      }catch(error){feedback.textContent='Не удалось подтвердить сохранение. '+readableError(error);}
      finally{item.saving=false;save.disabled=false;save.textContent='Сохранить';}
    });
  }
  byId('review-refresh').addEventListener('click',()=>void sync());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync();});window.addEventListener('online',()=>void sync());
  setInterval(()=>{if(!document.hidden)void sync();},20000);
  const old=byId('notesExport'),exp=old.cloneNode(true);old.replaceWith(exp);exp.textContent='Заметки ↓';
  exp.addEventListener('click',()=>{
    const value={exportedAt:new Date().toISOString(),notes:[...comments.values()].sort((a,b)=>a.seq-b.seq),localDrafts:items.filter(x=>x.textarea.value.trim()).map(x=>({scene:x.id,draft:x.textarea.value}))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='geotn-notes.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const foot=document.querySelector('.footer > div:last-child');if(foot)foot.textContent='Сохранённые заметки видны всем по этой ссылке. Каждая запись остаётся в истории своего блока под отдельным номером.';
  render();void sync();
})();

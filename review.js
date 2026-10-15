(() => {
  'use strict';
  const API = 'https://drill-monitor-storyboard.zdvtech.chatgpt.site/api/review';
  const panel = document.createElement('section');
  panel.id = 'discussion';
  panel.className = 'review-panel';
  panel.tabIndex = -1;
  panel.innerHTML = `<div class="eyebrow">Согласование сценария</div><h2>Общее обсуждение по сценам</h2>
    <p>Замечания и ответы видны всем участникам с общим кодом. У каждой сцены своя история сообщений.</p>
    <form id="review-login" class="review-login"><label>Ваше имя<input id="review-name" required maxlength="80" autocomplete="nickname" placeholder="Как к вам обращаться"></label>
    <label id="review-code-label">Код обсуждения<input id="review-code" type="password" required minlength="8" maxlength="128" autocomplete="off" placeholder="Код от автора сценария"></label>
    <button id="review-connect" class="primary" type="submit">Открыть обсуждение</button></form>
    <div id="review-tools" class="review-tools" hidden><button id="review-refresh" type="button">Обновить сообщения</button><button id="review-lock" type="button">Закрыть обсуждение</button><span id="review-total"></span></div>
    <p id="review-status" role="status" aria-live="polite">Просмотр сценария открыт. Для чтения и отправки замечаний введите имя и код.</p>`;
  document.querySelector('.hero').after(panel);
  const byId = id => document.getElementById(id);
  const nameInput = byId('review-name');
  const codeInput = byId('review-code');
  try { nameInput.value = localStorage.getItem('geo-review-author') || ''; } catch {}
  nameInput.addEventListener('input', () => {try {localStorage.setItem('geo-review-author', nameInput.value);} catch {}});
  const go = document.createElement('button');
  go.type = 'button';
  go.textContent = 'Обсуждение';
  go.addEventListener('click', () => { document.body.classList.remove('view-text'); byId('voiceButton').textContent = 'Текст диктора'; panel.scrollIntoView({behavior:'smooth',block:'start'}); panel.focus({preventScroll:true}); });
  document.querySelector('.actions').prepend(go);

  let code = '', cursor = 0, timer = null, polling = false, epoch = 0;
  const comments = new Map();
  const pending = new Map();
  const items = [];
  function status(text, bad = false) { const el=byId('review-status'); el.textContent=text; el.classList.toggle('review-error',bad); }
  function download(value, filename) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function render() {
    const sorted=[...comments.values()].sort((a,b)=>a.seq-b.seq);
    for (const item of items) {
      const own=sorted.filter(c=>c.scene===item.id);
      item.list.replaceChildren();
      item.title.textContent='Обсуждение сцены'+(code?' · '+own.length:'');
      if (!code) {
        const p=document.createElement('p');p.className='review-muted';p.textContent='Введите общий код в блоке «Обсуждение», чтобы видеть замечания и ответы.';item.list.append(p);
      } else if (!own.length) {
        const p=document.createElement('p');p.className='review-muted';p.textContent='К этой сцене пока нет замечаний.';item.list.append(p);
      }
      for (const comment of own) {
        const article=document.createElement('article');article.className='review-comment';
        const meta=document.createElement('div');meta.className='review-comment-meta';
        const author=document.createElement('b');author.textContent=comment.author;
        const date=document.createElement('time');date.dateTime=comment.createdAt;date.textContent=new Date(comment.createdAt).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
        const text=document.createElement('p');text.textContent=comment.message;
        meta.append(author,date);article.append(meta,text);item.list.append(article);
      }
      item.send.disabled=!code || !!item.sending;
    }
    byId('review-total').textContent='Всего сообщений: '+comments.size;
  }
  function lock() {
    code='';cursor=0;epoch++;comments.clear();clearInterval(timer);timer=null;
    byId('review-code-label').hidden=false;codeInput.required=true;codeInput.value='';
    byId('review-connect').hidden=false;byId('review-tools').hidden=true;
    status('Обсуждение закрыто. Для доступа снова введите общий код.');render();
  }
  async function api(method, payload, after, accessCode=code) {
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(API+(method==='GET'?'?after='+after:''),{method,headers:{'X-Review-Code':accessCode,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),cache:'no-store',credentials:'omit',signal:controller.signal});
      let data;try{data=await response.json();}catch{throw new Error('Сервис обсуждения временно недоступен. Попробуйте ещё раз.');}
      if(!response.ok){
        const errors={invalid_code:'Код не подходит. Проверьте его и попробуйте ещё раз.',rate_limited:'Слишком много отправок. Подождите минуту.',invalid_comment:'Укажите имя и текст сообщения до 4000 символов.',id_conflict:'Этот запрос уже отправлен с другим текстом. Измените сообщение и повторите.'};
        const error=new Error(errors[data.error]||'Не удалось связаться с хранилищем. Попробуйте ещё раз.');error.auth=response.status===401;throw error;
      }
      return data;
    } finally {clearTimeout(timeout);}
  }
  function readableError(error) {return error.name==='AbortError'?'Сервер не ответил вовремя. Проверьте соединение и повторите.':error.message;}
  async function sync(manual=false) {
    if(!code || polling)return;
    polling=true;const current=epoch;const activeCode=code;
    try {
      let more;
      do {
        const data=await api('GET',null,cursor,activeCode);
        if(current!==epoch)return;
        for(const comment of data.comments)comments.set(comment.id,comment);
        cursor=data.cursor;more=data.more;
      }while(more);
      render();
      status('Обсуждение подключено. Обновлено в '+new Date().toLocaleTimeString('ru-RU')+'. Новые сообщения проверяются каждые 20 секунд.');
    }catch(error){if(current!==epoch)return;if(error.auth){lock();status(readableError(error),true);}else status('Не удалось обновить сообщения. Уже отправленные комментарии сохранены. '+readableError(error),true);}
    finally {polling=false;}
  }
  for(const textarea of document.querySelectorAll('.notes[data-note]')) {
    const id=Number(textarea.dataset.note), detail=textarea.closest('details'), title=detail.querySelector('summary');
    detail.classList.add('review-thread');
    textarea.maxLength=4000;
    textarea.placeholder='Замечание или ответ по этой сцене…';
    textarea.setAttribute('aria-label','Новое сообщение к сцене '+id);
    const list=document.createElement('div');list.className='review-comments';list.setAttribute('aria-live','polite');
    const hint=document.createElement('p');hint.className='review-muted';hint.textContent='Черновик хранится в этом браузере. Чтобы его увидели другие участники, нажмите «Отправить».';
    const bar=document.createElement('div');bar.className='review-send-row';
    const send=document.createElement('button');send.type='button';send.textContent='Отправить';send.disabled=true;
    const feedback=document.createElement('span');feedback.className='review-feedback';feedback.setAttribute('role','status');
    detail.insertBefore(list,textarea);detail.insertBefore(hint,textarea);bar.append(send,feedback);detail.append(bar);
    const item={id,detail,title,list,textarea,send,feedback,sending:false};items.push(item);
    send.addEventListener('click',async()=>{
      if(!code || item.sending)return;
      const author=nameInput.value.trim(), message=textarea.value.trim();
      if(!author){status('Укажите своё имя в блоке обсуждения.',true);panel.scrollIntoView({behavior:'smooth'});nameInput.focus({preventScroll:true});return;}
      if(!message){feedback.textContent='Введите сообщение.';textarea.focus();return;}
      if(message.length>4000){feedback.textContent='Максимум 4000 символов.';return;}
      let payload=pending.get(id);
      if(!payload || payload.author!==author || payload.message!==message){payload={id:crypto.randomUUID(),scene:id,author,message};pending.set(id,payload);}
      item.sending=true;send.disabled=true;feedback.textContent='Отправка…';
      const current=epoch;const activeCode=code;
      try {
        const data=await api('POST',payload,undefined,activeCode);
        pending.delete(id);
        if(current!==epoch)return;
        comments.set(data.comment.id,data.comment);
        // Do not clear text the participant changed while the request was pending.
        if(textarea.value.trim()===message){textarea.value='';textarea.dispatchEvent(new Event('input',{bubbles:true}));}
        feedback.textContent='Сохранено для всех участников.';render();
        void sync();
      }catch(error){if(current!==epoch)return;feedback.textContent='Не отправлено. '+readableError(error);if(error.auth){lock();status(readableError(error),true);}}
      finally {item.sending=false;send.disabled=!code;}
    });
  }
  byId('review-login').addEventListener('submit',async event=>{
    event.preventDefault();if(code)return;
    const nextCode=codeInput.value.trim();if(!nextCode || !nameInput.value.trim())return;
    const button=byId('review-connect');button.disabled=true;status('Подключение к обсуждению…');
    const current=++epoch;
    try {
      const data=await api('GET',null,0,nextCode);if(current!==epoch)return;
      code=nextCode;cursor=data.cursor;comments.clear();for(const comment of data.comments)comments.set(comment.id,comment);
      codeInput.value='';codeInput.required=false;byId('review-code-label').hidden=true;button.hidden=true;byId('review-tools').hidden=false;
      render();for(const item of items)if(comments.size && [...comments.values()].some(c=>c.scene===item.id))item.detail.open=true;
      status('Обсуждение подключено. Можно отправлять замечания и ответы под сценами.');
      clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)void sync();},20000);
      if(data.more)void sync();
    }catch(error){if(current===epoch)status(readableError(error),true);}
    finally {button.disabled=false;}
  });
  byId('review-refresh').addEventListener('click',()=>void sync(true));
  byId('review-lock').addEventListener('click',lock);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync();});
  window.addEventListener('online',()=>void sync());
  const old=byId('notesExport'), exp=old.cloneNode(true);old.replaceWith(exp);exp.textContent='Комментарии ↓';
  exp.addEventListener('click',()=>download({exportedAt:new Date().toISOString(),comments:[...comments.values()].sort((a,b)=>a.seq-b.seq),localDrafts:items.filter(x=>x.textarea.value.trim()).map(x=>({scene:x.id,draft:x.textarea.value}))},'geotn-discussion.json'));
  const foot=document.querySelector('.footer > div:last-child');if(foot)foot.textContent='Отправленные комментарии сохраняются в общем обсуждении. Доступ — по коду. Черновики остаются только в этом браузере.';
  render();
})();

(() => {
  'use strict';
  const API = 'https://drill-monitor-storyboard.zdvtech.chatgpt.site/api/review';
  const VOICE_PREFIX = '🎙️ [ПРАВКА ДИКТОРА]: ';
  const byId = id => document.getElementById(id);

  const panel = document.createElement('section');
  panel.id = 'discussion';
  panel.className = 'review-panel';
  panel.tabIndex = -1;
  panel.innerHTML = `<div class="eyebrow">Совместная работа · Заметки и правки текста диктора</div><h2>Все комментарии и правки Михаила — на этой странице</h2>
    <p>В каждой сцене можно <b>напрямую отредактировать текст диктора</b> (кнопка «Сохранить текст диктора») или <b>оставить заметку к кадру</b> (кнопка «Сохранить заметку»). Все сохранения сразу записываются на сервер и видны всем по этой ссылке.</p>
    <div class="review-tools"><button id="review-refresh" type="button">Обновить данные с сервера</button><span id="review-total">Загрузка истории…</span></div>
    <p id="review-status" role="status" aria-live="polite">Загружаем сохранённые заметки и правки диктора…</p>`;
  document.querySelector('.hero').after(panel);

  const go = document.createElement('button');
  go.type = 'button';
  go.textContent = 'Заметки и правки';
  go.addEventListener('click', () => {
    document.body.classList.remove('view-text');
    byId('voiceButton').textContent = 'Текст диктора';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.focus({ preventScroll: true });
  });
  document.querySelector('.actions').prepend(go);

  const comments = new Map(), pending = new Map(), items = [], voiceItems = new Map();
  let cursor = 0, polling = false, loaded = false;

  function status(text, bad = false) {
    byId('review-status').textContent = text;
    byId('review-status').classList.toggle('review-error', bad);
  }

  function readableError(error) {
    return error.name === 'AbortError' ? 'Сервер не ответил вовремя. Повторите попытку.' : error.message;
  }

  async function api(method, payload, after) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(API + (method === 'GET' ? '?after=' + after : ''), {
        method,
        headers: payload ? { 'Content-Type': 'application/json' } : {},
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal
      });
      let data;
      try { data = await response.json(); } catch { throw new Error('Хранилище заметок временно недоступно.'); }
      if (!response.ok) {
        const errors = {
          rate_limited: 'Слишком много сохранений. Подождите минуту.',
          invalid_comment: 'Введите текст до 4000 символов.',
          id_conflict: 'Этот запрос уже сохранён с другим текстом. Измените текст и повторите.'
        };
        throw new Error(errors[data.error] || 'Не удалось связаться с хранилищем заметок.');
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  function render() {
    const sorted = [...comments.values()].sort((a, b) => a.seq - b.seq);

    // Применяем последние сохранённые на сервере правки дикторского текста
    for (const [sceneId, vItem] of voiceItems.entries()) {
      const voiceEdits = sorted.filter(c => c.scene === sceneId && typeof c.message === 'string' && c.message.startsWith(VOICE_PREFIX));
      if (voiceEdits.length > 0) {
        const latest = voiceEdits[voiceEdits.length - 1];
        const cleanVoice = latest.message.slice(VOICE_PREFIX.length).trim();
        if (!vItem.dirty && cleanVoice && vItem.textarea.value !== cleanVoice) {
          vItem.textarea.value = cleanVoice;
          if (typeof window.updateSceneVoiceFromServer === 'function') {
            window.updateSceneVoiceFromServer(sceneId, cleanVoice);
          }
        }
        vItem.status.textContent = 'На сервере сохранена правка № ' + latest.number + ' от ' + new Date(latest.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
      }
    }

    for (const item of items) {
      const own = sorted.filter(c => c.scene === item.id);
      item.title.textContent = 'Заметки и история правок · ' + own.length;
      const signature = own.map(c => c.id).join(',') + '|' + loaded;
      if (signature === item.signature) continue;
      item.signature = signature;
      item.list.replaceChildren();
      if (!own.length) {
        const p = document.createElement('p');
        p.className = 'review-muted';
        p.textContent = loaded ? 'В этой сцене пока нет сохранённых заметок.' : 'Загрузка сохранённых заметок…';
        item.list.append(p);
      }
      for (const comment of own) {
        const article = document.createElement('article');
        article.className = 'review-comment';
        article.dataset.noteNumber = comment.number;
        const meta = document.createElement('div');
        meta.className = 'review-comment-meta';
        const isVoice = typeof comment.message === 'string' && comment.message.startsWith(VOICE_PREFIX);
        const number = document.createElement('b');
        number.textContent = (isVoice ? '🎙️ Правка диктора · запись № ' : '💬 Заметка № ') + comment.number;
        const date = document.createElement('time');
        date.dateTime = comment.createdAt;
        date.textContent = new Date(comment.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
        const text = document.createElement('p');
        text.textContent = isVoice ? comment.message.slice(VOICE_PREFIX.length) : comment.message;
        meta.append(number, date);
        article.append(meta, text);
        item.list.append(article);
      }
    }
    byId('review-total').textContent = 'Всего записей на сервере: ' + comments.size;
  }

  async function sync() {
    if (polling) return;
    polling = true;
    try {
      let more;
      do {
        const data = await api('GET', null, cursor);
        for (const c of data.comments) comments.set(c.id, c);
        cursor = data.cursor;
        more = data.more;
      } while (more);
      loaded = true;
      render();
      status('Все заметки и правки диктора синхронизированы (' + new Date().toLocaleTimeString('ru-RU') + '). Автообновление каждые 20 сек.');
    } catch (error) {
      status('Работаем с локальным сохранением в браузере. (' + readableError(error) + ')', true);
    } finally {
      polling = false;
    }
  }

  // Подключаем редактирование текста диктора
  for (const textarea of document.querySelectorAll('.voice-edit[data-voice]')) {
    const id = Number(textarea.dataset.voice);
    const wrap = textarea.closest('.voice-editor-wrap');
    const saveBtn = wrap.querySelector('.voice-save-btn');
    const statusEl = wrap.querySelector('.voice-save-status');
    function setVoiceStatus(msg) {
      statusEl.textContent = msg;
      const ftStatus = byId('ft-voice-status-' + id);
      if (ftStatus) ftStatus.textContent = msg;
    }

    const vItem = { id, textarea, saveBtn, status: { set textContent(v) { setVoiceStatus(v); }, get textContent() { return statusEl.textContent; } }, saving: false, dirty: false };
    voiceItems.set(id, vItem);

    textarea.addEventListener('input', () => {
      vItem.dirty = true;
      setVoiceStatus('Есть несохранённые изменения (сохранено черновиком в браузере)');
    });

    saveBtn.addEventListener('click', async () => {
      if (vItem.saving) return;
      const text = textarea.value.trim();
      if (!text) {
        setVoiceStatus('Текст диктора не может быть пустым.');
        textarea.focus();
        return;
      }
      const message = VOICE_PREFIX + text;
      const payload = { id: crypto.randomUUID(), scene: id, message };
      vItem.saving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение…';
      const ftSaveBtn = document.querySelector('[data-fulltext-save="' + id + '"]');
      if (ftSaveBtn) { ftSaveBtn.disabled = true; ftSaveBtn.textContent = 'Сохранение…'; }
      try {
        const data = await api('POST', payload);
        vItem.dirty = false;
        comments.set(data.comment.id, data.comment);
        setVoiceStatus('✓ Правка диктора сохранена на сервере (№ ' + data.comment.number + ')');
        render();
        void sync();
      } catch (error) {
        setVoiceStatus('Сохранено в браузере. Ошибка сервера: ' + readableError(error));
      } finally {
        vItem.saving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Сохранить текст диктора';
        if (ftSaveBtn) { ftSaveBtn.disabled = false; ftSaveBtn.textContent = 'Сохранить текст диктора'; }
      }
    });
  }

  // Подключаем заметки к сценам
  for (const textarea of document.querySelectorAll('.notes[data-note]')) {
    const id = Number(textarea.dataset.note), detail = textarea.closest('details'), title = detail.querySelector('summary');
    detail.classList.add('review-thread');
    detail.open = true;
    textarea.maxLength = 4000;
    textarea.placeholder = 'Напишите замечание или комментарий к этой сцене…';
    textarea.setAttribute('aria-label', 'Новая заметка к сцене ' + id);
    const list = document.createElement('div');
    list.className = 'review-comments';
    list.setAttribute('aria-live', 'polite');
    const hint = document.createElement('p');
    hint.className = 'review-muted';
    hint.textContent = 'Нажмите «Сохранить заметку», чтобы отправить комментарий в общую историю сцены.';
    const bar = document.createElement('div');
    bar.className = 'review-send-row';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Сохранить заметку';
    const feedback = document.createElement('span');
    feedback.className = 'review-feedback';
    feedback.setAttribute('role', 'status');
    detail.insertBefore(list, textarea);
    detail.insertBefore(hint, textarea);
    bar.append(save, feedback);
    detail.append(bar);
    const item = { id, detail, title, list, textarea, save, feedback, saving: false, signature: null };
    items.push(item);

    save.addEventListener('click', async () => {
      if (item.saving) return;
      const message = textarea.value.trim();
      if (!message) {
        feedback.textContent = 'Введите текст заметки.';
        textarea.focus();
        return;
      }
      if (message.length > 4000) {
        feedback.textContent = 'Максимум 4000 символов.';
        return;
      }
      let payload = pending.get(id);
      if (!payload || payload.message !== message) {
        payload = { id: crypto.randomUUID(), scene: id, message };
        pending.set(id, payload);
      }
      item.saving = true;
      save.disabled = true;
      save.textContent = 'Сохранение…';
      feedback.textContent = '';
      try {
        const data = await api('POST', payload);
        pending.delete(id);
        comments.set(data.comment.id, data.comment);
        if (textarea.value.trim() === message) {
          textarea.value = '';
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        feedback.textContent = '✓ Сохранено · заметка № ' + data.comment.number;
        render();
        void sync();
      } catch (error) {
        feedback.textContent = 'Сохранено локально. ' + readableError(error);
      } finally {
        item.saving = false;
        save.disabled = false;
        save.textContent = 'Сохранить заметку';
      }
    });
  }

  byId('review-refresh').addEventListener('click', () => void sync());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync(); });
  window.addEventListener('online', () => void sync());
  setInterval(() => { if (!document.hidden) void sync(); }, 20000);

  const old = byId('notesExport'), exp = old.cloneNode(true);
  old.replaceWith(exp);
  exp.textContent = 'Выгрузить текст и заметки ↓';
  exp.addEventListener('click', () => {
    const currentVoices = [...voiceItems.entries()].map(([scene, v]) => ({
      scene,
      voice: v.textarea.value
    }));
    const value = {
      exportedAt: new Date().toISOString(),
      scheduleTotalDays: 14,
      voiceScript: currentVoices,
      notesAndHistory: [...comments.values()].sort((a, b) => a.seq - b.seq),
      unsentDrafts: items.filter(x => x.textarea.value.trim()).map(x => ({ scene: x.id, draft: x.textarea.value }))
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'geotn-plan-notes-voice.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  render();
  void sync();
})();

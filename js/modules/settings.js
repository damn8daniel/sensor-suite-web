/* Модуль «Настройки» — ключи интеграций, AI-ассистент, оформление, о приложении.
   Всё хранится локально (localStorage через ctx.store). Ничего не уходит на сервер. */
SensorApp.register({
  id: 'settings', title: 'Настройки', dept: 'Система', order: 90,
  icon: '⚙️', description: 'Интеграции, ключи доступа, AI-ассистент и оформление · всё хранится только в браузере',
  mount(root, ctx){
    const ui = ctx.ui, esc = ui.escape;
    const VERSION = '1.0.0';

    // тип <input> для поля интеграции
    function inputType(t){
      if (t === 'password') return 'password';
      if (t === 'number') return 'number';
      if (t === 'url') return 'url';
      return 'text';
    }

    // -------- карточки интеграций --------
    const defs = ctx.integrationDefs || [];
    const intCards = defs.length ? defs.map(def => {
      const creds = ctx.store.creds(def.id) || {};
      const fields = (def.fields || []).map(f => {
        const v = creds[f.key] != null ? creds[f.key] : '';
        return ui.field(f.label || f.key,
          `<input data-int="${esc(def.id)}" data-key="${esc(f.key)}" type="${inputType(f.type)}"
                  value="${esc(v)}" placeholder="${esc(f.placeholder || f.label || f.key)}"
                  autocomplete="off" spellcheck="false">`);
      }).join('');

      const webHint = (def.webCapable === false)
        ? `<span class="badge warn" title="Прямой вызов из браузера блокирует CORS">desktop-only</span>`
        : `<span class="badge ok">работает в браузере</span>`;

      const body =
        `<div class="btn-row" style="margin-bottom:10px">
           ${webHint}
           <span class="badge" data-state="${esc(def.id)}">${ctx.store.hasCreds(def.id) ? 'ключи заданы' : 'нет ключей'}</span>
         </div>` +
        (fields || ui.empty('🔌','У этой интеграции нет настраиваемых полей.')) +
        (def.webCapable === false
          ? `<p class="hint" style="margin:2px 0 12px">Из-за ограничений CORS прямой вызов работает только в desktop-версии. В браузере модули используют демо-данные или импорт файла.</p>`
          : '') +
        `<div class="btn-row" style="margin-top:8px">
           <button class="btn primary sm" data-save="${esc(def.id)}">Сохранить</button>
           <button class="btn sm" data-test="${esc(def.id)}">Проверить</button>
           <span class="result" data-result="${esc(def.id)}"></span>
         </div>`;

      return ui.card(def.title || def.id, def.description || '', body);
    }).join('') : ui.empty('🔌','Интеграции не зарегистрированы.');

    // -------- AI-ассистент --------
    const llm = ctx.store.creds('llm') || {};
    const llmCard = ui.card('AI-ассистент',
      'Подключение LLM для подсказок, разбора возражений и черновиков. Совместимо с OpenAI-форматом (/v1/chat/completions).',
      ui.field('Endpoint',
        `<input id="llm-endpoint" type="url" placeholder="https://api.openai.com/v1" value="${esc(llm.endpoint||'')}" autocomplete="off" spellcheck="false">`) +
      ui.field('API-ключ',
        `<input id="llm-key" type="password" placeholder="sk-..." value="${esc(llm.apiKey||'')}" autocomplete="off" spellcheck="false">`) +
      ui.field('Модель',
        `<input id="llm-model" type="text" placeholder="gpt-4o-mini" value="${esc(llm.model||'')}" autocomplete="off" spellcheck="false">`) +
      `<div class="btn-row" style="margin-top:8px">
         <button class="btn primary sm" id="llm-save">Сохранить</button>
         <span class="badge" id="llm-state">${ctx.store.hasCreds('llm') ? 'настроено' : 'не настроено'}</span>
       </div>`);

    // -------- оформление --------
    const theme = ctx.store.get('theme','light');
    const themeCard = ui.card('Оформление',
      'Светлая или тёмная тема интерфейса.',
      `<div class="pill-tabs" id="theme-tabs">
         <span class="pill ${theme==='light'?'active':''}" data-theme="light">☀︎ Светлая</span>
         <span class="pill ${theme==='dark'?'active':''}" data-theme="dark">☾ Тёмная</span>
       </div>`);

    // -------- о приложении --------
    const aboutCard = ui.card('О приложении',
      'Сенсор Suite — тестовый стенд внутренних инструментов учебного центра.',
      `<table class="tbl">
         <tbody>
           <tr><td>Версия</td><td class="mono">${esc(VERSION)}</td></tr>
           <tr><td>Режим</td><td><span class="badge">${esc(ctx.env)}</span> ${ctx.env==='desktop'?'(прямые запросы без CORS, доступ к ФС)':'(браузер, ограничения CORS)'}</td></tr>
           <tr><td>Интеграций</td><td>${defs.length}</td></tr>
           <tr><td>Хранение</td><td>localStorage (только этот браузер)</td></tr>
         </tbody>
       </table>
       <p class="hint" style="margin-top:12px">
         <strong>Local-only.</strong> Все ключи и настройки хранятся локально в этом браузере и не передаются на сторонние серверы.
         Никакие персональные данные обучающихся в приложении не сохраняются. Очистка данных сайта удалит все настройки.
       </p>`);

    root.innerHTML =
      ui.card('Интеграции',
        'Ключи доступа к внешним сервисам. Без ключей соответствующие модули работают на демо-данных.',
        '') + intCards + llmCard + themeCard + aboutCard;

    // ===== обработчики интеграций =====
    function collect(id){
      const obj = {};
      root.querySelectorAll(`[data-int="${CSS.escape(id)}"]`).forEach(inp=>{ obj[inp.dataset.key] = inp.value.trim(); });
      return obj;
    }

    root.querySelectorAll('[data-save]').forEach(btn=>{
      btn.onclick = ()=>{
        const id = btn.dataset.save;
        ctx.store.setCreds(id, collect(id));
        const st = root.querySelector(`[data-state="${CSS.escape(id)}"]`);
        if (st) st.textContent = ctx.store.hasCreds(id) ? 'ключи заданы' : 'нет ключей';
        ctx.toast('Ключи сохранены ✓','ok');
      };
    });

    root.querySelectorAll('[data-test]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.dataset.test;
        // сохранить введённое перед проверкой
        ctx.store.setCreds(id, collect(id));
        const st = root.querySelector(`[data-state="${CSS.escape(id)}"]`);
        if (st) st.textContent = ctx.store.hasCreds(id) ? 'ключи заданы' : 'нет ключей';
        const out = root.querySelector(`[data-result="${CSS.escape(id)}"]`);
        if (out) out.innerHTML = ui.spinner + ' проверка…';
        btn.disabled = true;
        let res;
        try { res = await ctx.integrations[id].test(); }
        catch(e){ res = { ok:false, detail:String(e&&e.message||e) }; }
        btn.disabled = false;
        if (out) out.innerHTML = res && res.ok
          ? `<span class="badge ok">✓ соединение есть</span> ${res.detail?`<span class="hint">${esc(res.detail)}</span>`:''}`
          : `<span class="badge err">✕ ошибка</span> <span class="hint">${esc((res&&res.detail)||'нет соединения')}</span>`;
      };
    });

    // ===== AI-ассистент =====
    const llmSave = root.querySelector('#llm-save');
    if (llmSave) llmSave.onclick = ()=>{
      ctx.store.setCreds('llm', {
        endpoint: root.querySelector('#llm-endpoint').value.trim(),
        apiKey:   root.querySelector('#llm-key').value.trim(),
        model:    root.querySelector('#llm-model').value.trim()
      });
      const stt = root.querySelector('#llm-state');
      if (stt) stt.textContent = ctx.store.hasCreds('llm') ? 'настроено' : 'не настроено';
      ctx.toast('AI-ассистент сохранён ✓','ok');
    };

    // ===== тема =====
    root.querySelectorAll('#theme-tabs .pill').forEach(p=>{
      p.onclick = ()=>{
        const t = p.dataset.theme;
        ctx.store.set('theme', t);
        document.documentElement.setAttribute('data-theme', t);
        root.querySelectorAll('#theme-tabs .pill').forEach(x=>x.classList.toggle('active', x===p));
        ctx.toast('Тема: '+(t==='dark'?'тёмная':'светлая'),'info');
      };
    });
  }
});

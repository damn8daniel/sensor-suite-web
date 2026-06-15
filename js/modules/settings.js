/* Модуль «Настройки» — креды интеграций, AI-ассистент, оформление, данные, о приложении.
   Всё хранится локально (localStorage через ctx.store). Ничего не уходит на сервер.
   Контракт сохранён: id:'settings', dept:'Система', store API (get/set/creds/setCreds/
   hasCreds/all), тема через data-theme, ctx.integrations[id].test() для проверки. */
SensorApp.register({
  id: 'settings', title: 'Настройки', dept: 'Система', order: 90,
  icon: '⚙️',
  description: 'Интеграции, ключи доступа, AI-ассистент, оформление и данные · всё хранится только в браузере',
  keywords: ['настройки','ключи','токены','креды','интеграции','тема','тёмная','светлая','llm','ai','экспорт','импорт','бэкап','о приложении','версия'],

  mount(root, ctx){
    const ui  = ctx.ui, esc = ui.escape, store = ctx.store;
    const self = this;
    // полностью перемонтировать модуль с актуальными данными store
    function remount(){ root.innerHTML = ''; self.mount(root, ctx); }
    const VERSION = '1.0.0';
    const BUILT   = '2026-06';

    /* журнал проверок соединения: { [intId|'llm']: {ok:bool, detail:str, ts:ISO} }
       хранится локально, переживает перемонтирование — даёт «здоровье» интеграций
       с одного взгляда (когда последний раз проверяли и чем закончилось). */
    function healthAll(){ const h = store.get('settings_health', null); return (h && typeof h === 'object') ? h : {}; }
    function healthGet(id){ return healthAll()[id] || null; }
    function healthSet(id, ok, detail){
      const h = healthAll();
      h[id] = { ok: !!ok, detail: String(detail || ''), ts: new Date().toISOString() };
      store.set('settings_health', h);
    }
    function healthClear(id){ const h = healthAll(); if (h[id]){ delete h[id]; store.set('settings_health', h); } }

    // «3 мин назад» / «вчера» — компактное относительное время для отметки проверки
    function ago(iso){
      const t = Date.parse(iso); if (!isFinite(t)) return '';
      const s = Math.max(0, (Date.now() - t) / 1000);
      if (s < 45)    return 'только что';
      if (s < 90)    return 'минуту назад';
      if (s < 3600)  return Math.round(s / 60) + ' мин назад';
      if (s < 5400)  return 'час назад';
      if (s < 86400) return Math.round(s / 3600) + ' ч назад';
      if (s < 172800)return 'вчера';
      return Math.round(s / 86400) + ' дн назад';
    }
    // строка-отметка последней проверки под мета-рядом интеграции
    function healthLineHTML(id){
      const h = healthGet(id);
      if (!h) return '';
      const dot = h.ok ? '<span class="hc-dot hc-ok" aria-hidden="true"></span>' : '<span class="hc-dot hc-err" aria-hidden="true"></span>';
      const word = h.ok ? 'соединение есть' : 'ошибка';
      return `<p class="health-line" data-health="${esc(id)}">${dot}<span>Проверено ${esc(ago(h.ts))} · ${esc(word)}</span></p>`;
    }

    /* ─────────────────────────── справочники ─────────────────────────── */

    // тип <input> по типу поля интеграции
    function inputType(t){
      if (t === 'password') return 'password';
      if (t === 'number')   return 'number';
      if (t === 'url')      return 'url';
      return 'text';
    }

    // человекочитаемая подсказка по интеграции (у defs нет .description — синтезируем)
    const INT_HINTS = {
      dadata:        'Пробив контрагентов по ИНН / ОГРН / названию. Токен из личного кабинета DaData.',
      google_sheets: 'Чтение диапазонов таблиц через Sheets API v4. Нужен API-ключ и ID таблицы (из URL).',
      amocrm:        'Сделки, воронки и контакты по API v4. Долгоживущий access-токен из интеграции amoCRM.',
      spark:         'Должная осмотрительность по контрагентам (СПАРК-Интерфакс). Корпоративный доступ: логин и ключ.'
    };
    const INT_DOCS = {
      dadata:        { label: 'dadata.ru → API', url: 'https://dadata.ru/api/' },
      google_sheets: { label: 'Google Cloud → API key', url: 'https://console.cloud.google.com/apis/credentials' },
      amocrm:        { label: 'amoCRM → Интеграции', url: 'https://www.amocrm.ru/developers/content/oauth/step-by-step' },
      spark:         { label: 'spark-interfax.ru', url: 'https://spark-interfax.ru/' }
    };
    // где взять токен для подсказки под полем
    const FIELD_HINTS = {
      'dadata.token':              'Личный кабинет DaData → API → «Токен для доступа к API».',
      'google_sheets.api_key':     'Google Cloud Console → Credentials → API key (включите Google Sheets API).',
      'google_sheets.spreadsheet_id': 'Часть URL таблицы между /d/ и /edit.',
      'amocrm.subdomain':          'Поддомен из адреса аккаунта: <subdomain>.amocrm.ru.',
      'amocrm.access_token':       'Долгоживущий токен из карточки интеграции в amoCRM.',
      'spark.login':               'Выдаёт менеджер Интерфакса при подключении корпоративного доступа.',
      'spark.key':                 'Ключ API из договора СПАРК (требуется белый список IP).'
    };

    const fieldHint = (intId, key) => FIELD_HINTS[intId + '.' + key] || '';

    /* ─────────────────── статус-вычислитель интеграций ───────────────────
       configured: есть ли ключи; web-blocked: web-only ограничение. */
    function intStatus(def){
      const has         = store.hasCreds(def.id);
      const blockedWeb  = (def.webCapable === false && ctx.env === 'web');
      if (!has)        return { badge: ui.badge('нет ключей', ''),       state: 'нет ключей',  demo: true };
      if (blockedWeb)  return { badge: ui.badge('демо (web)', 'warn'),   state: 'демо (web)',  demo: true };
      return { badge: ui.badge('ключи заданы', 'ok'), state: 'ключи заданы', demo: false };
    }

    const defs = ctx.integrationDefs || [];

    /* ───────────────────────── карточка интеграции ───────────────────────── */
    function intCardHTML(def){
      const creds = store.creds(def.id) || {};
      const st = intStatus(def);

      const fields = (def.fields || []).map(f => {
        const v   = creds[f.key] != null ? creds[f.key] : '';
        const isPw = inputType(f.type) === 'password';
        const hint = fieldHint(def.id, f.key);
        const inputHTML =
          `<div class="kv-input${isPw ? ' has-reveal' : ''}">
             <input data-int="${esc(def.id)}" data-key="${esc(f.key)}" type="${inputType(f.type)}"
                    value="${esc(v)}" placeholder="${esc(f.placeholder || f.label || f.key)}"
                    autocomplete="off" autocapitalize="off" spellcheck="false" data-1p-ignore>
             ${isPw ? `<button type="button" class="reveal" data-reveal aria-label="Показать значение" title="Показать / скрыть">👁</button>` : ''}
           </div>` +
          (hint ? `<p class="field-help">${esc(hint)}</p>` : '');
        return ui.field(f.label || f.key, inputHTML);
      }).join('');

      const webHint = (def.webCapable === false)
        ? ui.badge('desktop-only', 'warn')
        : ui.badge('работает в браузере', 'info');

      const doc = INT_DOCS[def.id];
      const docLink = doc ? `<a class="doc-link" href="${esc(doc.url)}" target="_blank" rel="noopener">${esc(doc.label)} ↗</a>` : '';

      const body =
        `<div class="int-meta">
           ${webHint}
           <span class="int-state" data-state="${esc(def.id)}">${st.badge}</span>
           ${docLink}
         </div>` +
        `<div class="health-slot" data-health-slot="${esc(def.id)}">${healthLineHTML(def.id)}</div>` +
        (fields || ui.empty('🔌', 'У этой интеграции нет настраиваемых полей.')) +
        (def.webCapable === false
          ? `<p class="hint int-cors">Из-за ограничений CORS прямой вызов работает только в desktop-версии. В браузере соответствующие модули используют демо-данные или импорт файла.</p>`
          : '') +
        `<div class="btn-row int-actions">
           <button class="btn primary sm" data-save="${esc(def.id)}">Сохранить</button>
           <button class="btn sm" data-test="${esc(def.id)}">Проверить</button>
           <button class="btn ghost sm" data-clearint="${esc(def.id)}" title="Удалить ключи этой интеграции">Очистить</button>
           <span class="result" data-result="${esc(def.id)}" role="status" aria-live="polite"></span>
         </div>`;

      // заголовок с иконкой интеграции, если модуль её знает (используем эмодзи fallback)
      const title = (def.title || def.id);
      return ui.card(title, INT_HINTS[def.id] || def.description || '', body);
    }

    const intCardsHTML = defs.length
      ? defs.map(intCardHTML).join('')
      : ui.empty('🔌', 'Интеграции не зарегистрированы в этой сборке.');

    /* ───────────────────────── AI-ассистент (LLM) ───────────────────────── */
    function llmCardHTML(){
      const llm = store.creds('llm') || {};
      const state = store.hasCreds('llm') ? ui.badge('настроено', 'ok') : ui.badge('не настроено', '');
      return ui.card('AI-ассистент (LLM)',
        'Подключение языковой модели для подсказок, разбора возражений и черновиков. Совместимо с OpenAI-форматом (POST {endpoint}/chat/completions).',
        `<div class="int-meta">
           <span id="llm-state">${state}</span>
           ${ui.badge('OpenAI-совместимый', 'info')}
         </div>` +
        `<div class="health-slot" data-health-slot="llm">${healthLineHTML('llm')}</div>` +
        ui.field('Endpoint (базовый URL)',
          `<input id="llm-endpoint" type="url" placeholder="https://api.openai.com/v1" value="${esc(llm.endpoint||'')}" autocomplete="off" spellcheck="false">
           <p class="field-help">Базовый адрес API без /chat/completions. Локальная модель — например http://localhost:11434/v1 (Ollama).</p>`) +
        ui.field('API-ключ',
          `<div class="kv-input has-reveal">
             <input id="llm-key" type="password" placeholder="sk-…" value="${esc(llm.apiKey||'')}" autocomplete="off" spellcheck="false" data-1p-ignore>
             <button type="button" class="reveal" data-reveal aria-label="Показать ключ" title="Показать / скрыть">👁</button>
           </div>
           <p class="field-help">Для локальных моделей ключ часто не требуется — оставьте пустым.</p>`) +
        ui.field('Модель',
          `<input id="llm-model" type="text" placeholder="gpt-4o-mini" value="${esc(llm.model||'')}" autocomplete="off" spellcheck="false">`) +
        `<div class="btn-row int-actions">
           <button class="btn primary sm" id="llm-save">Сохранить</button>
           <button class="btn sm" id="llm-test">Проверить</button>
           <button class="btn ghost sm" id="llm-clear" title="Удалить настройки AI">Очистить</button>
           <span class="result" id="llm-result" role="status" aria-live="polite"></span>
         </div>`);
    }

    /* ───────────────────────── Оформление (тема) ───────────────────────── */
    function themeCardHTML(){
      const theme = store.get('theme', document.documentElement.getAttribute('data-theme') || 'light');
      const opt = (id, label, sub) =>
        `<button type="button" class="theme-opt${theme===id?' active':''}" data-theme="${id}" aria-pressed="${theme===id}">
           <span class="theme-swatch theme-swatch-${id}" aria-hidden="true"></span>
           <span class="theme-opt-main"><span class="theme-opt-title">${label}</span><span class="theme-opt-sub">${sub}</span></span>
           <span class="theme-check" aria-hidden="true">✓</span>
         </button>`;
      return ui.card('Оформление',
        'Светлая или тёмная тема интерфейса. Выбор сохраняется в этом браузере.',
        `<div class="theme-grid" id="theme-tabs" role="group" aria-label="Тема интерфейса">
           ${opt('light','Светлая','День, мягкий фон')}
           ${opt('dark','Тёмная','Ночь, низкая яркость')}
         </div>`);
    }

    /* ───────────────────────── Данные (экспорт/импорт) ───────────────────────── */
    function dataCardHTML(){
      return ui.card('Резервная копия настроек',
        'Выгрузите все настройки и ключи в JSON-файл, чтобы перенести на другой компьютер или сделать бэкап. Импорт заменяет текущие настройки.',
        `<div class="data-rows">
           <div class="data-row">
             <div class="data-row-main">
               <div class="data-row-title">Экспорт настроек</div>
               <div class="data-row-sub">Скачать <span class="mono">sensor-suite-settings.json</span> — интеграции, ключи, AI, тема.</div>
             </div>
             <button class="btn sm" id="data-export">⤓ Экспорт</button>
           </div>
           <div class="data-row">
             <div class="data-row-main">
               <div class="data-row-title">Импорт настроек</div>
               <div class="data-row-sub">Загрузить ранее сохранённый JSON. <strong>Заменит</strong> текущие настройки.</div>
             </div>
             <label class="btn sm" id="data-import-label">⤒ Импорт<input type="file" id="data-import" accept="application/json,.json" hidden></label>
           </div>
           <div class="data-row data-row-danger">
             <div class="data-row-main">
               <div class="data-row-title">Сбросить всё</div>
               <div class="data-row-sub">Удалить все ключи, AI-настройки и тему из этого браузера. Действие необратимо.</div>
             </div>
             <button class="btn danger sm" id="data-reset">Сбросить</button>
           </div>
         </div>
         <p class="hint" style="margin-top:14px"><strong>Внимание.</strong> Файл экспорта содержит ваши ключи доступа в открытом виде — храните его в надёжном месте.</p>`);
    }

    /* ───────────────────────── О приложении ───────────────────────── */
    function aboutCardHTML(){
      const demo = defs.filter(d => intStatus(d).demo);
      const configured = defs.length - demo.length;
      const modeBadge = ctx.env === 'desktop' ? ui.badge('desktop', 'ok') : ui.badge('web', 'info');
      const modeNote  = ctx.env === 'desktop'
        ? 'Прямые запросы без ограничений CORS, доступ к файловой системе через мост.'
        : 'Браузерный режим: часть интеграций ограничена CORS и работает на демо-данных.';

      const aboutRows = ui.table([
        { k: 'Версия',      v: `<span class="mono">${esc(VERSION)}</span>` },
        { k: 'Сборка',      v: `<span class="mono">${esc(BUILT)}</span>` },
        { k: 'Режим',       v: `${modeBadge} <span class="hint" style="display:inline">${esc(modeNote)}</span>` },
        { k: 'Интеграций',  v: `${defs.length} · настроено ${configured}, на демо ${demo.length}` },
        { k: 'Хранение',    v: 'localStorage (только этот браузер)' },
        { k: 'Ключ хранилища', v: '<span class="mono">sensor_suite_v1</span>' }
      ], [
        { key: 'k', label: 'Параметр', width: '34%' },
        { key: 'v', label: 'Значение', render: v => v }
      ]);

      const docs = [
        { label: 'CONTRACT.md — как пишутся модули', url: 'CONTRACT.md' },
        { label: 'README — обзор проекта',           url: 'README.md' }
      ].map(d => `<a class="doc-link" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>`).join('');

      return ui.card('О приложении',
        'Сенсор Suite — тестовый стенд внутренних инструментов учебного центра. Vanilla SPA, web (GitHub Pages) + Electron (Mac/Win).',
        aboutRows +
        `<div class="about-docs">${docs}</div>` +
        `<p class="hint" style="margin-top:14px">
           <strong>Local-only.</strong> Все ключи и настройки хранятся локально в этом браузере и не передаются на сторонние серверы.
           Персональные данные обучающихся приложение не сохраняет. Очистка данных сайта удалит все настройки.
         </p>`);
    }

    /* ───────────────────────── сводка наверху ─────────────────────────
       Кликабельные плитки-статусы: ведут на нужный раздел. Левый акцентный
       кант + иконка задают иерархию; «всё настроено» / «нет ключей» дают
       осмысленное пустое состояние вместо голого «0». */
    function summaryHTML(){
      const demo = defs.filter(d => intStatus(d).demo).length;
      const ok   = defs.length - demo;
      const aiOn = store.hasCreds('llm');
      const items = [
        { n: ok,   l: 'настроено',    cls: ok ? 'ok' : '',     ic: '🔗', tab: 'integrations',
          sub: defs.length ? `из ${defs.length} интеграций` : 'интеграций нет' },
        { n: demo, l: 'на демо',      cls: demo ? 'warn' : 'ok', ic: demo ? '🧪' : '✓', tab: 'integrations',
          sub: demo ? 'нужны ключи доступа' : 'все с ключами' },
        { n: aiOn ? '✓' : '—', l: 'AI-ассистент', cls: aiOn ? 'ok' : '', ic: '✨', tab: 'ai',
          sub: aiOn ? 'модель подключена' : 'не настроен' }
      ].map(s =>
        `<button type="button" class="sum-item sum-${s.cls}" data-jump="${s.tab}" title="Открыть раздел">
           <span class="sum-ic" aria-hidden="true">${s.ic}</span>
           <span class="sum-body"><span class="sum-n">${esc(s.n)}</span><span class="sum-l">${esc(s.l)}</span>
           <span class="sum-sub">${esc(s.sub)}</span></span>
         </button>`
      ).join('');
      return `<div class="settings-summary" id="settings-summary">${items}</div>`;
    }

    /* ───────────────────────── scoped стили модуля ─────────────────────────
       Только токены дизайн-системы, классы не из app.css не конфликтуют. */
    const styleHTML = `<style id="settings-css">
      .settings-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
      .sum-item{position:relative;display:flex;align-items:center;gap:13px;
        background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
        box-shadow:var(--shadow-xs);padding:14px 16px 14px 18px;text-align:left;
        font:inherit;color:var(--ink);cursor:pointer;overflow:hidden;
        transition:border-color var(--t-fast) var(--ease),box-shadow var(--t-fast) var(--ease),transform var(--t-fast) var(--ease),background var(--t-fast) var(--ease)}
      .sum-item::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;
        background:var(--line-3);border-radius:var(--radius) 0 0 var(--radius);
        transition:background var(--t-fast) var(--ease)}
      .sum-ok::before{background:var(--ok)} .sum-warn::before{background:var(--warn)}
      .sum-item:hover{border-color:var(--line-3);box-shadow:var(--shadow-s);background:var(--panel-2)}
      .sum-item:active{transform:translateY(.5px)}
      .sum-item:focus-visible{outline:none;box-shadow:var(--ring)}
      .sum-ic{flex:0 0 38px;width:38px;height:38px;display:grid;place-items:center;border-radius:10px;
        font-size:18px;line-height:1;background:var(--panel-2);border:1px solid var(--line)}
      .sum-ok .sum-ic{background:var(--ok-soft);border-color:transparent}
      .sum-warn .sum-ic{background:var(--warn-soft);border-color:transparent}
      .sum-body{display:flex;flex-direction:column;min-width:0}
      .sum-n{font-size:23px;font-weight:700;letter-spacing:-.02em;line-height:1.05;font-variant-numeric:tabular-nums}
      .sum-l{font-size:12px;color:var(--ink-2);margin-top:2px;font-weight:600}
      .sum-sub{font-size:11px;color:var(--muted);margin-top:1px;line-height:1.35;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sum-ok .sum-n{color:var(--ok-d)} .sum-warn .sum-n{color:var(--warn-d)}
      @media(max-width:560px){.settings-summary{grid-template-columns:1fr}.sum-sub{white-space:normal}}

      .int-head-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .int-head-row .result{font-size:12.5px;display:inline-flex;align-items:center;gap:7px;flex-wrap:wrap;min-height:22px}

      .health-slot:empty{display:none}
      .health-line{display:flex;align-items:center;gap:7px;margin:0 0 12px;
        font-size:11.5px;color:var(--muted);line-height:1.4}
      .hc-dot{flex:0 0 7px;width:7px;height:7px;border-radius:50%;background:var(--muted)}
      .hc-dot.hc-ok{background:var(--ok)} .hc-dot.hc-err{background:var(--err)}

      .int-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .int-meta .doc-link{margin-left:auto}
      .doc-link{font-size:12px;font-weight:550;color:var(--ink-3);white-space:nowrap}
      .doc-link:hover{color:var(--accent)}
      .int-cors{margin:2px 0 12px}
      .int-actions{margin-top:6px}
      .int-actions .result,.result{font-size:12.5px;display:inline-flex;align-items:center;gap:7px;flex-wrap:wrap;min-height:22px}
      .result .hint{display:inline}

      .kv-input{position:relative;display:flex;align-items:center}
      .kv-input.has-reveal input{padding-right:40px}
      .kv-input .reveal{position:absolute;right:4px;top:50%;transform:translateY(-50%);
        width:30px;height:30px;display:grid;place-items:center;border:none;background:transparent;
        color:var(--muted);font-size:15px;line-height:1;border-radius:var(--radius-xs);cursor:pointer;
        transition:background var(--t-fast) var(--ease),color var(--t-fast) var(--ease);opacity:.75}
      .kv-input .reveal:hover{background:var(--panel-2);color:var(--ink-2);opacity:1}
      .kv-input .reveal:focus-visible{outline:none;box-shadow:var(--ring);opacity:1}
      .kv-input .reveal.on{color:var(--accent-d);opacity:1}
      .field-help{margin:6px 0 0;font-size:11.5px;line-height:1.45;color:var(--muted)}

      .theme-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      @media(max-width:560px){.theme-grid{grid-template-columns:1fr}}
      .theme-opt{display:flex;align-items:center;gap:12px;text-align:left;
        padding:12px 14px;border:1px solid var(--line-2);border-radius:var(--radius);
        background:var(--panel);cursor:pointer;font:inherit;color:var(--ink);position:relative;
        transition:border-color var(--t-fast) var(--ease),box-shadow var(--t-fast) var(--ease),background var(--t-fast) var(--ease),transform var(--t-fast) var(--ease)}
      .theme-opt:hover{border-color:var(--line-3);background:var(--panel-2)}
      .theme-opt:active{transform:translateY(.5px)}
      .theme-opt:focus-visible{outline:none;box-shadow:var(--ring)}
      .theme-opt.active{border-color:var(--accent);box-shadow:var(--ring)}
      .theme-swatch{width:38px;height:38px;border-radius:10px;flex:0 0 38px;border:1px solid var(--line-2);
        position:relative;overflow:hidden}
      .theme-swatch-light{background:linear-gradient(135deg,#f5f6f9 0 60%,#ffffff 60% 100%)}
      .theme-swatch-light::after{content:"";position:absolute;left:7px;top:8px;width:16px;height:4px;border-radius:2px;
        background:#d62f1e;box-shadow:0 7px 0 #cbd3de,0 14px 0 #cbd3de}
      .theme-swatch-dark{background:linear-gradient(135deg,#0d1015 0 60%,#161a21 60% 100%)}
      .theme-swatch-dark::after{content:"";position:absolute;left:7px;top:8px;width:16px;height:4px;border-radius:2px;
        background:#e4503f;box-shadow:0 7px 0 #2f3744,0 14px 0 #2f3744}
      .theme-opt-main{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}
      .theme-opt-title{font-size:13.5px;font-weight:600}
      .theme-opt-sub{font-size:11.5px;color:var(--muted)}
      .theme-check{width:20px;height:20px;flex:0 0 20px;display:grid;place-items:center;border-radius:50%;
        background:var(--accent);color:#fff;font-size:12px;font-weight:700;opacity:0;transform:scale(.6);
        transition:opacity var(--t-fast) var(--ease),transform var(--t-fast) var(--ease)}
      .theme-opt.active .theme-check{opacity:1;transform:none}

      .data-rows{display:flex;flex-direction:column;gap:2px}
      .data-row{display:flex;align-items:center;gap:14px;padding:13px 0;border-bottom:1px solid var(--line)}
      .data-row:last-child{border-bottom:none}
      .data-row-main{flex:1;min-width:0}
      .data-row-title{font-size:13.5px;font-weight:600;letter-spacing:-.005em}
      .data-row-sub{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.45}
      .data-row .btn{flex:0 0 auto}
      .data-row-danger .data-row-title{color:var(--err-d)}

      .about-docs{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
    </style>`;

    /* ───────────────────────── вкладки ─────────────────────────
       Самодостаточный таб-свитч на CSS-классах .tabs-underline/.tab
       (определены в shell-CSS). Все панели рендерятся сразу, переключаем
       видимость — не используем ui.tabs (избегаем зависимости от его
       внутренней реализации). Выбор запоминается в store. */
    // верхняя карточка-«шапка» раздела Интеграции: интро + массовая проверка
    const withKeys = defs.filter(d => store.hasCreds(d.id)).length;
    const intHeadHTML = ui.card('Ключи доступа',
      'Подключение внешних сервисов. Без ключей соответствующие модули работают на демо-данных. Всё хранится только в этом браузере.',
      `<div class="int-head-row">
         <button class="btn sm" id="int-test-all"${withKeys ? '' : ' disabled title="Сначала введите ключи хотя бы одной интеграции"'}>
           ⟳ Проверить все${withKeys ? ` <span class="t-count">${withKeys}</span>` : ''}
         </button>
         <span class="result" id="int-test-all-result" role="status" aria-live="polite"></span>
       </div>`);
    const TABS = [
      { id: 'integrations', label: 'Интеграции',   icon: '🔌', count: defs.length,
        html: intHeadHTML + intCardsHTML },
      { id: 'ai',         label: 'AI-ассистент',  icon: '✨', html: llmCardHTML() },
      { id: 'appearance', label: 'Оформление',    icon: '🎨', html: themeCardHTML() },
      { id: 'data',       label: 'Данные',        icon: '🗄️', html: dataCardHTML() },
      { id: 'about',      label: 'О приложении',  icon: 'ℹ️', html: aboutCardHTML() }
    ];
    let activeTab = store.get('settings_tab', 'integrations');
    if (!TABS.some(t => t.id === activeTab)) activeTab = 'integrations';

    const tabBar = TABS.map(t =>
      `<button type="button" class="tab${t.id===activeTab?' active':''}" role="tab"
               data-tab="${t.id}" aria-selected="${t.id===activeTab}" tabindex="${t.id===activeTab?0:-1}">
         <span class="t-ic">${t.icon}</span>${esc(t.label)}${t.count!=null?` <span class="t-count">${esc(t.count)}</span>`:''}
       </button>`).join('');

    const panels = TABS.map(t =>
      `<div class="settings-panel" data-panel="${t.id}" role="tabpanel"${t.id===activeTab?'':' hidden'}>${t.html}</div>`).join('');

    root.innerHTML = styleHTML + summaryHTML() +
      `<div class="tabs-underline" role="tablist" aria-label="Разделы настроек" id="settings-tabs">${tabBar}</div>` +
      `<div id="settings-panels">${panels}</div>`;

    function selectTab(id){
      if (!TABS.some(t => t.id === id)) return;
      activeTab = id;
      store.set('settings_tab', id);
      root.querySelectorAll('#settings-tabs .tab').forEach(b => {
        const on = b.dataset.tab === id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      root.querySelectorAll('#settings-panels .settings-panel').forEach(p => {
        p.hidden = p.dataset.panel !== id;
      });
    }
    root.querySelectorAll('#settings-tabs .tab').forEach((b, idx, all) => {
      b.onclick = () => selectTab(b.dataset.tab);
      b.onkeydown = e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
          e.preventDefault();
          const dir = e.key === 'ArrowRight' ? 1 : -1;
          const ni = (idx + dir + all.length) % all.length;
          selectTab(all[ni].dataset.tab); all[ni].focus();
        }
      };
    });

    /* ───────────────────────── helpers ───────────────────────── */
    function refreshSummary(){
      const old = root.querySelector('#settings-summary');
      if (!old) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = summaryHTML();
      old.replaceWith(tmp.firstElementChild);
      bindSummary();
    }
    function bindSummary(){
      root.querySelectorAll('#settings-summary [data-jump]').forEach(b => {
        if (b._bound) return; b._bound = true;
        b.onclick = () => selectTab(b.dataset.jump);
      });
    }
    function setState(id){
      const def = defs.find(d => d.id === id);
      const el  = root.querySelector(`[data-state="${CSS.escape(id)}"]`);
      if (def && el) el.innerHTML = intStatus(def).badge;
      refreshSummary();
    }
    // перерисовать строку «Проверено … назад» под мета-рядом интеграции
    function refreshHealthLine(id){
      const slot = root.querySelector(`[data-health-slot="${CSS.escape(id)}"]`);
      if (slot) slot.innerHTML = healthLineHTML(id);
    }
    function resultOk(out, detail){
      out.innerHTML = `${ui.badge('✓ соединение есть','ok')} ${detail ? `<span class="hint">${esc(detail)}</span>` : ''}`;
    }
    function resultErr(out, detail){
      out.innerHTML = `${ui.badge('✕ ошибка','err')} <span class="hint">${esc(detail || 'нет соединения')}</span>`;
    }
    function collect(id){
      const obj = {};
      root.querySelectorAll(`[data-int="${CSS.escape(id)}"]`).forEach(inp => { obj[inp.dataset.key] = inp.value.trim(); });
      return obj;
    }

    // переключатель видимости пароля (делегирование на root, переживает смену табов)
    function bindReveals(){
      root.querySelectorAll('[data-reveal]').forEach(btn => {
        if (btn._bound) return; btn._bound = true;
        btn.onclick = () => {
          const inp = btn.parentElement.querySelector('input');
          if (!inp) return;
          const show = inp.type === 'password';
          inp.type = show ? 'text' : 'password';
          btn.classList.toggle('on', show);
          btn.setAttribute('aria-label', show ? 'Скрыть значение' : 'Показать значение');
        };
      });
    }

    /* ───────────────────────── биндинги интеграций ───────────────────────── */
    function bindIntegrations(){
      root.querySelectorAll('[data-save]').forEach(btn => {
        if (btn._bound) return; btn._bound = true;
        btn.onclick = () => {
          const id = btn.dataset.save;
          store.setCreds(id, collect(id));
          setState(id);
          ctx.toast('Ключи сохранены ✓', 'ok');
          if (ctx.app && ctx.app.refreshDemoBadge) ctx.app.refreshDemoBadge();
        };
      });

      root.querySelectorAll('[data-test]').forEach(btn => {
        if (btn._bound) return; btn._bound = true;
        btn.onclick = async () => {
          const id  = btn.dataset.test;
          store.setCreds(id, collect(id));   // сохранить перед проверкой
          setState(id);
          if (ctx.app && ctx.app.refreshDemoBadge) ctx.app.refreshDemoBadge();
          const out = root.querySelector(`[data-result="${CSS.escape(id)}"]`);
          if (out) out.innerHTML = ui.spinner + ' <span class="hint">проверка соединения…</span>';
          btn.disabled = true;
          let res;
          const t0 = performance.now();
          try { res = await ctx.integrations[id].test(); }
          catch(e){ res = { ok:false, detail:String(e && e.message || e) }; }
          btn.disabled = false;
          const ms = Math.round(performance.now() - t0);
          const okRes = !!(res && res.ok);
          healthSet(id, okRes, okRes ? (res.detail || 'соединение есть') : ((res && res.detail) || 'нет соединения'));
          refreshHealthLine(id);
          if (!out) return;
          if (okRes) resultOk(out, (res.detail || '') + ` · ${ms} мс`);
          else       resultErr(out, (res && res.detail) || 'нет соединения');
        };
      });

      // массовая проверка всех интеграций с ключами — последовательно, с прогрессом
      const all = root.querySelector('#int-test-all');
      if (all && !all._bound){ all._bound = true; all.onclick = async () => {
        const out = root.querySelector('#int-test-all-result');
        const queue = defs.filter(d => store.hasCreds(d.id));
        if (!queue.length){ if (out) out.innerHTML = `<span class="hint">Нет интеграций с ключами.</span>`; return; }
        all.disabled = true;
        let okN = 0, errN = 0, done = 0;
        const render = phase => { if (out) out.innerHTML =
          `${ui.spinner} <span class="hint">${esc(phase)} · ${done}/${queue.length}</span>`; };
        for (const def of queue){
          render('проверка ' + (def.title || def.id) + '…');
          const cardOut = root.querySelector(`[data-result="${CSS.escape(def.id)}"]`);
          if (cardOut) cardOut.innerHTML = ui.spinner + ' <span class="hint">проверка…</span>';
          let res;
          try { res = await ctx.integrations[def.id].test(); }
          catch(e){ res = { ok:false, detail:String(e && e.message || e) }; }
          const okRes = !!(res && res.ok);
          okRes ? okN++ : errN++; done++;
          healthSet(def.id, okRes, okRes ? (res.detail || 'соединение есть') : ((res && res.detail) || 'нет соединения'));
          refreshHealthLine(def.id);
          if (cardOut){ okRes ? resultOk(cardOut, res.detail || '') : resultErr(cardOut, (res && res.detail) || 'нет соединения'); }
        }
        all.disabled = false;
        if (out){
          const parts = [];
          if (okN)  parts.push(ui.badge('✓ ' + okN, 'ok'));
          if (errN) parts.push(ui.badge('✕ ' + errN, 'err'));
          out.innerHTML = parts.join(' ') + ` <span class="hint">проверено ${queue.length}</span>`;
        }
        ctx.toast(errN ? `Проверка: ${okN} ок, ${errN} с ошибкой` : `Все ${okN} интеграции на связи ✓`, errN ? 'info' : 'ok');
      }; }

      root.querySelectorAll('[data-clearint]').forEach(btn => {
        if (btn._bound) return; btn._bound = true;
        btn.onclick = async () => {
          const id = btn.dataset.clearint;
          const def = defs.find(d => d.id === id);
          if (!store.hasCreds(id)){ ctx.toast('Ключей и так нет', 'info'); return; }
          const yes = await ui.confirm({
            title: 'Очистить ключи',
            message: `Удалить ключи интеграции «${(def && def.title) || id}»?`,
            detail: 'Модуль вернётся к демо-данным. Действие можно отменить, заново введя ключи.',
            danger: true, ok: 'Очистить'
          });
          if (!yes) return;
          store.setCreds(id, {});
          healthClear(id);
          root.querySelectorAll(`[data-int="${CSS.escape(id)}"]`).forEach(inp => { inp.value = ''; });
          setState(id);
          refreshHealthLine(id);
          const out = root.querySelector(`[data-result="${CSS.escape(id)}"]`);
          if (out) out.innerHTML = '';
          ctx.toast('Ключи удалены', 'ok');
          if (ctx.app && ctx.app.refreshDemoBadge) ctx.app.refreshDemoBadge();
        };
      });
    }

    /* ───────────────────────── биндинги AI ───────────────────────── */
    function readLlm(){
      const val = sel => { const e = root.querySelector(sel); return e ? e.value.trim() : ''; };
      return { endpoint: val('#llm-endpoint'), apiKey: val('#llm-key'), model: val('#llm-model') };
    }
    function setLlmState(){
      const el = root.querySelector('#llm-state');
      if (el) el.innerHTML = store.hasCreds('llm') ? ui.badge('настроено','ok') : ui.badge('не настроено','');
      refreshSummary();
    }
    function bindLlm(){
      const save = root.querySelector('#llm-save');
      if (save && !save._bound){ save._bound = true; save.onclick = () => {
        store.setCreds('llm', readLlm());
        setLlmState();
        ctx.toast('AI-ассистент сохранён ✓', 'ok');
      }; }

      const clear = root.querySelector('#llm-clear');
      if (clear && !clear._bound){ clear._bound = true; clear.onclick = async () => {
        if (!store.hasCreds('llm')){ ctx.toast('Нечего очищать', 'info'); return; }
        const yes = await ui.confirm({ title:'Очистить AI', message:'Удалить настройки AI-ассистента?', danger:true, ok:'Очистить' });
        if (!yes) return;
        store.setCreds('llm', {});
        healthClear('llm');
        ['#llm-endpoint','#llm-key','#llm-model'].forEach(s => { const e = root.querySelector(s); if (e) e.value = ''; });
        const out = root.querySelector('#llm-result'); if (out) out.innerHTML = '';
        refreshHealthLine('llm');
        setLlmState();
        ctx.toast('AI-настройки удалены', 'ok');
      }; }

      const test = root.querySelector('#llm-test');
      if (test && !test._bound){ test._bound = true; test.onclick = async () => {
        const cfg = readLlm();
        store.setCreds('llm', cfg);
        setLlmState();
        const out = root.querySelector('#llm-result');
        if (!cfg.endpoint){ if (out) resultErr(out, 'укажите Endpoint'); return; }
        if (out) out.innerHTML = ui.spinner + ' <span class="hint">запрос /models…</span>';
        test.disabled = true;
        const t0 = performance.now();
        try {
          const base = cfg.endpoint.replace(/\/+$/,'');
          const headers = { 'Accept':'application/json' };
          if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
          const res = await fetch(base + '/models', { method:'GET', headers });
          const ms = Math.round(performance.now() - t0);
          if (!res.ok){ healthSet('llm', false, 'HTTP ' + res.status); if (out) resultErr(out, 'HTTP ' + res.status + ` · ${ms} мс`); }
          else {
            const j = await res.json().catch(()=>null);
            const list = (j && (j.data || j.models)) || [];
            const n = Array.isArray(list) ? list.length : 0;
            const hasModel = cfg.model && Array.isArray(list) && list.some(m => (m.id || m.name) === cfg.model);
            const detail = (n ? `моделей: ${n}` : 'ответ получен')
              + (cfg.model ? ` · «${cfg.model}» ${hasModel ? 'доступна' : 'не в списке'}` : '')
              + ` · ${ms} мс`;
            healthSet('llm', true, detail);
            if (out) resultOk(out, detail);
          }
        } catch(e){
          healthSet('llm', false, String(e && e.message || e));
          if (out) resultErr(out, String(e && e.message || e) + ' (возможна блокировка CORS — проверьте endpoint)');
        }
        refreshHealthLine('llm');
        test.disabled = false;
      }; }
    }

    /* ───────────────────────── биндинги темы ───────────────────────── */
    function bindTheme(){
      root.querySelectorAll('#theme-tabs .theme-opt').forEach(opt => {
        if (opt._bound) return; opt._bound = true;
        opt.onclick = () => {
          const t = opt.dataset.theme;
          store.set('theme', t);
          document.documentElement.setAttribute('data-theme', t);
          root.querySelectorAll('#theme-tabs .theme-opt').forEach(x => {
            const on = x === opt; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          ctx.toast('Тема: ' + (t === 'dark' ? 'тёмная' : 'светлая'), 'info');
        };
      });
    }

    /* ───────────────────────── биндинги данных ───────────────────────── */
    function bindData(){
      const exp = root.querySelector('#data-export');
      if (exp && !exp._bound){ exp._bound = true; exp.onclick = () => {
        const payload = {
          _app: 'sensor-suite', _version: VERSION, _exported: new Date().toISOString(),
          settings: store.all()
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
        ui.download('sensor-suite-settings.json', blob);
        ctx.toast('Настройки выгружены ✓', 'ok');
      }; }

      const imp = root.querySelector('#data-import');
      if (imp && !imp._bound){ imp._bound = true; imp.onchange = e => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const rd = new FileReader();
        rd.onload = async () => {
          let parsed;
          try { parsed = JSON.parse(rd.result); }
          catch(err){ ctx.toast('Файл не является корректным JSON', 'err'); imp.value=''; return; }
          const incoming = (parsed && parsed.settings && typeof parsed.settings === 'object')
            ? parsed.settings
            : (parsed && typeof parsed === 'object' ? parsed : null);
          if (!incoming){ ctx.toast('В файле нет настроек', 'err'); imp.value=''; return; }
          const credCount = incoming.creds ? Object.keys(incoming.creds).length : 0;
          const yes = await ui.confirm({
            title: 'Импорт настроек',
            message: 'Заменить текущие настройки данными из файла?',
            detail: `Будет загружено: ключей интеграций — ${credCount}` + (incoming.theme ? `, тема — ${incoming.theme === 'dark' ? 'тёмная' : 'светлая'}` : '') + '. Текущие настройки будут перезаписаны.',
            danger: true, ok: 'Импортировать'
          });
          imp.value = '';
          if (!yes) return;
          // переносим ключи верхнего уровня в store (контракт: set per-key)
          Object.keys(incoming).forEach(k => store.set(k, incoming[k]));
          if (incoming.theme){ document.documentElement.setAttribute('data-theme', incoming.theme); }
          ctx.toast('Настройки импортированы ✓', 'ok');
          if (ctx.app && ctx.app.refreshDemoBadge) ctx.app.refreshDemoBadge();
          remount(); // перерисовать с новыми данными store
        };
        rd.readAsText(file);
      }; }

      const reset = root.querySelector('#data-reset');
      if (reset && !reset._bound){ reset._bound = true; reset.onclick = async () => {
        const yes = await ui.confirm({
          title: 'Сбросить все настройки',
          message: 'Удалить все ключи, AI-настройки и оформление из этого браузера?',
          detail: 'Действие необратимо. Рекомендуем сначала сделать экспорт.',
          danger: true, ok: 'Сбросить всё'
        });
        if (!yes) return;
        // очищаем по контракту: убираем креды и тему через публичный API
        defs.forEach(d => store.setCreds(d.id, {}));
        store.setCreds('llm', {});
        store.set('settings_health', {});
        store.set('theme', 'light');
        document.documentElement.setAttribute('data-theme', 'light');
        ctx.toast('Все настройки сброшены', 'ok');
        if (ctx.app && ctx.app.refreshDemoBadge) ctx.app.refreshDemoBadge();
        remount();
      }; }
    }

    /* привязать обработчики текущего активного таба (вызывается при onChange) */
    function bindCurrent(){
      bindSummary();
      bindReveals();
      bindIntegrations();
      bindLlm();
      bindTheme();
      bindData();
    }
    bindCurrent();
  }
});

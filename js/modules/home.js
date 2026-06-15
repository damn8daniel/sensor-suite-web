/* Модуль «Главная» (P13) — стартовый дашборд Сенсор Suite.
   ----------------------------------------------------------------------------
   Компактные адаптивные карточки-сводки, ничего не генерируют и не уходят на
   сервер — только агрегируют состояние уже загруженных модулей/данных:

     1) Приветствие + статус сессии (режим/роль, тема, web|desktop, демо/локально).
     2) Карточки по отделам со ссылками-кнопками на доступные текущей роли модули.
     3) Статус интеграций (настроена / демо), БЕЗ показа значений ключей.
     4) Прогресс 152-ФЗ — «закрыто X из N» из того же persist-ключа, что и модуль
        analytics ('analytics_pdn152_done'); клик → переход в analytics.
     5) Последние черновики/действия (licensing/documents/nok) или быстрые действия.
     6) «Что нового» — короткий список ключевых возможностей (P1–P12).

   Контракт: id='home', dept=null (как settings — без отдела), order=1 (первый).
   Никогда не падает и не пустой: каждая карточка имеет осмысленный фолбэк.
   Не использует ui.tabs() (известный дефект рекурсии) — ничего табового тут нет. */

SensorApp.register({
  id: 'home', title: 'Главная', dept: null, order: 1,
  icon: '🏠',
  description: 'Сводка по отделам, интеграциям, соответствию 152-ФЗ и быстрые действия',
  keywords: ['главная','дашборд','старт','обзор','home','dashboard','сводка','начало'],

  // Быстрые действия палитры (навигация выполняется роутером по m.id, эти — ярлыки
  // переходов в нужные модули прямо из командной палитры).
  actions: [
    { id:'goc', title:'Главная: проверить ИНН', hint:'Пробив контрагента (DaData)', icon:'🏢',
      keywords:['инн','контрагент','пробив','dadata'],
      run:()=>{ try{ window.SensorApp.navigate('counterparties'); }catch(e){} } },
    { id:'god', title:'Главная: новый документ', hint:'Генерация документов УЦ', icon:'📄',
      keywords:['документ','docx','шаблон','генерация'],
      run:()=>{ try{ window.SensorApp.navigate('documents'); }catch(e){} } },
    { id:'gos', title:'Главная: проверить специалиста', hint:'Проверка специалистов', icon:'🎓',
      keywords:['специалист','проверка','диплом','нрс'],
      run:()=>{ try{ window.SensorApp.navigate('specialists'); }catch(e){} } }
  ],

  mount(root, ctx){
    const U = ctx.ui, esc = U.escape, store = ctx.store, app = ctx.app;
    const env = ctx.env;

    /* ====================================================================
       0. ДОСТУП К ОБОЛОЧКЕ И СБОРУ ДАННЫХ (безопасные геттеры)
       ==================================================================== */

    // Список модулей, доступных текущей роли/сборке. Предпочитаем публичный
    // visibleModules(); если его нет — фолбэк на _modules (без фильтра).
    function visible(){
      try {
        if (app && typeof app.visibleModules === 'function'){
          const v = app.visibleModules();
          if (Array.isArray(v) && v.length) return v;
        }
      } catch(e){}
      const all = (app && Array.isArray(app._modules)) ? app._modules : [];
      return all.slice();
    }
    function moduleById(id){ return visible().find(m=>m && m.id===id) || null; }
    function canSee(id){ return !!moduleById(id); }

    function navigate(id){
      if (!id) return;
      try {
        if (app && typeof app.navigate === 'function') app.navigate(id);
        else location.hash = '#/' + id;
      } catch(e){ try{ location.hash = '#/' + id; }catch(_){} }
    }

    // Роль/режим (если роли отключены — деградируем тихо).
    function roleInfo(){
      let id = null, label = null;
      try { if (app && typeof app.getRole === 'function') id = app.getRole(); } catch(e){}
      try {
        const R = (app && app.roles) || (window.SUITE_ROLES) || null;
        if (R && R.labels && id && R.labels[id]) label = R.labels[id];
      } catch(e){}
      return { id, label: label || (id ? id : '') };
    }

    // Тема: data-theme на <html> — конкретная (light|dark); предпочтение — из app.
    function themeInfo(){
      let resolved = 'light', pref = null;
      try { resolved = document.documentElement.getAttribute('data-theme') || 'light'; } catch(e){}
      try { if (app && typeof app.getThemePref === 'function') pref = app.getThemePref(); } catch(e){}
      const prefLabel = { light:'светлая', dark:'тёмная', auto:'системная' }[pref] || null;
      const resLabel  = { light:'светлая', dark:'тёмная' }[resolved] || resolved;
      return { resolved, pref, label: prefLabel || resLabel };
    }

    /* ====================================================================
       1. ПРИВЕТСТВИЕ + СТАТУС СЕССИИ
       ==================================================================== */
    function greeting(){
      const h = new Date().getHours();
      if (h < 5)  return 'Доброй ночи';
      if (h < 12) return 'Доброе утро';
      if (h < 18) return 'Добрый день';
      return 'Добрый вечер';
    }

    function renderHero(){
      const r = roleInfo();
      const th = themeInfo();
      const demo = demoIntegrations();
      const allInt = integrationDefs();
      const modeLabel = (env === 'desktop')
        ? 'десктоп · сервисы напрямую'
        : 'веб · обезличенное демо';
      const dataLabel = demo.length
        ? `демо-данные · ${demo.length} ${plural(demo.length,'интеграция','интеграции','интеграций')}`
        : (allInt.length ? 'все интеграции с ключами' : 'локальные данные');

      const chips = [
        r.label ? U.badge('режим: ' + r.label, 'accent') : '',
        U.badge('тема: ' + th.label),
        U.badge(modeLabel, 'info'),
        U.badge(dataLabel, demo.length ? 'warn' : 'ok')
      ].filter(Boolean).join(' ');

      return U.card(
        greeting() + ' 👋',
        'Сенсор Suite — единое рабочее окно учебного центра: документооборот, лицензирование, продажи, управление и контрагенты.',
        `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${chips}</div>`
      );
    }

    /* ====================================================================
       2. КАРТОЧКИ ПО ОТДЕЛАМ + ССЫЛКИ НА МОДУЛИ
       ==================================================================== */
    // Описываем отделы как наборы модулей по dept-группам реальных модулей.
    // Берём только то, что доступно текущей роли (через canSee/visible()).
    const DEPT_CARDS = [
      { key:'Документооборот / УЦ', icon:'📄',
        blurb:'Шаблоны и генерация .docx, проверка специалистов, реестр выпускников.',
        depts:['Документооборот','Учебный центр','Лицензирование','НОК / СРО'] },
      { key:'Продажи', icon:'📞',
        blurb:'Контроль звонков, AI-ассистент по скриптам, банк возражений.',
        depts:['Продажи'] },
      { key:'Управление', icon:'📊',
        blurb:'РНП-дашборд, конкурентная аналитика, SEO-роадмап, чеклист 152-ФЗ.',
        depts:['Управление'] },
      { key:'Контрагенты', icon:'🏢',
        blurb:'Пробив по ИНН / ОГРН (DaData / СПАРК), картотека контрагентов.',
        depts:['Контрагенты'] }
    ];

    function renderDeptCards(){
      const mods = visible().filter(m=>m && m.id!=='settings' && m.id!=='home');
      // быстрая карта dept → модули
      const cards = DEPT_CARDS.map(dc=>{
        const inside = mods
          .filter(m=>dc.depts.indexOf(m.dept||'') >= 0)
          .sort((a,b)=>(a.order||99)-(b.order||99));
        if (!inside.length) return ''; // отдел недоступен текущей роли — скрываем
        const links = inside.map(m=>
          `<button type="button" class="btn ghost sm" data-go="${esc(m.id)}" title="${esc(m.description||m.title)}">`+
            `<span aria-hidden="true" style="margin-right:5px">${m.icon||'•'}</span>${esc(m.title)}</button>`
        ).join('');
        return `<div class="card" style="margin:0;padding:15px">`+
          `<h3 style="font-size:14px"><span aria-hidden="true">${dc.icon}</span>${esc(dc.key)}</h3>`+
          `<p class="hint" style="margin:2px 0 11px">${esc(dc.blurb)}</p>`+
          `<div class="btn-row" style="flex-wrap:wrap;gap:6px">${links}</div>`+
        `</div>`;
      }).filter(Boolean);

      const body = cards.length
        ? `<div class="grid cols-2" data-home-depts>${cards.join('')}</div>`
        : U.empty('🧭','В текущем режиме нет доступных рабочих модулей.');

      return U.card('Рабочие модули по отделам',
        'Откройте раздел кнопкой. Показаны только модули, доступные текущему режиму.',
        body);
    }

    /* ====================================================================
       3. СТАТУС ИНТЕГРАЦИЙ (настроена / демо), без значений ключей
       ==================================================================== */
    function integrationDefs(){
      try {
        if (app && Array.isArray(app._integrations)) return app._integrations.slice();
      } catch(e){}
      // фолбэк: из обёрнутых интеграций в ctx (configured() есть у каждой)
      const out = [];
      try { Object.keys(ctx.integrations||{}).forEach(id=>{ const w = ctx.integrations[id]; if (w) out.push({ id, title:w.title||id, webCapable:w.webCapable }); }); } catch(e){}
      return out;
    }
    // Те интеграции, что сейчас отдают демо (нет ключей или web-blocked).
    function isConfigured(id){
      try {
        const w = ctx.integrations && ctx.integrations[id];
        if (w && typeof w.configured === 'function') return !!w.configured();
      } catch(e){}
      try { return !!store.hasCreds(id); } catch(e){}
      return false;
    }
    function isWebBlocked(def){ return def && def.webCapable === false && env === 'web'; }
    function demoIntegrations(){
      return integrationDefs().filter(def=> !isConfigured(def.id) || isWebBlocked(def));
    }

    function renderIntegrations(){
      const defs = integrationDefs();
      if (!defs.length){
        return U.card('Интеграции', '',
          U.empty('🔌','Интеграции не зарегистрированы в этой сборке.',
            canSee('settings') ? `<button class="btn sm" data-go="settings">Открыть настройки</button>` : ''));
      }
      const rows = defs.map(def=>{
        const conf = isConfigured(def.id);
        const blocked = isWebBlocked(def);
        let badge, note;
        if (conf && !blocked){ badge = U.badge('настроена','ok'); note = 'ключи заданы'; }
        else if (blocked){ badge = U.badge('демо · только десктоп','warn'); note = 'в вебе CORS — демо-данные'; }
        else { badge = U.badge('демо','warn'); note = 'нет ключей — демо-данные'; }
        return `<div style="display:flex;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--line)">`+
          `<span style="flex:1;min-width:0"><strong style="font-size:13.5px">${esc(def.title||def.id)}</strong>`+
            `<span class="muted" style="display:block;font-size:12px">${esc(note)}</span></span>`+
          `<span style="flex:0 0 auto">${badge}</span></div>`;
      }).join('');

      const demoN = demoIntegrations().length;
      const summary = demoN
        ? `${demoN} из ${defs.length} в демо-режиме. Введите ключи в Настройках — данные подтянутся автоматически.`
        : 'Все интеграции настроены.';
      const action = canSee('settings')
        ? `<div class="btn-row" style="margin-top:12px"><button class="btn ghost sm" data-go="settings">⚙︎ Ключи в настройках</button></div>`
        : '';

      return U.card('Статус интеграций', summary,
        `<div style="margin-top:2px">${rows}</div>${action}`);
    }

    /* ====================================================================
       4. ПРОГРЕСС 152-ФЗ — из persist-ключа модуля analytics
       ==================================================================== */
    const PDN_STORE_KEY = 'analytics_pdn152_done'; // тот же ключ, что в analytics.js
    function pdnItems(){
      try {
        const A = window.ANALYTICS;
        if (A && Array.isArray(A.pdn152)) return A.pdn152;
      } catch(e){}
      return [];
    }
    function pdnDone(){
      const d = store.get(PDN_STORE_KEY, {});
      return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
    }

    function renderPdn(){
      const items = pdnItems();
      const analyticsAvail = canSee('analytics');
      const openBtn = analyticsAvail
        ? `<button type="button" class="btn primary sm" data-go="analytics" data-home-pdn-open>Открыть чеклист 152-ФЗ →</button>`
        : `<span class="muted" style="font-size:12px">Чеклист доступен в режиме руководителя (модуль «Аналитика»).</span>`;

      if (!items.length){
        return U.card('Соответствие 152-ФЗ', 'Чеклист обработки персональных данных.',
          U.empty('🔐','Чеклист 152-ФЗ ещё не загружен.', openBtn));
      }

      const done = pdnDone();
      const total = items.length;
      const closed = items.filter(p=>done[p.id]).length;
      const pct = total ? Math.round(closed/total*100) : 0;

      const progress =
        `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">`+
          `<strong data-home-pdn data-closed="${closed}" data-total="${total}" style="font-size:14px">Закрыто ${closed} из ${total}</strong>`+
          `<span class="muted" style="font-size:12px">${pct}%</span></div>`+
        `<div style="height:10px;background:var(--line);border-radius:999px;overflow:hidden">`+
          `<div style="height:100%;width:${pct}%;background:${pct>=100?'var(--ok)':'var(--accent)'};transition:width .25s"></div></div>`+
        `<div class="btn-row" style="margin-top:13px">${openBtn}</div>`;

      return U.card('Соответствие 152-ФЗ',
        'Прогресс закрытия пунктов чеклиста персональных данных. Отметки ведутся в «Аналитике».',
        progress);
    }

    /* ====================================================================
       5. ПОСЛЕДНИЕ ЧЕРНОВИКИ / БЫСТРЫЕ ДЕЙСТВИЯ
       ==================================================================== */
    // Читаем те же persist-ключи, что используют модули (только чтение, без записи).
    function recentDrafts(){
      const out = [];
      // licensing: 'licensing_drafts' — [{id,title,savedAt,...}]
      try {
        const a = store.get('licensing_drafts', []);
        if (Array.isArray(a)) a.forEach(d=>{ if (d) out.push({ kind:'Лицензирование', go:'licensing', title:d.title||d.docName||'Черновик пакета', at:d.savedAt }); });
      } catch(e){}
      // documents: 'documents_history' — [{at, ...}] (последние генерации)
      try {
        const h = store.get('documents_history', []);
        if (Array.isArray(h)) h.forEach(g=>{ if (g) out.push({ kind:'Документы', go:'documents', title:(g.title||g.docName||g.name||'Генерация документа'), at:g.at }); });
      } catch(e){}
      // nok: 'nok_invoices' / история счетов — необязательно, читаем мягко
      try {
        const inv = store.get('nok_invoices', []);
        if (Array.isArray(inv)) inv.forEach(i=>{ if (i) out.push({ kind:'Счета', go:'nok', title:(i.title||i.number||'Счёт'), at:(i.at||i.savedAt) }); });
      } catch(e){}

      // фильтруем по доступности модуля роли, сортируем по дате (если есть), берём топ-5
      return out
        .filter(x=>canSee(x.go))
        .sort((a,b)=>{
          const ta = a.at ? Date.parse(a.at) : 0, tb = b.at ? Date.parse(b.at) : 0;
          return (isFinite(tb)?tb:0) - (isFinite(ta)?ta:0);
        })
        .slice(0, 5);
    }

    function ago(iso){
      const t = iso ? Date.parse(iso) : NaN;
      if (!isFinite(t)) return '';
      const s = Math.max(0, (Date.now()-t)/1000);
      if (s < 90) return 'только что';
      if (s < 3600) return Math.round(s/60)+' мин назад';
      if (s < 86400) return Math.round(s/3600)+' ч назад';
      if (s < 172800) return 'вчера';
      return Math.round(s/86400)+' дн назад';
    }

    // Быстрые действия — всегда видимые ярлыки (только на доступные модули).
    const QUICK = [
      { go:'documents',      icon:'📄', label:'Новый документ' },
      { go:'counterparties', icon:'🏢', label:'Проверить ИНН' },
      { go:'specialists',    icon:'🎓', label:'Проверить специалиста' },
      { go:'sales',          icon:'📞', label:'Контроль звонка' },
      { go:'licensing',      icon:'🧾', label:'Собрать пакет лицензии' }
    ];

    function renderActivity(){
      const drafts = recentDrafts();
      const quick = QUICK.filter(q=>canSee(q.go));
      const quickHtml = quick.length
        ? `<div class="btn-row" style="flex-wrap:wrap;gap:6px" data-home-quick>` +
            quick.map(q=>`<button type="button" class="btn ghost sm" data-go="${esc(q.go)}">`+
              `<span aria-hidden="true" style="margin-right:5px">${q.icon}</span>${esc(q.label)}</button>`).join('') +
          `</div>`
        : `<span class="muted" style="font-size:12px">Нет доступных быстрых действий в текущем режиме.</span>`;

      let body;
      if (drafts.length){
        const rows = drafts.map(d=>{
          const when = ago(d.at);
          return `<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)">`+
            `<span style="flex:1;min-width:0"><strong style="font-size:13px">${esc(d.title)}</strong>`+
              `<span class="muted" style="display:block;font-size:11.5px">${esc(d.kind)}${when?' · '+esc(when):''}</span></span>`+
            `<button type="button" class="btn ghost sm" data-go="${esc(d.go)}" style="flex:0 0 auto">Открыть</button></div>`;
        }).join('');
        body = `<div style="margin-bottom:12px">${rows}</div>`+
          `<div class="hint" style="margin:0 0 8px">Быстрые действия</div>${quickHtml}`;
      } else {
        body = U.empty('🗂️','Недавних черновиков пока нет — начните с быстрого действия.') + quickHtml;
      }

      return U.card('Последние действия', 'Черновики и генерации из ваших модулей хранятся локально.', body);
    }

    /* ====================================================================
       6. «ЧТО НОВОГО» — ключевые возможности P1–P12
       ==================================================================== */
    const WHATS_NEW = [
      { ic:'📄', t:'Документооборот', s:'Загрузка .docx-шаблонов и генерация по плейсхолдерам, пакеты УЦ.' },
      { ic:'🧾', t:'Лицензирование', s:'Фабрика документов «Спарты» (ООО/ИП), сборка пакета в .zip.' },
      { ic:'🎓', t:'Проверка специалистов', s:'Сверка по правилам НРС/диплома, реестр выпускников УЦ.' },
      { ic:'🧮', t:'Калькулятор счетов', s:'Счёт НОК/СРО с позициями и реквизитами, история.' },
      { ic:'📞', t:'Контроль звонков', s:'Скоринг разговора по рубрике, разбор по критериям.' },
      { ic:'🤖', t:'AI-ассистент продаж', s:'Офлайн RAG по скриптам и базе знаний (BM25, без интернета).' },
      { ic:'📊', t:'РНП-дашборд и аналитика', s:'Конкуренты, SEO-роадмап, интерактивный чеклист 152-ФЗ.' },
      { ic:'🏢', t:'Контрагенты', s:'Пробив по ИНН/ОГРН (DaData/СПАРК), картотека и экспорт.' },
      { ic:'⌘', t:'Командная палитра', s:'⌘K / Ctrl+K — мгновенный переход к модулю или действию.' },
      { ic:'🎛️', t:'Режимы и тема', s:'Руководитель/оператор, светлая/тёмная/системная тема.' }
    ];
    function renderWhatsNew(){
      const items = WHATS_NEW.map(x=>
        `<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line)">`+
          `<span aria-hidden="true" style="flex:0 0 auto;font-size:17px;line-height:1.3">${x.ic}</span>`+
          `<span style="flex:1;min-width:0"><strong style="font-size:13px">${esc(x.t)}</strong>`+
            `<span class="muted" style="display:block;font-size:12px;line-height:1.45">${esc(x.s)}</span></span></div>`
      ).join('');
      const replay = `<div class="btn-row" style="margin-top:12px"><button type="button" class="btn ghost sm" id="home-tour">🎬 Пройти приветственный тур</button></div>`;
      return U.card('Что нового и что внутри',
        'Краткая карта возможностей. Тур можно пройти заново.',
        `<div style="margin-top:2px">${items}</div>${replay}`);
    }

    /* ====================================================================
       УТИЛИТЫ
       ==================================================================== */
    function plural(n, one, few, many){
      const n10=n%10, n100=n%100;
      if(n10===1 && n100!==11) return one;
      if(n10>=2 && n10<=4 && !(n100>=12 && n100<=14)) return few;
      return many;
    }

    /* ====================================================================
       СБОРКА И ПРИВЯЗКА
       ==================================================================== */
    root.innerHTML =
      `<div class="grid cols-2" data-home-grid style="align-items:start">` +
        `<div style="grid-column:1 / -1">${renderHero()}</div>` +
        `<div style="grid-column:1 / -1">${renderDeptCards()}</div>` +
        renderIntegrations() +
        renderPdn() +
        renderActivity() +
        renderWhatsNew() +
      `</div>`;

    // Делегированная навигация по любым [data-go] кнопкам/ссылкам дашборда.
    // Вешаем на ВНУТРЕННИЙ grid (пересоздаётся при каждом mount через innerHTML),
    // а НЕ на постоянный #view — иначе хендлеры накапливались бы при ре-маунте
    // (утечка памяти + кратное срабатывание клика).
    const homeGrid = root.querySelector('[data-home-grid]') || root;
    homeGrid.addEventListener('click', e=>{
      const t = e.target && e.target.closest ? e.target.closest('[data-go]') : null;
      if (t && t.dataset && t.dataset.go){ e.preventDefault(); navigate(t.dataset.go); }
    });

    // «Пройти тур заново» — если оболочка умеет (resetOnboarding).
    const tourBtn = root.querySelector('#home-tour');
    if (tourBtn){
      tourBtn.onclick = ()=>{
        try {
          if (app && typeof app.resetOnboarding === 'function') app.resetOnboarding();
          else if (app && typeof app.startOnboarding === 'function') app.startOnboarding();
          else ctx.toast('Тур недоступен в этой сборке', 'info');
        } catch(e){ try{ ctx.toast('Не удалось запустить тур', 'err'); }catch(_){} }
      };
    }
  }
});

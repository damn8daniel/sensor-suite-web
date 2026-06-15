/* Модуль «Управление» — РНП-дашборд (Реестр Новых Продаж): план/факт по блокам.
   Источник реальной структуры — РНП Сенсор 2026 (обезличено). Работает на моке без ключей:
   тянет window.SEED.rnp, импорт из Google Sheets (ctx.integrations.google_sheets.run('values',{range}))
   и из amoCRM (ctx.integrations.amocrm.run('leads')). Контракт сохранён: id/dept/icon/order/description.

   Доработка: вкладки (дашборд/таблица/импорт), KPI-плитки с прогресс-барами и инверсией
   для долгов/дебиторки (меньше = лучше), фильтры по периоду и блоку, поиск, цветовая шкала
   ok/warn/err, экспорт сводки (CSV + буфер + печать), аккуратная обработка mock/note/error,
   пустые состояния, a11y, микроанимации. Пишется только этот файл. */
SensorApp.register({
  id: 'management', title: 'РНП-дашборд', dept: 'Управление', order: 50,
  icon: '📊', description: 'Реестр новых продаж · план/факт по блокам, импорт из Google Sheets и amoCRM',

  /* Быстрые действия для командной палитры (ядро вызовет mount, затем action.run). */
  actions: [
    { id:'import-sheets', title:'РНП: импорт из Google Sheets', hint:'Подтянуть план/факт из таблицы', icon:'📥',
      run(){ const b=document.querySelector('#rnp-imp-sheets'); if(b) b.click(); } },
    { id:'import-amo', title:'РНП: импорт из amoCRM', hint:'Сумма и кол-во сделок из CRM', icon:'📥',
      run(){ const b=document.querySelector('#rnp-imp-amo'); if(b) b.click(); } },
    { id:'export-csv', title:'РНП: экспорт сводки (CSV)', hint:'Скачать таблицу план/факт', icon:'⤓',
      run(){ const b=document.querySelector('#rnp-export-csv'); if(b) b.click(); } },
    { id:'reconcile-amo', title:'РНП: автосбор и сверка из amoCRM', hint:'Разнос сделок, план/факт, предохранитель', icon:'🛡',
      run(){ const b=document.querySelector('#rnp-recon-run'); if(b) b.click(); } },
  ],

  mount(root, ctx){
    const ui = ctx.ui, esc = ui.escape;

    /* Доп. стили модуля — только ДОБАВЛЕНИЕ правил на существующих токенах
       (hover/focus новых интерактивных плиток и чипов). Вставляется один раз,
       не трогает css/app.css и не переименовывает классы. */
    ensureStyle('rnp-mgmt-style', `
      .rnp-kpi-link{transition:border-color var(--t-fast) var(--ease),box-shadow var(--t-fast) var(--ease),transform var(--t-fast) var(--ease)}
      .rnp-kpi-link:hover{border-color:var(--line-3);box-shadow:var(--shadow-s);transform:translateY(-1px)}
      .rnp-kpi-link:focus-visible{outline:none;box-shadow:var(--ring)}
      .rnp-kpi-link:active{transform:translateY(0)}
      .rnp-att-chip:hover{background:var(--panel-2)!important;border-color:var(--line-3)!important;color:var(--ink)!important}
      .rnp-att-chip:focus-visible{outline:none;box-shadow:var(--ring)}
      .rnp-att-chip:active{transform:translateY(.5px)}
    `);

    /* ── Демо-данные РНП (обезличены: вместо фамилий — роли/блоки) ───────────
       Богаче, чем плоский window.SEED.rnp: есть owner и invert (для долгов).
       Это «глубокий» демонабор; если build-агент положил ctx.data.rnp — он имеет приоритет
       и нормализуется ниже (normalize), чтобы оба формата работали без падений. */
    const SEED_RNP = {
      period: 'Май 2026',
      currency: '₽',
      note: 'демо-данные (РНП Сенсор, обезличено) · не реальные показатели',
      blocks: [
        { name: 'Финансы', owner: 'Финансовый директор', metrics: [
          { name: 'Маржинальная прибыль (месяц)', plan: 14_500_000, fact: 13_120_000, unit: '₽' },
          { name: 'Выручка месячная',              plan: 28_000_000, fact: 26_900_000, unit: '₽' },
          { name: 'Чистая прибыль / выручка',      plan: 18, fact: 16.4, unit: '%' },
        ]},
        { name: 'Продажи (ОП)', owner: 'РОП', metrics: [
          { name: 'Маржа отдела продаж (месяц)',   plan: 9_600_000, fact: 8_900_000, unit: '₽' },
          { name: 'Обработано лидов всего',         plan: 480, fact: 451, unit: 'шт' },
          { name: 'Конверсия МЧС',                  plan: 14, fact: 11, unit: '%' },
          { name: 'Конверсия Аттестация',           plan: 12, fact: 12, unit: '%' },
          { name: 'Продажи по сарафану',            plan: 12, fact: 4, unit: 'шт' },
        ]},
        { name: 'СРО', owner: 'РОП', metrics: [
          { name: 'Сумма продаж СРО (ОП)',          plan: 1_800_000, fact: 1_950_000, unit: '₽' },
          { name: 'Кол-во продаж СРО (ОП)',         plan: 5, fact: 3, unit: 'шт' },
        ]},
        { name: 'Передачи в ОДП', owner: 'РОП', metrics: [
          { name: 'Передано из ОП в ОДП',           plan: 50, fact: 41, unit: 'шт' },
          { name: 'Долги по передаче в ДО',         plan: 0, fact: 1, unit: 'шт', invert: true },
        ]},
        { name: 'Холодный отдел', owner: 'РГ холодняк', metrics: [
          { name: 'Маржа холодняк (месяц)',         plan: 3_400_000, fact: 2_980_000, unit: '₽' },
          { name: 'Переданных лидов (месяц)',       plan: 82, fact: 82, unit: 'шт' },
          { name: 'Кол-во звонков',                 plan: 4_200, fact: 4_010, unit: 'шт' },
        ]},
        { name: 'Допродажи (ОДП)', owner: 'РОП ОДП', metrics: [
          { name: 'Маржа допродаж ОДП1+ОДП2',       plan: 9_700_000, fact: 9_310_000, unit: '₽' },
          { name: 'R/R по отделу',                  plan: 85, fact: 89, unit: '%' },
          { name: 'Средний чек',                    plan: 90_000, fact: 51_000, unit: '₽' },
          { name: 'Касание базы (все отделы)',      plan: 100, fact: 78, unit: '%' },
          { name: '% активной базы',                plan: 6.7, fact: 6.2, unit: '%' },
        ]},
        { name: 'Условный отказ (УО)', owner: 'РГ УО', metrics: [
          { name: 'Принято лидов из УО',            plan: 70, fact: 50, unit: 'шт' },
          { name: 'Сумма продаж по воронке УО',     plan: 600_000, fact: 450_000, unit: '₽' },
        ]},
        { name: 'Дебиторка', owner: 'Юрист', metrics: [
          { name: 'Просроченная дебиторка (сумма)', plan: 0, fact: 1_240_000, unit: '₽', invert: true },
          { name: 'Кол-во просрочек',               plan: 0, fact: 3, unit: 'шт', invert: true },
          { name: 'Общая дебиторка (сумма)',        plan: 3_000_000, fact: 3_400_000, unit: '₽', invert: true },
        ]},
        { name: 'Сегментация базы', owner: 'РОП ОДП', metrics: [
          { name: 'Клиенты A-категории',            plan: 120, fact: 116, unit: 'шт' },
          { name: 'Клиенты S-категории',            plan: 18,  fact: 16,  unit: 'шт' },
          { name: 'Прирост базы (мес.)',            plan: 150, fact: 155, unit: 'шт' },
        ]},
      ],
    };

    /* ── Состояние ──────────────────────────────────────────────────────────
       rnp        — текущий набор (нормализованный),
       baseSeed   — к чему возвращает кнопка «Демо» (учитывает ctx.data.rnp),
       demo/note  — флаг и подпись источника,
       updatedAt  — отметка времени последнего обновления,
       filter     — блок (id) или 'all', q — строка поиска, view — активная вкладка. */
    const baseSeed = (ctx.data && ctx.data.rnp && Array.isArray(ctx.data.rnp.blocks) && ctx.data.rnp.blocks.length)
      ? normalize(ctx.data.rnp) : normalize(SEED_RNP);

    const state = {
      rnp: clone(baseSeed),
      demo: true,
      note: baseSeed.note || 'демо-данные (РНП Сенсор, обезличено)',
      source: 'демо',
      updatedAt: null,
      filter: 'all',
      q: '',
      view: ['table','import','recon'].includes(SensorStore.get('tabs_rnp_view'))
              ? SensorStore.get('tabs_rnp_view') : 'dash',
    };

    /* ── Вкладки ─────────────────────────────────────────────────────────────
       Собственная реализация на штатных классах .pill-tabs/.pill (как в sales.js):
       единый визуальный язык, без зависимости от рекурсивного ui.tabs. Каждая панель
       рисуется своей build-функцией в #rnp-body — соседние не теряют состояние. */
    const TABS = [
      { id:'dash',    label:'Дашборд',           build: buildDash    },
      { id:'table',   label:'Таблица',           build: buildTable   },
      { id:'recon',   label:'Автосбор и сверка', build: buildRecon   },
      { id:'import',  label:'Импорт',            build: buildImport  },
    ];

    /* Состояние под-вкладки «Автосбор и сверка» (живёт в замыкании mount).
       collected — результат последнего разноса сделок; пока null — пустое состояние. */
    const recon = { collected: null, demo: true, note: '', source: '', at: null, busy: false };

    render();

    function render(){
      root.innerHTML = '';
      root.appendChild(buildHero());

      const tabsEl = document.createElement('div');
      tabsEl.className = 'pill-tabs';
      tabsEl.id = 'rnp-tabs';
      tabsEl.setAttribute('role', 'tablist');
      tabsEl.innerHTML = TABS.map(t=>{
        const cnt = t.id==='table' ? ` <span class="t-count badge" style="padding:0 7px">${visibleMetrics().length}</span>` : '';
        return `<button type="button" class="pill${t.id===state.view?' active':''}" role="tab" aria-selected="${t.id===state.view}" data-tab="${t.id}">${esc(t.label)}${cnt}</button>`;
      }).join('');
      tabsEl.addEventListener('click', e=>{
        const p = e.target.closest('.pill'); if(!p) return;
        selectTab(p.dataset.tab);
      });
      root.appendChild(tabsEl);

      const body = document.createElement('div');
      body.id = 'rnp-body';
      root.appendChild(body);
      paintBody();
    }

    function selectTab(id){
      if(!TABS.some(t=>t.id===id) || id===state.view) {
        // повторный клик по активной вкладке — просто перерисуем (полезно после импорта)
        if(id===state.view){ paintBody(); }
        return;
      }
      state.view = id;
      SensorStore.set('tabs_rnp_view', id);
      root.querySelectorAll('#rnp-tabs .pill').forEach(b=>{
        const on = b.dataset.tab===id; b.classList.toggle('active', on); b.setAttribute('aria-selected', on?'true':'false');
      });
      paintBody();
    }

    function paintBody(){
      const body = root.querySelector('#rnp-body'); if(!body) return;
      body.innerHTML = '';
      const tab = TABS.find(t=>t.id===state.view) || TABS[0];
      body.appendChild(tab.build());
      bindFilters(body);
      if(state.view==='dash') bindDash(body);
      if(state.view==='recon') bindRecon(body);
    }

    /* Делегирование кликов по интерактиву дашборда: KPI-плитка «Долги» (jump к блоку)
       и чипы «Точек внимания» (фокус на блок + подсветка показателя поиском).
       Через делегирование — переживает любые перерисовки панели без утечки слушателей. */
    function bindDash(body){
      const onActivate = el => {
        const jump = el.closest('[data-kpi-jump]');
        if(jump){ focusBlock(jump.dataset.kpiJump, ''); return; }
        const chip = el.closest('.rnp-att-chip');
        if(chip){ focusBlock(chip.dataset.attBi, chip.dataset.attName || ''); return; }
      };
      body.addEventListener('click', e=>onActivate(e.target));
      body.addEventListener('keydown', e=>{
        if((e.key==='Enter'||e.key===' ') && e.target.closest('[data-kpi-jump]')){
          e.preventDefault(); onActivate(e.target);
        }
      });
    }

    /* Перейти к конкретному блоку (по индексу) и при наличии — подсветить показатель
       поиском. Скроллим к карточке блока после перерисовки. */
    function focusBlock(idx, metricName){
      const i = String(idx);
      if(!state.rnp.blocks[+i]) return;
      state.filter = i;
      state.q = metricName ? metricName : '';
      refreshActivePanel();
      // прокрутка к карточке блока (если внутри прокручиваемого .content)
      requestAnimationFrame(()=>{
        const card = root.querySelector('.rnp-block');
        if(card && card.scrollIntoView) try{ card.scrollIntoView({behavior:'smooth', block:'nearest'}); }catch(e){ card.scrollIntoView(); }
      });
    }

    /* перерисовать шапку + счётчик таба + активную панель, не сбрасывая вкладку */
    function repaint(){
      const hero = root.querySelector('#rnp-hero');
      if(hero){ hero.replaceWith(buildHero()); }
      else { render(); return; }
      const cnt = root.querySelector('#rnp-tabs [data-tab="table"] .t-count');
      if(cnt) cnt.textContent = visibleMetrics().length;
      paintBody();
    }

    /* ════════════════════════ ШАПКА (hero) ════════════════════════ */
    function buildHero(){
      const wrap = document.createElement('div');
      wrap.id = 'rnp-hero';
      const periods = collectPeriods();
      const sourceBadge = state.demo
        ? `<span class="badge warn dot" title="${esc(state.note)}">демо-данные</span>`
        : `<span class="badge ok dot" title="${esc(state.note)}">импортировано · ${esc(state.source)}</span>`;
      const stamp = state.updatedAt
        ? `<span class="badge" title="Последнее обновление">обновлено ${esc(fmtTime(state.updatedAt))}</span>`
        : '';

      const periodControl = periods.length > 1
        ? `<select id="rnp-period" aria-label="Период" style="width:auto;min-width:150px">
             ${periods.map(p=>`<option value="${esc(p)}"${p===state.rnp.period?' selected':''}>${esc(p)}</option>`).join('')}
           </select>`
        : `<span class="badge">${esc(state.rnp.period || '—')}</span>`;

      wrap.innerHTML = ui.card('РНП — реестр новых продаж',
        'Сводка план/факт по блокам за период. Импортируйте свежие цифры из Google Sheets или amoCRM — без ключей покажутся обезличенные демо-данные. Для долгов и дебиторки шкала инвертирована: меньше факта — лучше.',
        `<div class="btn-row">
           <button class="btn primary" id="rnp-imp-sheets">📥 Импорт из Google Sheets</button>
           <button class="btn" id="rnp-imp-amo">📥 Из amoCRM</button>
           <button class="btn" id="rnp-export-csv" title="Скачать сводку в CSV">⤓ Экспорт CSV</button>
           <button class="btn ghost sm" id="rnp-copy" title="Скопировать сводку в буфер">⧉ Копировать</button>
           <button class="btn ghost sm" id="rnp-print" title="Печать сводки">🖨 Печать</button>
           <button class="btn ghost sm" id="rnp-reset" title="Вернуть демо-данные">↺ Демо</button>
           <span class="spacer" style="flex:1"></span>
           <span class="rnp-meta-chips" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
             ${periodControl} ${stamp} ${sourceBadge}
           </span>
         </div>`);

      // привязка действий
      const $ = s => wrap.querySelector(s);
      $('#rnp-imp-sheets').onclick = importSheets;
      $('#rnp-imp-amo').onclick     = importAmo;
      $('#rnp-export-csv').onclick  = exportCsv;
      $('#rnp-copy').onclick         = copySummary;
      $('#rnp-print').onclick        = printSummary;
      $('#rnp-reset').onclick        = resetDemo;
      const periodSel = $('#rnp-period');
      if(periodSel) periodSel.onchange = e => switchPeriod(e.target.value);
      return wrap;
    }

    /* ════════════════════════ ВКЛАДКА «ДАШБОРД» ════════════════════════ */
    function buildDash(){
      const frag = document.createDocumentFragment();
      frag.appendChild(htmlToEl(renderKpi()));
      const blocks = visibleBlocks();
      if(!blocks.length){
        frag.appendChild(htmlToEl(ui.card('Блоки', '',
          ui.empty('🔍', state.q
            ? 'По запросу «'+esc(state.q)+'» ничего не найдено.'
            : 'Нет блоков для отображения.',
            `<button class="btn sm" id="rnp-clear-filter">Сбросить фильтры</button>`))));
        const c = frag.querySelector('#rnp-clear-filter');
        if(c) c.onclick = clearFilters;
        return frag;
      }
      blocks.forEach(b => frag.appendChild(htmlToEl(renderBlockCard(b))));
      return frag;
    }

    /* KPI-плитки: среднее выполнение, объём (блоки·показатели), распределение статусов,
       и отдельная плитка по долгам/дебиторке (инверсия). Все с прогресс-баром/цветом. */
    function renderKpi(){
      const all = visibleMetrics();
      const okN   = all.filter(m=>statusOf(m)==='ok').length;
      const warnN = all.filter(m=>statusOf(m)==='warn').length;
      const errN  = all.filter(m=>statusOf(m)==='err').length;
      // среднее выполнение считаем по «нормальным» метрикам (для invert процент не аддитивен)
      const norm = all.filter(m=>!m.invert);
      const avg = norm.length ? Math.round(norm.reduce((s,m)=>s+clampPct(scorePct(m)),0)/norm.length) : 0;
      const avgCls = colorFor(avg>=95?'ok':avg>=80?'warn':'err');

      // долги: метрики с invert — сколько «горит»
      const debts = all.filter(m=>m.invert);
      const debtBad = debts.filter(m=>statusOf(m)==='err').length;
      const debtCls = colorFor(debtBad ? 'err' : debts.some(m=>statusOf(m)==='warn') ? 'warn' : 'ok');

      const tile = (label, valueHtml, opts) => {
        opts = opts || {};
        const bar = opts.pct != null
          ? `<div class="bar" style="margin-top:14px" role="progressbar" aria-valuenow="${opts.pct}" aria-valuemin="0" aria-valuemax="100">
               <span style="width:${clampPct(opts.pct)}%;background:${opts.color||'var(--accent)'}"></span>
             </div>` : '';
        // опциональный data-jump делает плитку кликабельной (переход к блоку-фильтру)
        const jump = opts.jump != null
          ? ` data-kpi-jump="${esc(String(opts.jump))}" role="button" tabindex="0" title="Показать блок «${esc(opts.jumpLabel||'')}»" style="cursor:pointer"` : '';
        return `<div class="card rnp-kpi${jump?' rnp-kpi-link':''}" style="padding:15px 17px;display:flex;flex-direction:column"${jump}>
            <div class="hint" style="margin:0 0 7px;display:flex;align-items:center;gap:6px">${esc(label)}${opts.tag||''}</div>
            <div class="rnp-kpi-val" style="font-size:26px;font-weight:700;line-height:1;color:${opts.color||'var(--ink)'}">${valueHtml}</div>
            ${opts.sub?`<div class="hint" style="margin:7px 0 0">${opts.sub}</div>`:''}
            ${bar}
          </div>`;
      };

      const distSub =
        `<span class="badge ok" style="margin-right:4px">${okN} в плане</span>` +
        `<span class="badge warn" style="margin-right:4px">${warnN} риск</span>` +
        `<span class="badge err">${errN} провал</span>`;

      // индекс блока с инверсными показателями — чтобы плитка «Долги» вела прямо к нему
      const debtBlockIdx = state.rnp.blocks.findIndex(b=>(b.metrics||[]).some(m=>m.invert));
      const debtJump = (debtBad || debts.some(m=>statusOf(m)==='warn')) && debtBlockIdx>=0
        ? { jump: debtBlockIdx, jumpLabel: state.rnp.blocks[debtBlockIdx].name } : {};

      // 4 плитки в один ряд (repeat(4,1fr)) — убираем «осиротевшую» плитку и пустоту справа.
      // На узких экранах раскладка естественно переносит плитки (min-width в auto-fit).
      return `<div class="grid rnp-kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-bottom:16px;align-items:stretch">
        ${tile('Среднее выполнение плана', avg+'%', { pct:avg, color:avgCls, sub:`по ${norm.length} прямым показателям` })}
        ${tile('Охват сводки', `${visibleBlocks().length}<span class="hint" style="font-size:14px;font-weight:500"> бл.</span> · ${all.length}<span class="hint" style="font-size:14px;font-weight:500"> пок.</span>`,
                { sub:'блоков · показателей' })}
        ${tile('Распределение статусов', `${okN}<span class="hint" style="font-size:15px;font-weight:500"> / </span>${warnN}<span class="hint" style="font-size:15px;font-weight:500"> / </span>${errN}`,
                { sub:distSub })}
        ${tile('Долги и дебиторка', debtBad ? `${debtBad}<span class="hint" style="font-size:15px;font-weight:500"> в зоне риска</span>` : 'в норме',
                Object.assign({ color:debtCls,
                  sub: debts.length ? `${debts.length} инверсных показателей (меньше — лучше)` : 'инверсных показателей нет',
                  tag: debtBad ? '<span class="badge err" style="font-size:10px;padding:0 6px">!</span>' : '' }, debtJump))}
      </div>` + renderAttention() + renderFilters();
    }

    /* «Точки внимания» — горизонтальная лента худших показателей по всей сводке.
       Сортируем провалы и риски (по «недобору» относительно плана), показываем топ-5
       чипами; клик по чипу фильтрует дашборд на блок и подсвечивает показатель поиском.
       Когда всё в плане — короткое позитивное состояние (премиальный акцент). */
    function renderAttention(){
      const flagged = [];
      state.rnp.blocks.forEach((b, bi)=>{
        (b.metrics||[]).forEach(m=>{
          const st = statusOf(m);
          if(st==='ok') return;
          flagged.push({ block:b.name, bi, m, st, gap:100-clampPct(scorePct(m)) });
        });
      });
      if(!flagged.length){
        return `<div class="card rnp-attention rnp-attention-ok" style="padding:13px 16px;margin-bottom:16px;display:flex;align-items:center;gap:11px;
              border-left:3px solid var(--ok);background:linear-gradient(0deg,var(--ok-soft),transparent)">
            <span style="font-size:20px;line-height:1">✓</span>
            <div>
              <div style="font-weight:600;color:var(--ok-d)">Все показатели в плане</div>
              <div class="hint" style="margin:2px 0 0">Ни одного риска или провала в текущей сводке — отличный период.</div>
            </div>
          </div>`;
      }
      // провалы вперёд, затем по величине недобора
      flagged.sort((a,b)=> (a.st===b.st ? b.gap-a.gap : (a.st==='err'?-1:1)));
      const top = flagged.slice(0,5);
      const more = flagged.length-top.length;
      const chips = top.map(f=>{
        const col = colorFor(f.st);
        const arrow = f.m.invert ? ' ↓' : '';
        return `<button type="button" class="rnp-att-chip" data-att-bi="${f.bi}" data-att-name="${esc(f.m.name)}"
            title="${esc(f.block)} · план ${esc(fmt(f.m.plan,f.m.unit))} / факт ${esc(fmt(f.m.fact,f.m.unit))}"
            style="display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line-2);background:var(--panel);
                   border-radius:var(--radius-pill);padding:5px 11px 5px 9px;cursor:pointer;font:inherit;font-size:12.5px;color:var(--ink-2);
                   max-width:280px;transition:background var(--t-fast) var(--ease),border-color var(--t-fast) var(--ease)">
            <span aria-hidden="true" style="width:7px;height:7px;border-radius:50%;background:${col};flex:0 0 7px"></span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.m.name)}${arrow}</span>
            <span class="mono" style="color:${col};font-weight:600;font-size:11.5px">${scorePct(f.m)}%</span>
          </button>`;
      }).join('');
      const errC = flagged.filter(f=>f.st==='err').length;
      const warnC = flagged.length-errC;
      return `<div class="card rnp-attention" style="padding:13px 16px;margin-bottom:16px;border-left:3px solid ${errC?'var(--err)':'var(--warn)'}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <span style="font-size:15px;line-height:1">⚠</span>
            <span style="font-weight:600;color:var(--ink)">Точки внимания</span>
            ${errC?`<span class="badge err">${errC} провал</span>`:''}
            ${warnC?`<span class="badge warn">${warnC} риск</span>`:''}
            <span class="spacer" style="flex:1"></span>
            <span class="hint" style="margin:0">отстают от плана сильнее всего · клик — открыть блок</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${chips}
            ${more>0?`<span class="hint" style="margin:0 0 0 2px">и ещё ${more}</span>`:''}
          </div>
        </div>`;
    }

    /* строка фильтров: блок + поиск */
    function renderFilters(){
      const blocks = state.rnp.blocks;
      const opts = `<option value="all">Все блоки (${blocks.length})</option>` +
        blocks.map((b,i)=>`<option value="${i}"${String(i)===String(state.filter)?' selected':''}>${esc(b.name)} (${(b.metrics||[]).length})</option>`).join('');
      return `<div class="card rnp-filters" style="padding:12px 16px;margin-bottom:16px">
        <div class="grid cols-2" style="gap:12px;align-items:end">
          ${ui.field('Блок', `<select id="rnp-filter-block" aria-label="Фильтр по блоку">${opts}</select>`)}
          ${ui.field('Поиск по показателям', `<input id="rnp-filter-q" type="search" placeholder="напр. «маржа», «конверсия», «дебитор»" value="${esc(state.q)}" spellcheck="false">`)}
        </div>
      </div>`;
    }

    /* карточка блока с показателями (grid.cols-3) */
    function renderBlockCard(b){
      const metrics = filterMetrics(b.metrics||[]);
      const blockScore = blockAvg(b);
      const blockCls = colorFor(blockScore>=95?'ok':blockScore>=80?'warn':'err');
      const head =
        `<h3>${esc(b.name)}
           ${b.owner?`<span class="badge" style="vertical-align:1px">${esc(b.owner)}</span>`:''}
           <span class="spacer" style="flex:1"></span>
           <span class="badge" style="color:${blockCls}" title="Среднее по прямым показателям блока">${blockScore}%</span>
         </h3>`;
      if(!metrics.length){
        return `<div class="card rnp-block" style="margin-bottom:16px">${head}
          ${ui.empty('🔍','В этом блоке нет показателей под текущий фильтр.')}
        </div>`;
      }
      const tiles = metrics.map(renderMetricTile).join('');
      return `<div class="card rnp-block" style="margin-bottom:16px">${head}
        <div class="grid cols-3 rnp-metric-grid" style="margin-top:6px">${tiles}</div>
      </div>`;
    }

    /* плитка одного показателя: %, статус-бейдж, план/факт, прогресс-бар.
       Для invert показываем явный маркер «инверсия» и считаем бар «заполненности риска». */
    function renderMetricTile(m){
      const st = statusOf(m);
      const col = colorFor(st);
      const stLabel = st==='ok'?'в плане':st==='warn'?'риск':'провал';
      const display = scorePct(m);          // что показываем крупным числом
      const barPct  = clampPct(barFill(m)); // заполнение прогресс-бара
      const invMark = m.invert
        ? `<span class="badge info" title="Инверсия: меньше факта — лучше (долги/дебиторка)" style="margin-left:auto">↓ лучше</span>` : '';
      const delta = deltaLabel(m);
      return `<div class="card rnp-metric" style="padding:13px 15px;box-shadow:none">
        <div class="rnp-metric-name hint" style="margin:0 0 9px;min-height:2.6em;color:var(--ink-2)">${esc(m.name)}</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <span style="font-size:22px;font-weight:700;line-height:1;color:${col}">${display}%</span>
          <span class="badge ${st}">${stLabel}</span>
          ${invMark}
        </div>
        <div class="mono" style="color:var(--ink-3);font-size:11.5px">план ${fmt(m.plan,m.unit)} · факт ${fmt(m.fact,m.unit)}${delta?` · ${delta}`:''}</div>
        <div class="bar" style="margin-top:9px" role="progressbar" aria-valuenow="${barPct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(m.name)}">
          <span style="width:${barPct}%;background:${col}"></span>
        </div>
      </div>`;
    }

    /* ════════════════════════ ВКЛАДКА «ТАБЛИЦА» ════════════════════════ */
    function buildTable(){
      const frag = document.createDocumentFragment();
      frag.appendChild(htmlToEl(renderFilters()));   // те же фильтры, что и на дашборде
      const rows = [];
      visibleBlocks().forEach(b => filterMetrics(b.metrics||[]).forEach(m => rows.push({ block:b.name, m })));
      const cols = [
        { key:'block', label:'Блок' },
        { key:'name',  label:'Показатель' },
        { key:'plan',  label:'План', align:'right', mono:true },
        { key:'fact',  label:'Факт', align:'right', mono:true },
        { key:'pct',   label:'%',    align:'right', mono:true },
        { key:'status',label:'Статус' },
      ];
      const tableRows = rows.map(({block,m})=>{
        const st = statusOf(m);
        return {
          block,
          name: m.name + (m.invert ? ' ↓' : ''),
          plan: fmt(m.plan, m.unit),
          fact: fmt(m.fact, m.unit),
          pct:  scorePct(m) + '%',
          status: ui.badge(st==='ok'?'в плане':st==='warn'?'риск':'провал', st),
        };
      });
      const tbl = ui.table(tableRows, cols.map(c => ({
        ...c,
        render: (c.key==='status') ? (v=>v) : undefined,
      })), {
        maxHeight:'460px',
        empty: state.q ? 'По запросу «'+state.q+'» ничего не найдено.' : 'Нет показателей под текущий фильтр.',
        caption: `${rows.length} показателей · ${visibleBlocks().length} блоков · период «${state.rnp.period||'—'}»`,
      });
      frag.appendChild(htmlToEl(ui.card('Сводная таблица',
        'Полный список план/факт с расчётом выполнения. «↓» у показателя — инверсия (долги/дебиторка).',
        tbl)));
      return frag;
    }

    /* ════════════════════════ ВКЛАДКА «ИМПОРТ» ════════════════════════ */
    function buildImport(){
      const frag = document.createDocumentFragment();
      const gs  = integ('google_sheets');
      const amo = integ('amocrm');
      const stateBadge = (i, def) => {
        if(!i) return ui.badge('не подключена','warn');
        if(i.configured && i.configured()) return ui.badge('ключи заданы','ok');
        const webBlocked = def && def.webCapable === false && ctx.env === 'web';
        return ui.badge(webBlocked ? 'только desktop · демо' : 'нет ключей · демо', 'warn');
      };

      frag.appendChild(htmlToEl(ui.card('Импорт данных РНП',
        'Подтяните свежие цифры из источников. Без ключей или при недоступности (CORS) приложение покажет обезличенные демо-данные и пояснит причину.',
        `<div class="grid cols-2" style="gap:14px">
           <div class="card" style="box-shadow:none;background:var(--panel-2)">
             <h3 style="font-size:14px">Google Sheets ${stateBadge(gs, defOf('google_sheets'))}</h3>
             <p class="hint">Лист со столбцами: Блок · Показатель · План · Факт. Шапка распознаётся автоматически. Диапазон берётся по имени периода.</p>
             ${ui.field('Диапазон (range)', `<input id="rnp-range" value="${esc(rangeFor())}" spellcheck="false">`)}
             <div class="btn-row"><button class="btn primary" id="rnp-imp-sheets-2">📥 Импортировать</button></div>
           </div>
           <div class="card" style="box-shadow:none;background:var(--panel-2)">
             <h3 style="font-size:14px">amoCRM ${stateBadge(amo, defOf('amocrm'))}</h3>
             <p class="hint">Берём сделки (leads), считаем сумму выигранных и общее число — обновляем факт по марже и лидам в блоке «Продажи». amoCRM без CORS: из браузера будут демо-данные.</p>
             <div class="btn-row"><button class="btn primary" id="rnp-imp-amo-2">📥 Импортировать сделки</button></div>
           </div>
         </div>`)));

      // лог импорта
      frag.appendChild(htmlToEl(`<div id="rnp-imp-log"></div>`));

      const ds = frag.querySelector('#rnp-imp-sheets-2');
      const da = frag.querySelector('#rnp-imp-amo-2');
      if(ds) ds.onclick = ()=>importSheets(frag.querySelector('#rnp-range') ? frag.querySelector('#rnp-range').value : null);
      if(da) da.onclick = importAmo;
      return frag;
    }

    /* ════════════════════════ ВКЛАДКА «АВТОСБОР И СВЕРКА» ════════════════════════
       Прототип на МОК-данных amoCRM (реального ключа нет → ядро отдаёт mock()).
       Сценарий: «Собрать из amoCRM» → ctx.integrations.amocrm.run('leads') →
       разнос сделок по продуктам и регионам → сопоставление выручки с планом из
       window.SEED.rnp → таблица «План / Факт / Δ» → «предохранитель»: список
       несостыковок (непроставленные платежи, плательщик ≠ получатель, отставание
       от ран-рейта) с бейджами риска. Всё помечено как демонстрация (mock). */
    function buildRecon(){
      const frag = document.createDocumentFragment();
      const amo = integ('amocrm');
      const def = defOf('amocrm');
      const hasKeys = amo && amo.configured && amo.configured();
      const webBlocked = def && def.webCapable === false && ctx.env === 'web';
      const modeBadge = hasKeys && !webBlocked
        ? ui.badge('ключи заданы','ok')
        : ui.badge(webBlocked ? 'только desktop · демо-данные (mock)' : 'нет ключей · демо-данные (mock)','warn');

      // Шапка под-вкладки + кнопка запуска.
      frag.appendChild(htmlToEl(ui.card(`Автосбор и сверка ${modeBadge}`,
        'Тянет сделки из amoCRM (leads), разносит их по продуктам и регионам и сверяет фактическую выручку с планом РНП. «Предохранитель» подсвечивает несостыковки: непроставленные платежи, расхождение плательщик ≠ получатель и отставание от ран-рейта. Без ключей amoCRM работает на обезличенных демо-данных (mock) — цифры показательные, не реальные.',
        `<div class="btn-row">
           <button class="btn primary" id="rnp-recon-run">🛡 Собрать из amoCRM</button>
           <button class="btn ghost sm" id="rnp-recon-clear" title="Очистить результат сверки"${recon.collected?'':' disabled'}>↺ Сбросить</button>
           <span class="spacer" style="flex:1"></span>
           ${recon.collected
              ? `<span class="badge ${recon.demo?'warn dot':'ok dot'}" title="${esc(recon.note||'')}">${recon.demo?'демо-данные (mock)':'amoCRM · '+esc(recon.source)}</span>`
                + (recon.at?` <span class="badge" title="Время сбора">собрано ${esc(fmtTime(recon.at))}</span>`:'')
              : ''}
         </div>`)));

      // Тело результата сверки (перерисовывается отдельно после сбора).
      const out = document.createElement('div');
      out.id = 'rnp-recon-out';
      out.appendChild(buildReconBody());
      frag.appendChild(out);
      return frag;
    }

    /* Тело результата: либо пустое состояние, либо KPI + таблица «План/Факт/Δ»
       + разносы по продуктам/регионам + предохранитель. */
    function buildReconBody(){
      const frag = document.createDocumentFragment();
      if(recon.busy){
        frag.appendChild(htmlToEl(ui.card('Сбор данных…', '', ui.skeleton({lines:4, widths:['90%','70%','80%','55%']}))));
        return frag;
      }
      const c = recon.collected;
      if(!c){
        frag.appendChild(htmlToEl(ui.card('Сверка ещё не запускалась',
          '', ui.empty('🛡',
            'Нажмите «Собрать из amoCRM», чтобы разнести сделки по продуктам и регионам и сверить факт с планом. Без ключей покажутся демо-данные (mock).',
            `<button class="btn sm primary" id="rnp-recon-run-2">🛡 Собрать из amoCRM</button>`))));
        return frag;
      }

      // ── KPI-строка сверки ───────────────────────────────────────────────────
      frag.appendChild(htmlToEl(reconKpi(c)));

      // ── Таблица «План / Факт / Δ» по продуктам ─────────────────────────────
      frag.appendChild(htmlToEl(reconPlanFactCard(c)));

      // ── Разнос по регионам ─────────────────────────────────────────────────
      frag.appendChild(htmlToEl(reconRegionCard(c)));

      // ── Предохранитель: несостыковки ───────────────────────────────────────
      frag.appendChild(htmlToEl(reconFuseCard(c)));
      return frag;
    }

    function reconKpi(c){
      const wonPct = c.dealsTotal ? Math.round(c.dealsWon/c.dealsTotal*100) : 0;
      const rr = c.runRate;                       // {factToDate, target, pct, days, monthDays}
      const rrCls = colorFor(rr.pct>=95?'ok':rr.pct>=80?'warn':'err');
      const fuseCls = colorFor(c.fuses.some(f=>f.risk==='err')?'err':c.fuses.some(f=>f.risk==='warn')?'warn':'ok');
      const tile = (label, valHtml, sub, opts)=>{
        opts = opts||{};
        const bar = opts.pct!=null
          ? `<div class="bar" style="margin-top:14px" role="progressbar" aria-valuenow="${clampPct(opts.pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${clampPct(opts.pct)}%;background:${opts.color||'var(--accent)'}"></span></div>`
          : '';
        return `<div class="card" style="padding:15px 17px;display:flex;flex-direction:column">
            <div class="hint" style="margin:0 0 7px">${esc(label)}</div>
            <div style="font-size:24px;font-weight:700;line-height:1;color:${opts.color||'var(--ink)'}">${valHtml}</div>
            ${sub?`<div class="hint" style="margin:7px 0 0">${sub}</div>`:''}
            ${bar}
          </div>`;
      };
      return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-bottom:16px;align-items:stretch">
        ${tile('Собрано сделок', `${c.dealsTotal}<span class="hint" style="font-size:14px;font-weight:500"> шт</span>`,
            `${c.dealsWon} выиграно · ${c.dealsOpen} в работе · ${c.dealsLost} отказ`, { pct:wonPct, color:colorFor(wonPct>=50?'ok':wonPct>=30?'warn':'err') })}
        ${tile('Выручка (выигранные)', fmt(c.wonSum,'₽'), `${c.products.length} продуктов · ${c.regions.length} регионов`)}
        ${tile('Ран-рейт месяца', rr.pct+'%',
            `прогноз ${fmt(rr.projected,'₽')} из плана ${fmt(rr.monthPlan,'₽')} · день ${rr.days}/${rr.monthDays}`, { pct:rr.pct, color:rrCls })}
        ${tile('Предохранитель', c.fuses.length ? `${c.fuses.length}<span class="hint" style="font-size:14px;font-weight:500"> несост.</span>` : 'чисто',
            c.fuses.length ? `${c.fuses.filter(f=>f.risk==='err').length} критичных · ${c.fuses.filter(f=>f.risk==='warn').length} рисков` : 'несостыковок не найдено',
            { color:fuseCls })}
      </div>`;
    }

    function reconPlanFactCard(c){
      const cols = [
        { key:'product', label:'Продукт' },
        { key:'cnt',     label:'Сделок', align:'right', mono:true },
        { key:'plan',    label:'План',   align:'right', mono:true },
        { key:'fact',    label:'Факт',   align:'right', mono:true },
        { key:'delta',   label:'Δ',      align:'right', mono:true },
        { key:'pct',     label:'%',      align:'right', mono:true },
        { key:'status',  label:'Статус' },
      ];
      const rows = c.products.map(p=>{
        const d = p.fact - p.plan;
        const pct = p.plan>0 ? capPct(Math.round(p.fact/p.plan*100)) : (p.fact>0?100:0);
        const st = pct>=95?'ok':pct>=80?'warn':'err';
        const dCol = d>=0 ? 'var(--ok-d)' : 'var(--err-d)';
        return {
          product: p.name,
          cnt: String(p.cnt),
          plan: p.plan>0 ? fmt(p.plan,'₽') : '—',
          fact: fmt(p.fact,'₽'),
          delta: `<span style="color:${dCol}">${d>=0?'+':'−'}${fmt(Math.abs(d),'₽')}</span>`,
          pct: pct+'%',
          status: ui.badge(st==='ok'?'в плане':st==='warn'?'риск':'провал', st),
        };
      });
      // Итоговая строка.
      const totPlan = c.products.reduce((s,p)=>s+p.plan,0);
      const totFact = c.products.reduce((s,p)=>s+p.fact,0);
      const totD = totFact-totPlan;
      const totPct = totPlan>0 ? capPct(Math.round(totFact/totPlan*100)) : (totFact>0?100:0);
      rows.push({
        product: 'ИТОГО',
        cnt: String(c.dealsWon),
        plan: fmt(totPlan,'₽'),
        fact: fmt(totFact,'₽'),
        delta: `<span style="color:${totD>=0?'var(--ok-d)':'var(--err-d)'};font-weight:600">${totD>=0?'+':'−'}${fmt(Math.abs(totD),'₽')}</span>`,
        pct: `<b>${totPct}%</b>`,
        status: ui.badge(totPct>=95?'в плане':totPct>=80?'риск':'провал', totPct>=95?'ok':totPct>=80?'warn':'err'),
      });
      const tbl = ui.table(rows, cols.map(col=>({
        ...col,
        render: ['delta','pct','status'].includes(col.key) ? (v=>v) : undefined,
      })), {
        maxHeight:'380px',
        caption: `Выручка выигранных сделок против плана РНП по продуктам · период «${esc(state.rnp.period||'—')}»`,
        empty:'Нет сделок для разноса.',
      });
      return ui.card('План / Факт / Δ по продуктам',
        'План берётся из блоков РНП (выручка/маржа/сумма), факт — сумма выигранных сделок amoCRM по каждому продукту. Δ — отклонение факта от плана.',
        tbl);
    }

    function reconRegionCard(c){
      const cols = [
        { key:'region', label:'Регион' },
        { key:'cnt',    label:'Сделок', align:'right', mono:true },
        { key:'won',    label:'Выиграно', align:'right', mono:true },
        { key:'sum',    label:'Выручка', align:'right', mono:true },
        { key:'share',  label:'Доля',   align:'right', mono:true },
      ];
      const totSum = c.regions.reduce((s,r)=>s+r.sum,0) || 1;
      const rows = c.regions.map(r=>({
        region: r.name,
        cnt: String(r.cnt),
        won: String(r.won),
        sum: fmt(r.sum,'₽'),
        share: Math.round(r.sum/totSum*100)+'%',
      }));
      const tbl = ui.table(rows, cols, {
        maxHeight:'320px',
        caption: 'Регион определяется эвристикой по сделке/компании (демо-разметка). В боевой версии — из поля сделки/компании amoCRM.',
        empty:'Нет данных по регионам.',
      });
      return ui.card('Разнос по регионам',
        'Распределение собранных сделок и выручки по регионам — для контроля географии продаж.',
        tbl);
    }

    function reconFuseCard(c){
      if(!c.fuses.length){
        return `<div class="card" style="padding:13px 16px;display:flex;align-items:center;gap:11px;
              border-left:3px solid var(--ok);background:linear-gradient(0deg,var(--ok-soft),transparent)">
            <span style="font-size:20px;line-height:1">✓</span>
            <div>
              <div style="font-weight:600;color:var(--ok-d)">Предохранитель: несостыковок не найдено</div>
              <div class="hint" style="margin:2px 0 0">Все выигранные сделки с проставленным платежом, плательщик совпадает с получателем, ран-рейт в норме.</div>
            </div>
          </div>`;
      }
      const errC = c.fuses.filter(f=>f.risk==='err').length;
      const warnC = c.fuses.length-errC;
      const items = c.fuses.map(f=>{
        const col = colorFor(f.risk);
        const lab = f.risk==='err'?'критично':'риск';
        return `<div class="card" style="padding:11px 14px;box-shadow:none;border-left:3px solid ${col};display:flex;gap:11px;align-items:flex-start">
            <span class="badge ${f.risk}" style="flex:0 0 auto;margin-top:1px">${lab}</span>
            <div style="min-width:0">
              <div style="font-weight:600;color:var(--ink)">${esc(f.title)}</div>
              <div class="hint" style="margin:3px 0 0">${esc(f.detail)}</div>
              ${f.ref?`<div class="mono" style="color:var(--ink-3);font-size:11px;margin-top:4px">${esc(f.ref)}</div>`:''}
            </div>
          </div>`;
      }).join('');
      return `<div class="card" style="border-left:3px solid ${errC?'var(--err)':'var(--warn)'}">
          <h3>🛡 Предохранитель — несостыковки
            ${errC?`<span class="badge err" style="vertical-align:1px">${errC} критич.</span>`:''}
            ${warnC?`<span class="badge warn" style="vertical-align:1px">${warnC} риск</span>`:''}
          </h3>
          <p class="hint">Автоматические проверки по собранным сделкам. Демо-разметка на mock-данных amoCRM — в боевой версии правила те же, источник реальный.</p>
          <div class="grid" style="gap:10px;margin-top:6px">${items}</div>
        </div>`;
    }

    /* Привязка кнопок под-вкладки (делегирование переживает перерисовку тела). */
    function bindRecon(scope){
      scope.addEventListener('click', e=>{
        if(e.target.closest('#rnp-recon-run') || e.target.closest('#rnp-recon-run-2')){ runReconcile(); return; }
        if(e.target.closest('#rnp-recon-clear')){ clearReconcile(); return; }
      });
    }

    function clearReconcile(){
      recon.collected = null; recon.note=''; recon.source=''; recon.at=null; recon.busy=false;
      refreshActivePanel();
    }

    /* Перерисовать панель «Автосбор» целиком (шапка под-вкладки несёт бейджи источника
       и времени сбора, поэтому обновляем весь body таба, а не только #rnp-recon-out).
       paintBody переинициализирует делегированные обработчики bindRecon. */
    function repaintRecon(){
      if(state.view!=='recon'){ return; }
      paintBody();
    }

    /* Главный сценарий: собрать сделки из amoCRM (mock без ключей), разнести и сверить. */
    async function runReconcile(){
      const integration = integ('amocrm');
      if(!integration){ ctx.toast('Интеграция amoCRM не подключена','err'); return; }
      recon.busy = true;
      repaintRecon();
      try{
        const res = await integration.run('leads');
        const leads = pickLeads(res) || [];
        if(!leads.length){
          recon.busy=false;
          ctx.toast('В ответе amoCRM нет сделок','err');
          repaintRecon();
          return;
        }
        recon.collected = reconcileLeads(leads);
        recon.demo = !!res.mock;
        recon.source = res.mock ? 'демо' : 'amoCRM';
        recon.note = res.note || (res.mock ? 'демо-данные (mock) — amoCRM без ключей/CORS' : 'данные из amoCRM');
        recon.at = new Date();
        recon.busy = false;
        repaintRecon();
        const detail = `${recon.collected.dealsTotal} сделок · ${recon.collected.dealsWon} выиграно · ${recon.collected.fuses.length} несостыковок`;
        if(res.error){ ctx.toast('amoCRM: '+res.error,'err'); }
        else if(res.mock){ ctx.toast('amoCRM: показаны демо-данные (mock) — '+detail,'info'); }
        else { ctx.toast('amoCRM: собрано и сверено ('+detail+') ✓','ok'); }
      }catch(e){
        recon.busy=false;
        ctx.toast('Ошибка сбора: '+(e&&e.message||e),'err');
        repaintRecon();
      }
    }

    /* ── Разбор и сверка сделок ──────────────────────────────────────────────
       Чистая функция: из массива leads строит {продукты, регионы, ран-рейт, предохранитель}.
       Регион и «плательщик» в mock-данных amoCRM явно не заданы (и файл интеграции
       не трогаем) — поэтому выводим их детерминированной эвристикой из имеющихся полей
       (название/компания/статус) и честно помечаем как демо-разметку. */
    function reconcileLeads(leads){
      const cfVal = (l, code)=>{
        const arr = (l.custom_fields_values||[]);
        const f = arr.find(x=> String(x.field_code||'').toUpperCase()===code || String(x.field_name||'').toLowerCase().includes(code.toLowerCase()));
        if(!f || !Array.isArray(f.values) || !f.values[0]) return null;
        return f.values[0].value;
      };
      const isWon = l => l.status_id===142 || /won|оплач|закры реализ|выигр|успешно реализ/i.test(String(l.status||'').toLowerCase());
      const isLost = l => l.status_id===143 || /не реализ|отказ|lost/i.test(String(l.status||'').toLowerCase());

      // Разнос по продуктам (из custom field PRODUCT, иначе эвристика по имени).
      const prodMap = new Map();
      const regMap = new Map();
      let wonSum=0, dealsWon=0, dealsLost=0, dealsOpen=0;
      const fuses = [];

      leads.forEach(l=>{
        const product = String(cfVal(l,'PRODUCT') || guessProduct(l.name) || 'Прочее').trim();
        const region  = guessRegion(l);
        const price   = Number(l.price)||0;
        const won = isWon(l), lost = isLost(l);
        if(won) dealsWon++; else if(lost) dealsLost++; else dealsOpen++;

        // продукты
        if(!prodMap.has(product)) prodMap.set(product, { name:product, cnt:0, fact:0, plan:0 });
        const pm = prodMap.get(product); pm.cnt++; if(won) pm.fact += price;

        // регионы
        if(!regMap.has(region)) regMap.set(region, { name:region, cnt:0, won:0, sum:0 });
        const rm = regMap.get(region); rm.cnt++; if(won){ rm.won++; rm.sum += price; }

        if(won){ wonSum += price; }

        // ── ПРЕДОХРАНИТЕЛЬ ──
        // 1) Непроставленный платёж: сделка выиграна, но сумма не заполнена (price<=0).
        if(won && price<=0){
          fuses.push({ risk:'err', title:'Непроставленный платёж',
            detail:`Сделка отмечена как выигранная, но сумма (price) не заполнена — выручка не учтётся в РНП.`,
            ref:`#${l.id} · ${l.name||''}` });
        }
        // 2) Плательщик ≠ получатель: компания сделки есть, но основной контакт-плательщик
        //    отсутствует/не привязан — типовая причина расхождения «кто платил ≠ на кого договор».
        const comp = l._embedded && l._embedded.companies && l._embedded.companies[0];
        const cont = l._embedded && l._embedded.contacts && l._embedded.contacts[0];
        if(won && comp && !cont){
          fuses.push({ risk:'warn', title:'Плательщик ≠ получатель',
            detail:`Оплата прошла по компании, но плательщик-контакт к сделке не привязан — проверьте, совпадает ли плательщик с получателем услуги (риск возврата/сверки с бухгалтерией).`,
            ref:`#${l.id} · компания ${comp.id}` });
        }
        // 3) Госпошлина по лицензии не учтена (косвенный признак неполного платежа).
        const gp = cfVal(l,'GOSPOSHLINA');
        if(won && (/лицензи|переоформл/i.test(product)) && (gp==null || Number(gp)<=0)){
          fuses.push({ risk:'warn', title:'Госпошлина не проставлена',
            detail:`Лицензионная сделка выиграна, но поле «Госпошлина» пустое/ноль — возможно, платёж учтён не полностью.`,
            ref:`#${l.id} · ${product}` });
        }
      });

      // ── Сопоставление план/факт по продуктам с РНП ──
      // План на продукт берём из «выручкоподобных» (₽) показателей блока «Продажи»/«Финансы»,
      // распределяя совокупный план продаж пропорционально доле факта продукта (демо-логика).
      const products = [...prodMap.values()].sort((a,b)=>b.fact-a.fact);
      const salesPlan = revenuePlanFromRnp();
      const factTotal = products.reduce((s,p)=>s+p.fact,0) || 1;
      products.forEach(p=>{ p.plan = Math.round(salesPlan * (p.fact/factTotal)); });

      const regions = [...regMap.values()].sort((a,b)=>b.sum-a.sum);

      // ── Ран-рейт: факт-к-дате против пропорциональной доли месячного плана ──
      const monthPlan = salesPlan;
      const now = new Date();
      const monthDays = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
      const days = now.getDate();
      const target = Math.round(monthPlan * days / monthDays);    // сколько должно быть к этому дню
      const projected = days>0 ? Math.round(wonSum / days * monthDays) : 0;
      const rrPct = target>0 ? capPct(Math.round(wonSum/target*100)) : (wonSum>0?100:0);
      const runRate = { factToDate: wonSum, target, projected, monthPlan, days, monthDays, pct: rrPct };

      // 4) Отставание от ран-рейта (агрегатная проверка).
      if(monthPlan>0 && rrPct < 80){
        fuses.push({ risk: rrPct<60?'err':'warn', title:'Отставание от ран-рейта',
          detail:`К ${days}-му дню месяца собрано ${fmt(wonSum,'₽')} при целевых ${fmt(target,'₽')} (${rrPct}%). Прогноз на месяц ${fmt(projected,'₽')} против плана ${fmt(monthPlan,'₽')} — темпа не хватает.`,
          ref:`ран-рейт · день ${days}/${monthDays}` });
      }

      // сортируем предохранитель: критичные вперёд
      fuses.sort((a,b)=> (a.risk===b.risk?0:(a.risk==='err'?-1:1)));

      return {
        dealsTotal: leads.length, dealsWon, dealsLost, dealsOpen,
        wonSum, products, regions, runRate, fuses,
      };
    }

    /* Совокупный «выручкоподобный» план продаж из РНП (₽-показатели блоков Продажи/Финансы). */
    function revenuePlanFromRnp(){
      let sum = 0;
      state.rnp.blocks.forEach(b=>{
        if(!/прода|финанс/i.test(b.name)) return;
        (b.metrics||[]).forEach(m=>{
          if(m.unit==='₽' && /маржа|маржинал|выручк|сумм|продаж/i.test(m.name) && !m.invert) sum += Number(m.plan)||0;
        });
      });
      // запасной вариант — первый ₽-показатель блока продаж/финансов, иначе разумная демо-цифра
      if(sum<=0){
        outer:
        for(const b of state.rnp.blocks){
          for(const m of (b.metrics||[])){ if(m.unit==='₽' && !m.invert){ sum = Number(m.plan)||0; break outer; } }
        }
      }
      return sum>0 ? sum : 4_500_000;
    }

    /* Эвристика продукта по названию сделки (если нет custom field). */
    function guessProduct(name){
      const n = String(name||'').toLowerCase();
      if(/переоформл/.test(n)) return 'Переоформление';
      if(/лицконтр|подтвержд соответ|лицензконтр/.test(n)) return 'Лицконтроль';
      if(/аттпр|аттестац/.test(n)) return 'АТТПР';
      if(/оборудован|аренд/.test(n)) return 'Оборудование';
      if(/пакет|кросс|пивот/.test(n)) return 'Кросс-продажа';
      if(/лицензи|мчс/.test(n)) return 'Лицензия МЧС';
      return 'Прочее';
    }

    /* Демо-эвристика региона: детерминированно по id компании/сделки (стабильна между
       перерисовками). В mock-данных amoCRM явного поля региона нет, файл интеграции
       не трогаем — поэтому помечаем разметку как демонстрационную. */
    function guessRegion(l){
      const name = String(l.name||'');
      if(/регион/i.test(name)) return 'Регионы РФ';
      const REG = ['Москва','Московская обл.','Санкт-Петербург','Краснодарский край','Свердловская обл.'];
      const comp = l._embedded && l._embedded.companies && l._embedded.companies[0];
      const seed = Number((comp && comp.id) || l.id || 0);
      return REG[seed % REG.length];
    }

    function logImport(html, type){
      const log = document.querySelector('#rnp-imp-log');
      if(!log) return;
      const cls = type==='err'?'err':type==='ok'?'ok':type==='warn'?'warn':'info';
      log.insertAdjacentHTML('afterbegin',
        `<div class="card" style="margin-top:14px;border-left:3px solid var(--${cls==='info'?'info':cls});animation:viewin var(--t) var(--ease-out)">
           <div style="display:flex;gap:8px;align-items:center">
             <span class="badge ${cls}">${cls==='ok'?'✓':cls==='err'?'✕':cls==='warn'?'!':'i'}</span>
             <span style="font-size:13px">${html}</span>
             <span class="spacer" style="flex:1"></span>
             <span class="mono" style="color:var(--ink-3);font-size:11px">${esc(fmtTime(new Date()))}</span>
           </div>
         </div>`);
    }

    /* ════════════════════════ ИМПОРТ: Google Sheets ════════════════════════ */
    async function importSheets(rangeOverride){
      const integration = integ('google_sheets');
      if(!integration){ ctx.toast('Интеграция Google Sheets не подключена','err'); logImport('Google Sheets: интеграция не зарегистрирована.','err'); return; }
      const btns = lockButtons(['#rnp-imp-sheets','#rnp-imp-sheets-2'], 'Загрузка');
      try{
        const range = (typeof rangeOverride === 'string' && rangeOverride.trim()) ? rangeOverride.trim() : rangeFor();
        const res = await integration.run('values', { range });
        const rows = pickRows(res);
        const parsed = parseSheetRows(rows);
        if(parsed && parsed.blocks.length){
          parsed.period = state.rnp.period;       // период держим из текущего выбора
          applyImport(parsed, res, 'Google Sheets');
          const detail = `${parsed.blocks.length} блоков · ${parsed.blocks.reduce((s,b)=>s+b.metrics.length,0)} показателей`;
          handleResult(res, 'Google Sheets', detail);
          logImport(`Google Sheets, диапазон <span class="mono">${esc(range)}</span> → ${esc(detail)}.`, res.mock?'warn':'ok');
        } else {
          ctx.toast('Не удалось распознать структуру РНП в таблице','err');
          logImport('Google Sheets: ответ получен, но структура «Блок · Показатель · План · Факт» не распознана.', 'err');
          if(res && res.note) ctx.toast(res.note,'info');
        }
      }catch(e){ ctx.toast('Ошибка импорта: '+(e&&e.message||e),'err'); logImport('Google Sheets: ошибка — '+esc(e&&e.message||String(e)),'err'); }
      finally{ unlockButtons(btns); }
    }

    /* ════════════════════════ ИМПОРТ: amoCRM ════════════════════════ */
    async function importAmo(){
      const integration = integ('amocrm');
      if(!integration){ ctx.toast('Интеграция amoCRM не подключена','err'); logImport('amoCRM: интеграция не зарегистрирована.','err'); return; }
      const btns = lockButtons(['#rnp-imp-amo','#rnp-imp-amo-2'], 'Загрузка');
      try{
        const res = await integration.run('leads');
        const leads = pickLeads(res);
        const agg = aggregateLeads(leads);
        if(agg){
          mergeFromCrm(agg);
          state.demo = !!res.mock;
          state.source = res.mock ? 'демо' : 'amoCRM';
          state.note = res.note || (res.mock ? state.note : 'данные из amoCRM');
          state.updatedAt = new Date();
          repaint();
          const detail = `${agg.count} выигранных из ${agg.total} · ${fmt(agg.sum,'₽')}`;
          handleResult(res, 'amoCRM', detail);
          logImport(`amoCRM → ${esc(detail)}; обновлены факт по марже и лидам в блоке «Продажи».`, res.mock?'warn':'ok');
        } else {
          ctx.toast('В ответе amoCRM нет сделок','err');
          logImport('amoCRM: в ответе нет сделок (leads).','err');
          if(res && res.note) ctx.toast(res.note,'info');
        }
      }catch(e){ ctx.toast('Ошибка импорта: '+(e&&e.message||e),'err'); logImport('amoCRM: ошибка — '+esc(e&&e.message||String(e)),'err'); }
      finally{ unlockButtons(btns); }
    }

    /* применить распарсенный набор: нормализовать, выставить флаги, перерисовать */
    function applyImport(parsed, res, srcTitle){
      state.rnp = normalize(parsed);
      state.demo = !!res.mock;
      state.source = res.mock ? 'демо' : srcTitle;
      state.note = res.note || (res.mock ? state.note : 'данные из '+srcTitle);
      state.updatedAt = new Date();
      // фильтр мог указывать на блок, которого больше нет
      if(state.filter !== 'all' && !state.rnp.blocks[+state.filter]) state.filter = 'all';
      repaint();
    }

    /* реакция на .mock/.note/.error из обёртки интеграции (контракт ядра).
       Ядро уже префиксует note названием интеграции, поэтому не дублируем «Src: Src: …». */
    function handleResult(res, src, detail){
      const withSrc = msg => { const s=String(msg||''); return s.toLowerCase().startsWith(src.toLowerCase()) ? s : (src+': '+s); };
      if(res.error){ ctx.toast(withSrc(res.error),'err'); return; }
      if(res.mock){ ctx.toast(withSrc(res.note||'нет ключей — показаны демо-данные'),'info'); }
      else        { ctx.toast(`${src}: импортировано (${detail}) ✓`,'ok'); }
    }

    /* ════════════════════════ ПАРСЕРЫ / АГРЕГАТОРЫ ════════════════════════ */
    function pickRows(res){
      const d = res && res.data;
      if(!d) return null;
      return d.values || d.rows || (Array.isArray(d) ? d : null);
    }
    function pickLeads(res){
      const d = res && res.data; if(!d) return null;
      return (d._embedded && d._embedded.leads) || d.leads || (Array.isArray(d) ? d : null);
    }

    // Ожидаем строки: [Блок|'', Показатель, План, Факт]. Шапка распознаётся и пропускается.
    function parseSheetRows(rows){
      if(!Array.isArray(rows) || !rows.length) return null;
      const out = { period: state.rnp.period, currency: '₽', blocks: [] };
      let cur = null;
      rows.forEach((r, i)=>{
        if(!Array.isArray(r)) return;
        const c0 = String(r[0]||'').trim();
        const name = String(r[1]||'').trim();
        const plan = num(r[2]), fact = num(r[3]);
        if(i===0 && /показател|план|факт/i.test((r.join(' ')||''))) return; // шапка
        if(c0 && !name){ cur = { name: c0, metrics: [] }; out.blocks.push(cur); return; } // строка-заголовок блока
        if(c0 && name){ cur = { name: c0, metrics: [] }; out.blocks.push(cur); }           // блок + показатель в одной строке
        if(!cur){ cur = { name: 'Прочее', metrics: [] }; out.blocks.push(cur); }
        if(name && (plan!=null || fact!=null)){
          cur.metrics.push({ name, plan: plan||0, fact: fact||0, unit: guessUnit(name), invert: guessInvert(name) });
        }
      });
      out.blocks = out.blocks.filter(b=>b.metrics.length);
      return out.blocks.length ? out : null;
    }

    function aggregateLeads(leads){
      if(!Array.isArray(leads) || !leads.length) return null;
      const won = leads.filter(l=>{
        const s = String(l.status_id||l.status||'').toLowerCase();
        return l.status_id===142 || /won|оплач|закры|выигр/.test(s) || Number(l.price)>0;
      });
      const sum = won.reduce((s,l)=>s+(Number(l.price)||0),0);
      return { count: won.length, sum, total: leads.length };
    }

    function mergeFromCrm(agg){
      const op = state.rnp.blocks.find(b=>/прода/i.test(b.name)) || state.rnp.blocks[0];
      if(!op) return;
      const margin = (op.metrics||[]).find(x=>/маржа|сумм|выручк/i.test(x.name));
      if(margin) margin.fact = agg.sum;
      const leadM = (op.metrics||[]).find(x=>/лид/i.test(x.name));
      if(leadM) leadM.fact = agg.total;
    }

    /* ════════════════════════ ЭКСПОРТ ════════════════════════ */
    function summaryRows(){
      const rows = [];
      state.rnp.blocks.forEach(b => (b.metrics||[]).forEach(m=>{
        rows.push({ block:b.name, owner:b.owner||'', name:m.name,
          plan:m.plan, fact:m.fact, unit:m.unit||'', pct:scorePct(m), status:statusOf(m), invert:!!m.invert });
      }));
      return rows;
    }
    function csvText(){
      const head = ['Период','Блок','Ответственный','Показатель','План','Факт','Ед.','Выполнение,%','Статус','Инверсия'];
      const esq = v => { v = String(v==null?'':v); return /[";\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
      const stLabel = s => s==='ok'?'в плане':s==='warn'?'риск':'провал';
      const lines = [head.join(';')];
      summaryRows().forEach(r=>{
        lines.push([state.rnp.period||'', r.block, r.owner, r.name, r.plan, r.fact, r.unit, r.pct, stLabel(r.status), r.invert?'да':'нет'].map(esq).join(';'));
      });
      return '﻿' + lines.join('\r\n'); // BOM для Excel/кириллицы
    }
    function exportCsv(){
      const blob = new Blob([csvText()], {type:'text/csv;charset=utf-8'});
      const name = 'РНП — '+(state.rnp.period||'сводка').replace(/[^\wА-Яа-яёЁ]+/g,' ').trim()+'.csv';
      ui.download(name, blob);
      ctx.toast('Сводка выгружена в CSV ✓','ok');
    }
    function summaryPlainText(){
      const L = [];
      L.push('РНП — реестр новых продаж');
      L.push('Период: ' + (state.rnp.period||'—') + ' · источник: ' + (state.demo?'демо-данные':state.source));
      L.push(''.padEnd(56,'─'));
      state.rnp.blocks.forEach(b=>{
        L.push(b.name + (b.owner?' ('+b.owner+')':'') + ' — ' + blockAvg(b) + '%');
        (b.metrics||[]).forEach(m=>{
          const st = statusOf(m);
          L.push('  • '+m.name+': план '+fmt(m.plan,m.unit)+' / факт '+fmt(m.fact,m.unit)+' = '+scorePct(m)+'% ['+(st==='ok'?'в плане':st==='warn'?'риск':'провал')+']'+(m.invert?' (инверсия)':''));
        });
      });
      L.push(''.padEnd(56,'─'));
      const all = allMetrics().filter(m=>!m.invert);
      const avg = all.length ? Math.round(all.reduce((s,m)=>s+clampPct(scorePct(m)),0)/all.length) : 0;
      L.push('Среднее выполнение по прямым показателям: '+avg+'%');
      return L.join('\n');
    }
    function copySummary(){ ui.copy(summaryPlainText(), 'Сводка скопирована в буфер ✓'); }
    function printSummary(){
      const stLabel = s => s==='ok'?'в плане':s==='warn'?'риск':'провал';
      const rowsHtml = [];
      state.rnp.blocks.forEach(b=>{
        rowsHtml.push(`<tr class="grp"><td colspan="5">${esc(b.name)}${b.owner?` — ${esc(b.owner)}`:''} · ${blockAvg(b)}%</td></tr>`);
        (b.metrics||[]).forEach(m=>{
          rowsHtml.push(`<tr>
            <td>${esc(m.name)}${m.invert?' ↓':''}</td>
            <td class="r">${esc(fmt(m.plan,m.unit))}</td>
            <td class="r">${esc(fmt(m.fact,m.unit))}</td>
            <td class="r">${scorePct(m)}%</td>
            <td>${stLabel(statusOf(m))}</td>
          </tr>`);
        });
      });
      const html =
        `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>РНП — сводка</title>
         <style>
           body{font-family:Arial,sans-serif;color:#161a22;max-width:820px;margin:28px auto;padding:0 24px}
           h1{font-size:20px;margin:0 0 4px} .meta{color:#475067;font-size:13px;margin-bottom:18px}
           table{width:100%;border-collapse:collapse;font-size:13px}
           td{padding:6px 8px;border-bottom:1px solid #e8ebf0} .r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
           tr.grp td{font-weight:bold;background:#f3f5f8;border-bottom:1px solid #d6dbe3}
           thead td{color:#8a93a3;font-weight:bold;text-transform:uppercase;font-size:11px}
           .foot{color:#8a93a3;font-size:12px;margin-top:22px}
         </style></head><body>
         <h1>РНП — реестр новых продаж</h1>
         <div class="meta">Период: ${esc(state.rnp.period||'—')} · источник: ${esc(state.demo?'демо-данные (обезличено)':state.source)}<br>
           Сформировано: ${esc(new Date().toLocaleString('ru-RU'))}</div>
         <table><thead><tr><td>Показатель</td><td class="r">План</td><td class="r">Факт</td><td class="r">%</td><td>Статус</td></tr></thead>
           <tbody>${rowsHtml.join('')}</tbody></table>
         <div class="foot">«↓» — инверсный показатель (долги/дебиторка): меньше факта — лучше. Данные демонстрационные, не являются офертой.</div>
         </body></html>`;
      const w = window.open('', '_blank');
      if(!w){ ctx.toast('Разрешите всплывающие окна для печати','err'); return; }
      w.document.write(html); w.document.close(); w.focus(); w.print();
    }

    /* ════════════════════════ ФИЛЬТРЫ / ПЕРИОД ════════════════════════ */
    function bindFilters(scope){
      const sel = (scope||root).querySelector('#rnp-filter-block');
      const q = (scope||root).querySelector('#rnp-filter-q');
      if(sel) sel.onchange = e => { state.filter = e.target.value; refreshActivePanel(); };
      if(q){
        const onType = ui.debounce(()=>{ state.q = q.value; refreshActivePanel(); }, 180);
        q.oninput = onType;
      }
    }
    // перерисовать активную панель (на смену фильтра/поиска) + счётчик, сохранив фокус и каретку поля поиска
    function refreshActivePanel(){
      const ae = document.activeElement;
      const hadFocus = ae && ae.id === 'rnp-filter-q';
      const caret = hadFocus ? ae.selectionStart : null;
      paintBody();
      const cnt = root.querySelector('#rnp-tabs [data-tab="table"] .t-count');
      if(cnt) cnt.textContent = visibleMetrics().length;
      if(hadFocus){
        const q = root.querySelector('#rnp-filter-q');
        if(q){ q.focus(); if(caret!=null){ try{ q.setSelectionRange(caret,caret); }catch(e){} } }
      }
    }
    function clearFilters(){ state.filter='all'; state.q=''; refreshActivePanel(); }
    function switchPeriod(p){
      if(p===state.rnp.period) return;
      // если в исходном сиде нет других периодов — просто меняем подпись текущего набора
      state.rnp.period = p;
      ctx.toast('Период: '+p,'info');
      repaint();
    }

    /* ════════════════════════ РАСЧЁТЫ (чистые) ════════════════════════ */
    // scorePct — «процент выполнения» для отображения.
    //   прямой: факт/план. инверсный (долги): если план 0 → 100% при факте 0, иначе насколько вышли за лимит.
    function scorePct(m){
      // приводим к конечным неотрицательным числам: NaN/Infinity/мусор → 0,
      // отрицательные план/факт для процента выполнения смысла не имеют (долг/объём ≥ 0).
      const plan = fin(m.plan), fact = fin(m.fact);
      if(m.invert){
        if(plan===0) return fact>0 ? 0 : 100;          // план долга = 0; любой факт = провал
        return capPct(Math.round((plan/(fact||plan))*100)); // лимит/факт: факт ≤ лимита → ≥100%
      }
      if(plan===0) return fact ? 100 : 0;
      return capPct(Math.round((fact/plan)*100));
    }
    // конечное неотрицательное число (защита от NaN/Infinity/отрицательных/строк)
    function fin(v){ const n=Number(v); return (isFinite(n) && n>0) ? n : 0; }
    // верхняя граница отображаемого процента — чтобы 100000% не ломал вёрстку плитки.
    function capPct(p){ p = isFinite(p) ? p : 0; return p>999 ? 999 : (p<0 ? 0 : p); }
    // barFill — насколько закрашивать бар (всегда 0..100, понятно глазу).
    function barFill(m){
      if(m.invert){
        const plan = fin(m.plan), fact = fin(m.fact);
        if(plan===0) return fact>0 ? 100 : 0;          // долг есть → бар «горит» полностью
        return clampPct((fact/plan)*100);               // насколько приблизились к лимиту
      }
      return clampPct(scorePct(m));
    }
    // statusOf — ok/warn/err c учётом инверсии.
    function statusOf(m){
      if(m.invert){
        const plan = fin(m.plan), fact = fin(m.fact); // те же конечные неотрицательные значения, что и в scorePct
        if(plan===0) return fact>0 ? 'err' : 'ok';      // нулевой лимит долга
        if(fact<=plan) return 'ok';
        if(fact<=plan*1.2) return 'warn';
        return 'err';
      }
      const p = scorePct(m);
      if(p>=95) return 'ok';
      if(p>=80) return 'warn';
      return 'err';
    }
    function deltaLabel(m){
      const plan=Number(m.plan)||0, fact=Number(m.fact)||0, d=fact-plan;
      if(!plan && !fact) return '';
      if(d===0) return 'в точку';
      const sign = d>0?'+':'−';
      const good = m.invert ? d<0 : d>0;
      const col = good ? 'var(--ok-d)' : 'var(--err-d)';
      return `<span style="color:${col}">${sign}${fmt(Math.abs(d), m.unit)}</span>`;
    }
    function blockAvg(b){
      const ms = (b.metrics||[]).filter(m=>!m.invert);
      if(!ms.length){
        const inv=(b.metrics||[]).filter(m=>m.invert);
        return inv.length ? Math.round(inv.reduce((s,m)=>s+clampPct(scorePct(m)),0)/inv.length) : 0;
      }
      return Math.round(ms.reduce((s,m)=>s+clampPct(scorePct(m)),0)/ms.length);
    }

    /* ════════════════════════ ВЫБОРКИ ПОД ФИЛЬТР ════════════════════════ */
    function visibleBlocks(){
      let blocks = state.rnp.blocks;
      if(state.filter!=='all' && blocks[+state.filter]) blocks = [blocks[+state.filter]];
      // при поиске оставляем блоки, где есть хоть один подходящий показатель
      if(state.q.trim()){
        const term = state.q.trim().toLowerCase();
        blocks = blocks.filter(b => (b.metrics||[]).some(m=>matches(m,b,term)));
      }
      return blocks;
    }
    function filterMetrics(metrics){
      const term = state.q.trim().toLowerCase();
      if(!term) return metrics;
      return metrics.filter(m=>m.name.toLowerCase().includes(term));
    }
    function matches(m, b, term){ return m.name.toLowerCase().includes(term) || b.name.toLowerCase().includes(term); }
    function visibleMetrics(){
      const out=[];
      visibleBlocks().forEach(b=>filterMetrics(b.metrics||[]).forEach(m=>out.push(m)));
      return out;
    }
    function allMetrics(){ return state.rnp.blocks.reduce((a,b)=>a.concat(b.metrics||[]),[]); }

    /* ════════════════════════ УТИЛИТЫ ════════════════════════ */
    function colorFor(st){ return st==='ok'?'var(--ok)':st==='warn'?'var(--warn)':st==='err'?'var(--err)':'var(--ink)'; }
    function clampPct(v){ v=Number(v)||0; return Math.max(0, Math.min(100, Math.round(v))); }
    function fmt(v, unit){
      if(v==null||v==='') return '—';
      const n = Number(v);
      if(unit==='%') return (Number.isInteger(n)?n:n.toLocaleString('ru-RU',{maximumFractionDigits:1}))+'%';
      if(unit==='₽'){
        if(Math.abs(n)>=1_000_000) return (n/1_000_000).toLocaleString('ru-RU',{maximumFractionDigits:2})+' млн ₽';
        if(Math.abs(n)>=10_000)    return (n/1000).toLocaleString('ru-RU',{maximumFractionDigits:0})+' тыс ₽';
        return n.toLocaleString('ru-RU')+' ₽';
      }
      return n.toLocaleString('ru-RU')+(unit?(' '+unit):'');
    }
    function guessUnit(name){
      if(/%|конверс|R\/R|актив|маржинальн|доля|укомплект|текуч|nps/i.test(name)) return '%';
      if(/маржа|маржинал|выручк|прибыл|сумм|чек|долг|дебитор|доход|cpl|стоимост/i.test(name)) return '₽';
      return 'шт';
    }
    function guessInvert(name){ return /долг|просроч|дебитор|текуч|цикл|cpl|стоимост лида|стоимость лида/i.test(name); }
    function num(v){ if(v==null||v==='') return null;
      const n = parseFloat(String(v).replace(/[\s ]/g,'').replace(/,/,'.').replace(/[^0-9.\-]/g,'')); return isNaN(n)?null:n; }
    function clone(o){ return JSON.parse(JSON.stringify(o)); }
    function htmlToEl(html){ const t=document.createElement('template'); t.innerHTML=String(html).trim(); return t.content; }
    // одноразовая инъекция доп. CSS модуля (идемпотентно по id)
    function ensureStyle(id, css){
      try{
        if(document.getElementById(id)) return;
        const s = document.createElement('style'); s.id = id; s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
      }catch(e){ /* среда без head — не критично */ }
    }

    // нормализация любого формата РНП к {period,currency,note,blocks:[{name,owner,metrics:[{name,plan,fact,unit,invert}]}]}
    function normalize(src){
      src = src || {};
      const out = { period: src.period || 'Текущий период', currency: src.currency || '₽', note: src.note || '', blocks: [] };
      (src.blocks||[]).forEach(b=>{
        const name = b.name || b.block || 'Блок';
        const metrics = (b.metrics||[]).map(m=>{
          const unit = m.unit || unitFromName(m.name);
          return { name: m.name || '—', plan: numOr0(m.plan), fact: numOr0(m.fact),
                   unit, invert: m.invert != null ? !!m.invert : guessInvert(m.name||'') };
        });
        out.blocks.push({ name, owner: b.owner || '', metrics });
      });
      return out;
    }
    function unitFromName(name){ return guessUnit(name||''); }
    function numOr0(v){ const n=Number(v); return isNaN(n)?0:n; }

    // Периоды для переключателя. Раньше сюда подмешивались period из внутреннего
    // демо-набора SEED_RNP и из ctx.data.rnp — но переключение на «чужой» период
    // не подгружало другой набор данных (switchPeriod лишь переименовывает текущий),
    // поэтому дропдаун предлагал фантомный период-пустышку. Отдаём только период
    // активного набора (baseSeed): если у него есть несколько реальных периодов —
    // они уже внутри одного источника; иначе показываем один (badge вместо select).
    function collectPeriods(){
      const set = new Set();
      if(state.rnp.period) set.add(state.rnp.period);
      const src = baseSeed;
      if(src && Array.isArray(src.periods)) src.periods.forEach(p=>{ if(p) set.add(p); });
      return [...set];
    }
    function rangeFor(){ return state.rnp.period ? `'${state.rnp.period}'!A1:D200` : 'РНП!A1:D200'; }
    function fmtTime(d){ try{ return new Date(d).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }

    function defOf(id){ return (ctx.integrationDefs||[]).find(d=>d.id===id) || null; }
    function integ(id){ return ctx.integrations && ctx.integrations[id]; }

    function lockButtons(selectors, label){
      const found = [];
      selectors.forEach(sel=>{ const b=document.querySelector(sel); if(b){ found.push({b, html:b.innerHTML}); b.disabled=true; b.innerHTML = ui.spinner+' '+esc(label); } });
      return found;
    }
    function unlockButtons(found){ (found||[]).forEach(({b,html})=>{ b.disabled=false; b.innerHTML=html; }); }

    function resetDemo(){
      state.rnp = clone(baseSeed);
      state.demo = true;
      state.source = 'демо';
      state.note = baseSeed.note || 'демо-данные (РНП Сенсор, обезличено)';
      state.updatedAt = null;
      state.filter = 'all'; state.q = '';
      const log = document.querySelector('#rnp-imp-log'); if(log) log.innerHTML='';
      repaint();
      ctx.toast('Загружены демо-данные','info');
    }

    /* paintBody() сам привязывает фильтры в своей панели после каждой перерисовки,
       так что отдельный наблюдатель не нужен — состояние модуля живёт в замыкании mount. */
  }
});

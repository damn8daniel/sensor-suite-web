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
  ],

  mount(root, ctx){
    const ui = ctx.ui, esc = ui.escape;

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
      view: (SensorStore.get('tabs_rnp_view') === 'table' || SensorStore.get('tabs_rnp_view') === 'import')
              ? SensorStore.get('tabs_rnp_view') : 'dash',
    };

    /* ── Вкладки ─────────────────────────────────────────────────────────────
       Собственная реализация на штатных классах .pill-tabs/.pill (как в sales.js):
       единый визуальный язык, без зависимости от рекурсивного ui.tabs. Каждая панель
       рисуется своей build-функцией в #rnp-body — соседние не теряют состояние. */
    const TABS = [
      { id:'dash',   label:'Дашборд', build: buildDash  },
      { id:'table',  label:'Таблица', build: buildTable },
      { id:'import', label:'Импорт',  build: buildImport },
    ];

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
          ? `<div class="bar" style="margin-top:10px" role="progressbar" aria-valuenow="${opts.pct}" aria-valuemin="0" aria-valuemax="100">
               <span style="width:${clampPct(opts.pct)}%;background:${opts.color||'var(--accent)'}"></span>
             </div>` : '';
        return `<div class="card rnp-kpi" style="padding:15px 17px">
            <div class="hint" style="margin:0 0 7px">${esc(label)}</div>
            <div class="rnp-kpi-val" style="font-size:26px;font-weight:700;line-height:1;color:${opts.color||'var(--ink)'}">${valueHtml}</div>
            ${opts.sub?`<div class="hint" style="margin:7px 0 0">${opts.sub}</div>`:''}
            ${bar}
          </div>`;
      };

      const distSub =
        `<span class="badge ok" style="margin-right:4px">${okN} в плане</span>` +
        `<span class="badge warn" style="margin-right:4px">${warnN} риск</span>` +
        `<span class="badge err">${errN} провал</span>`;

      return `<div class="grid cols-3 rnp-kpi-grid" style="margin-bottom:16px">
        ${tile('Среднее выполнение плана', avg+'%', { pct:avg, color:avgCls, sub:`по ${norm.length} прямым показателям` })}
        ${tile('Охват сводки', `${visibleBlocks().length}<span class="hint" style="font-size:14px;font-weight:500"> бл.</span> · ${all.length}<span class="hint" style="font-size:14px;font-weight:500"> пок.</span>`,
                { sub:'блоков · показателей' })}
        ${tile('Распределение статусов', `${okN}<span class="hint" style="font-size:15px;font-weight:500"> / </span>${warnN}<span class="hint" style="font-size:15px;font-weight:500"> / </span>${errN}`,
                { sub:distSub })}
        ${tile('Долги и дебиторка', debtBad ? `${debtBad}<span class="hint" style="font-size:15px;font-weight:500"> в зоне риска</span>` : 'в норме',
                { color:debtCls, sub: debts.length ? `${debts.length} инверсных показателей (меньше — лучше)` : 'инверсных показателей нет' })}
      </div>` + renderFilters();
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
      const plan = Number(m.plan)||0, fact = Number(m.fact)||0;
      if(m.invert){
        if(plan===0) return fact>0 ? 0 : 100;          // план долга = 0; любой факт = провал
        return Math.round((plan/(fact||plan))*100);     // лимит/факт: факт ≤ лимита → ≥100%
      }
      if(plan===0) return fact ? 100 : 0;
      return Math.round((fact/plan)*100);
    }
    // barFill — насколько закрашивать бар (всегда 0..100, понятно глазу).
    function barFill(m){
      if(m.invert){
        const plan = Number(m.plan)||0, fact = Number(m.fact)||0;
        if(plan===0) return fact>0 ? 100 : 0;          // долг есть → бар «горит» полностью
        return clampPct((fact/plan)*100);               // насколько приблизились к лимиту
      }
      return clampPct(scorePct(m));
    }
    // statusOf — ok/warn/err c учётом инверсии.
    function statusOf(m){
      if(m.invert){
        const plan = Number(m.plan)||0, fact = Number(m.fact)||0;
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

    function collectPeriods(){
      const set = new Set();
      if(state.rnp.period) set.add(state.rnp.period);
      [SEED_RNP, ctx.data && ctx.data.rnp].forEach(s=>{ if(s && s.period) set.add(s.period); });
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

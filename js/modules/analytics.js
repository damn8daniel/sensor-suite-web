/* Модуль «Аналитика» (P9) — сводный дашборд управления:
     1) Конкуренты — сортируемая таблица (услуги / сильные / слабые / что перенять /
        оценка) с живым поиском (данные из window.ANALYTICS.competitors).
     2) SEO-роадмап — статус блоков 0–5, карта Блок 5 «пиллар → кластеры» со
        статусами (badge) и таймлайн спринтов.
     3) 152-ФЗ — ИНТЕРАКТИВНЫЙ чеклист: чекбоксы по пунктам, статус сохраняется в
        ctx.store (persist между сессиями), прогресс-бар «закрыто X из N», фильтр по
        риску; у пункта — норма и действие.

   Источник — window.ANALYTICS (сводные данные, js/data/analytics.js). Если он пуст
   или частично пуст — модуль НИКОГДА не падает и не пустой: безопасные фолбэки и
   осмысленные empty-состояния по каждой вкладке. Не использует ui.tabs() (известный
   дефект рекурсии) — pill-tabs собраны вручную.

   Контракт: id='analytics', dept='Управление', order=70. */

SensorApp.register({
  id: 'analytics', title: 'Аналитика', dept: 'Управление', order: 70,
  icon: '📊',
  description: 'Конкуренты, SEO-роадмап «Лицензия МЧС» и интерактивный чеклист 152-ФЗ',
  keywords: ['аналитика','конкуренты','seo','роадмап','лицензия мчс','152-фз','персональные данные','пдн','чеклист','роскомнадзор','кластеры','пиллар'],

  // Быстрые действия палитры — навигация уже выполнена роутером, шлём событие;
  // слушатель внутри mount переключит нужную вкладку немедленно.
  actions: [
    { id:'competitors', title:'Аналитика: конкуренты', hint:'Таблица конкурентов по «лицензии МЧС»', icon:'🏁',
      keywords:['конкуренты','соперники','выдача','серп'],
      run:()=>{ try{ window.dispatchEvent(new CustomEvent('analytics:tab',{detail:'competitors'})); }catch(e){} } },
    { id:'seo', title:'Аналитика: SEO-роадмап', hint:'Статус блоков и кластеров «Лицензия МЧС»', icon:'🗺️',
      keywords:['seo','роадмап','кластеры','пиллар','блоки'],
      run:()=>{ try{ window.dispatchEvent(new CustomEvent('analytics:tab',{detail:'seo'})); }catch(e){} } },
    { id:'pdn', title:'Аналитика: чеклист 152-ФЗ', hint:'Соответствие обработки персданных', icon:'🔐',
      keywords:['152','фз','персональные данные','пдн','роскомнадзор','чеклист'],
      run:()=>{ try{ window.dispatchEvent(new CustomEvent('analytics:tab',{detail:'pdn'})); }catch(e){} } }
  ],

  mount(root, ctx){
    const U = ctx.ui, esc = U.escape;

    /* ====================================================================
       0. ИСТОЧНИК ДАННЫХ + БЕЗОПАСНЫЕ ФОЛБЭКИ
       ==================================================================== */
    const A = (window.ANALYTICS && typeof window.ANALYTICS === 'object') ? window.ANALYTICS : {};
    const COMPETITORS = Array.isArray(A.competitors) ? A.competitors : [];
    const SEO = (A.seo && typeof A.seo === 'object') ? A.seo : {};
    const SEO_BLOCKS = Array.isArray(SEO.blocks) ? SEO.blocks : [];
    const BLOCK5 = (SEO.block5 && typeof SEO.block5 === 'object') ? SEO.block5 : {};
    const CLUSTERS = Array.isArray(BLOCK5.clusters) ? BLOCK5.clusters : [];
    const ROADMAP = Array.isArray(SEO.roadmap) ? SEO.roadmap : [];
    const PDN = Array.isArray(A.pdn152) ? A.pdn152 : [];

    const PDN_STORE_KEY = 'analytics_pdn152_done';   // { [id]: true }

    // словарь статусов → {label, badge-тип}
    const STATUS = {
      done:     { label:'готово',    type:'ok'   },
      progress: { label:'в работе',  type:'warn' },
      todo:     { label:'в плане',   type:''     }
    };
    function statusBadge(s){
      const v = STATUS[s] || { label: s || '—', type:'info' };
      return U.badge(v.label, v.type);
    }
    const RISK = {
      high: { label:'высокий', type:'err'  },
      med:  { label:'средний', type:'warn' },
      low:  { label:'низкий',  type:'info' }
    };
    function riskBadge(r){
      const v = RISK[r] || { label: r || '—', type:'' };
      return U.badge(v.label, v.type);
    }

    /* ====================================================================
       1. КАРКАС: ручные pill-tabs (НЕ ui.tabs)
       ==================================================================== */
    const TABS = [
      { id:'competitors', label:'Конкуренты', icon:'🏁' },
      { id:'seo',         label:'SEO-роадмап', icon:'🗺️' },
      { id:'pdn',         label:'152-ФЗ',      icon:'🔐' }
    ];
    let activeTab = TABS.some(t=>t.id===ctx.store.get('analytics_tab')) ? ctx.store.get('analytics_tab') : 'competitors';

    root.innerHTML =
      `<div class="pill-tabs" id="an-tabs" role="tablist" style="margin-bottom:14px">` +
        TABS.map(t=>`<button type="button" class="pill${t.id===activeTab?' active':''}" role="tab"
            aria-selected="${t.id===activeTab}" data-tab="${t.id}">
            <span class="t-ic" aria-hidden="true" style="margin-right:6px">${t.icon}</span>${esc(t.label)}</button>`).join('') +
      `</div>` +
      `<div id="an-panel"></div>`;

    const elTabs  = root.querySelector('#an-tabs');
    const elPanel = root.querySelector('#an-panel');

    elTabs.querySelectorAll('[data-tab]').forEach(b=>{
      b.onclick = ()=> selectTab(b.dataset.tab);
    });

    function selectTab(id){
      if(!TABS.some(t=>t.id===id)) return;
      activeTab = id;
      try{ ctx.store.set('analytics_tab', id); }catch(e){}
      elTabs.querySelectorAll('.pill').forEach(p=>{
        const on = p.dataset.tab===id;
        p.classList.toggle('active', on);
        p.setAttribute('aria-selected', on?'true':'false');
      });
      renderPanel();
    }

    function renderPanel(){
      if(activeTab==='competitors') renderCompetitors();
      else if(activeTab==='seo')    renderSeo();
      else                          renderPdn();
    }
    // Первый рендер выполняем в конце mount() — после объявления const-состояний
    // вкладок (compState/pdnState), иначе initial render упрётся в TDZ (renderPanel
    // → renderCompetitors → compFiltered читает ещё не инициализированный compState).

    /* ====================================================================
       2. ВКЛАДКА «КОНКУРЕНТЫ» — сортируемая таблица + поиск
       ==================================================================== */
    const compState = { q:'', sortKey:'score', sortDir:-1 };

    function listToHtml(arr){
      if(!Array.isArray(arr) || !arr.length) return '<span class="muted">—</span>';
      return `<ul style="margin:0;padding-left:16px;line-height:1.5">${arr.map(x=>`<li style="margin:2px 0">${esc(x)}</li>`).join('')}</ul>`;
    }

    function compFiltered(){
      const q = compState.q.trim().toLowerCase();
      let rows = COMPETITORS.slice();
      if(q){
        rows = rows.filter(c=>{
          const hay = [c.name, c.domain, c.segment, c.position,
            (c.services||[]).join(' '), (c.strengths||[]).join(' '),
            (c.weaknesses||[]).join(' '), (c.steal||[]).join(' ')]
            .filter(Boolean).join('  ').toLowerCase();
          return hay.includes(q);
        });
      }
      const key = compState.sortKey, dir = compState.sortDir;
      rows = rows.map((r,i)=>({r,i})).sort((a,b)=>{
        let cmp;
        if(key==='score'){
          cmp = (Number(a.r.score)||0) - (Number(b.r.score)||0);
        } else {
          cmp = String(a.r[key]==null?'':a.r[key]).localeCompare(String(b.r[key]==null?'':b.r[key]), 'ru', { numeric:true });
        }
        if(cmp===0) cmp = a.i - b.i;
        return cmp * dir;
      }).map(d=>d.r);
      return rows;
    }

    function renderCompetitors(){
      if(!COMPETITORS.length){
        elPanel.innerHTML = U.card('Конкуренты', 'Сводка по конкурентам из выдачи «Лицензия МЧС».',
          U.empty('🏁','Данные о конкурентах ещё не загружены (window.ANALYTICS.competitors пуст).'));
        return;
      }

      const rows = compFiltered();
      const cols = [
        { key:'name',       label:'Конкурент' },
        { key:'services',   label:'Услуги' },
        { key:'strengths',  label:'Сильные стороны' },
        { key:'weaknesses', label:'Слабые стороны' },
        { key:'steal',      label:'Что перенять' },
        { key:'score',      label:'Оценка' }
      ];
      const sortable = { name:1, score:1 };  // сортируем по конкуренту и оценке

      const head = '<thead><tr>' + cols.map(c=>{
        const can = sortable[c.key];
        const active = compState.sortKey===c.key;
        const arrow = active ? (compState.sortDir===1?' ▲':' ▼') : '';
        const cur = active ? ';color:var(--accent-dd)' : '';
        return can
          ? `<th data-sort="${c.key}" role="button" tabindex="0" title="Сортировать по «${esc(c.label)}»"
               style="cursor:pointer;-webkit-user-select:none;user-select:none;white-space:nowrap${cur}">${esc(c.label)}<span class="muted" style="font-size:11px">${arrow}</span></th>`
          : `<th>${esc(c.label)}</th>`;
      }).join('') + '</tr></thead>';

      const tbody = '<tbody>' + rows.map(c=>{
        const score = Number(c.score)||0;
        const stype = score>=8 ? 'err' : score>=6 ? 'warn' : 'info';   // сильный конкурент = «горячо»
        return '<tr>' +
          `<td style="min-width:150px"><strong>${esc(c.name)}</strong>` +
            `<div class="mono muted" style="font-size:11px">${esc(c.domain||'')}</div>` +
            `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${c.position?U.badge(c.position,'info'):''}${c.segment?U.badge(c.segment):''}</div></td>` +
          `<td style="min-width:140px">${listToHtml(c.services)}</td>` +
          `<td style="min-width:190px;color:var(--ink-2)">${listToHtml(c.strengths)}</td>` +
          `<td style="min-width:190px;color:var(--ink-2)">${listToHtml(c.weaknesses)}</td>` +
          `<td style="min-width:190px;color:var(--ink-2)">${listToHtml(c.steal)}</td>` +
          `<td style="text-align:center;white-space:nowrap">${U.badge(score+' / 10', stype)}</td>` +
        '</tr>';
      }).join('') + '</tbody>';

      const controls =
        `<div class="field" style="margin-bottom:0">
           <div style="position:relative">
             <input id="an-comp-q" placeholder="Поиск по конкуренту, услуге, сильным/слабым сторонам…" autocomplete="off" spellcheck="false" value="${esc(compState.q)}" style="padding-right:34px">
             <button id="an-comp-x" type="button" aria-label="Очистить" title="Очистить" style="display:${compState.q?'':'none'};position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;padding:2px 6px">×</button>
           </div>
         </div>
         <div class="muted" id="an-comp-count" style="font-size:12px;margin-top:8px">Найдено: ${rows.length} из ${COMPETITORS.length}</div>`;

      const tbl = rows.length
        ? `<div class="tbl-wrap"><table class="tbl">${head}${tbody}</table></div>`
        : U.empty('🔍','Ничего не найдено по запросу.',
            `<button class="btn sm" id="an-comp-clear">Сбросить поиск</button>`);

      elPanel.innerHTML =
        U.card('Конкуренты по выдаче «Лицензия МЧС»',
          'Сводно по 15 сайтам из топа Яндекса и Google. Оценка — сила конкурента (0–10): чем выше, тем плотнее коммерческие факторы и контент. Клик по «Конкурент»/«Оценка» — сортировка.',
          controls) +
        U.card('Сравнение', '', tbl);

      wireCompetitors();
    }

    function wireCompetitors(){
      const q = elPanel.querySelector('#an-comp-q');
      const qx = elPanel.querySelector('#an-comp-x');
      if(q){
        const deb = U.debounce(()=>{ compState.q = q.value; renderCompetitors(); restoreFocus('#an-comp-q'); }, 110);
        q.addEventListener('input', deb);
      }
      if(qx) qx.onclick = ()=>{ compState.q=''; renderCompetitors(); };
      const clr = elPanel.querySelector('#an-comp-clear'); if(clr) clr.onclick = ()=>{ compState.q=''; renderCompetitors(); };

      elPanel.querySelectorAll('th[data-sort]').forEach(th=>{
        const apply = ()=>{
          const key = th.dataset.sort;
          if(compState.sortKey===key) compState.sortDir = -compState.sortDir;
          else { compState.sortKey = key; compState.sortDir = (key==='score') ? -1 : 1; }
          renderCompetitors();
        };
        th.onclick = apply;
        th.onkeydown = e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); apply(); } };
      });
    }

    // вернуть фокус и каретку в поле поиска после перерисовки (живой ввод)
    function restoreFocus(sel){
      const el = elPanel.querySelector(sel);
      if(el){ const v = el.value; el.focus(); try{ el.setSelectionRange(v.length, v.length); }catch(e){} }
    }

    /* ====================================================================
       3. ВКЛАДКА «SEO-РОАДМАП» — блоки 0–5, карта пиллар→кластеры, таймлайн
       ==================================================================== */
    function renderSeo(){
      if(!SEO_BLOCKS.length && !CLUSTERS.length && !ROADMAP.length){
        elPanel.innerHTML = U.card('SEO-роадмап', '',
          U.empty('🗺️','SEO-данные ещё не загружены (window.ANALYTICS.seo пуст).'));
        return;
      }

      // --- статус блоков 0–5 ---
      const blocksHtml = SEO_BLOCKS.length
        ? `<div style="display:grid;gap:8px">` + SEO_BLOCKS.map(b=>
            `<div style="display:flex;gap:10px;align-items:flex-start">
               <span class="badge info" style="flex:0 0 auto;min-width:54px;justify-content:center">Блок ${esc(b.n)}</span>
               <span style="flex:1;color:var(--ink-2);line-height:1.45">${esc(b.title)}</span>
               <span style="flex:0 0 auto">${statusBadge(b.status)}</span>
             </div>`).join('') + `</div>`
        : `<div class="muted">Блоки не заданы.</div>`;

      // прогресс по блокам
      const doneBlocks = SEO_BLOCKS.filter(b=>b.status==='done').length;
      const blocksHint = SEO_BLOCKS.length
        ? `Выполнено ${doneBlocks} из ${SEO_BLOCKS.length} блоков исследования.`
        : '';

      // --- карта Блок 5: пиллар → кластеры ---
      const pillarName = BLOCK5.pillar || 'Лицензия МЧС';
      const clustersHtml = CLUSTERS.length
        ? `<div style="border-left:2px solid var(--line);margin-left:6px;padding-left:14px;display:grid;gap:10px">` +
            CLUSTERS.map(cl=>
              `<div class="card" style="padding:10px 12px;margin:0">
                 <div style="display:flex;gap:8px;align-items:flex-start;justify-content:space-between">
                   <div style="flex:1">
                     <div style="font-weight:600;line-height:1.4">${esc(cl.title)}</div>
                     ${cl.url?`<div class="mono muted" style="font-size:11px;margin-top:2px">${esc(cl.url)}</div>`:''}
                   </div>
                   <div style="flex:0 0 auto;text-align:right;white-space:nowrap">${statusBadge(cl.status)}</div>
                 </div>
                 ${cl.intent?`<div style="margin-top:6px">${U.badge('интент: '+cl.intent, cl.intent.indexOf('коммер')>=0?'accent':'')}</div>`:''}
               </div>`).join('') +
          `</div>`
        : `<div class="muted">Кластеры не заданы.</div>`;

      const clusterHead =
        `<div style="display:flex;gap:9px;align-items:center;margin-bottom:12px">
           <span class="badge accent dot" style="font-size:13px">Пиллар: ${esc(pillarName)}</span>
           <span class="muted" style="font-size:12px">${CLUSTERS.length} ${plural(CLUSTERS.length,'кластер','кластера','кластеров')}</span>
         </div>`;

      // --- таймлайн спринтов ---
      const timelineHtml = ROADMAP.length
        ? `<div style="display:grid;gap:8px">` + ROADMAP.map(r=>
            `<div style="display:flex;gap:10px;align-items:flex-start">
               <span class="badge" style="flex:0 0 auto;min-width:78px;justify-content:center">${esc(r.when||'—')}</span>
               <span style="flex:1;color:var(--ink-2);line-height:1.45">${esc(r.title)}</span>
               <span style="flex:0 0 auto">${statusBadge(r.status)}</span>
             </div>`).join('') + `</div>`
        : `<div class="muted">Таймлайн не задан.</div>`;

      elPanel.innerHTML =
        U.card('Статус блоков 0–5', blocksHint, blocksHtml) +
        U.card('Блок 5 · карта «пиллар → кластеры»',
          'Контентный силос вокруг пиллара. Статусы: готово / в работе / в плане.',
          clusterHead + clustersHtml) +
        U.card('Таймлайн внедрения', 'Спринты реализации Блока 5.', timelineHtml);
    }

    /* ====================================================================
       4. ВКЛАДКА «152-ФЗ» — интерактивный чеклист с persist в ctx.store
       ==================================================================== */
    const pdnState = { risk:'' };   // фильтр по риску: ''=все

    function loadDone(){
      const d = ctx.store.get(PDN_STORE_KEY, {});
      return (d && typeof d === 'object') ? d : {};
    }
    function isDone(id){ return !!loadDone()[id]; }
    function setDone(id, val){
      const d = loadDone();
      if(val) d[id] = true; else delete d[id];
      try{ ctx.store.set(PDN_STORE_KEY, d); }catch(e){}
    }

    function pdnFiltered(){
      return pdnState.risk ? PDN.filter(p=>p.risk===pdnState.risk) : PDN.slice();
    }

    function renderPdn(){
      if(!PDN.length){
        elPanel.innerHTML = U.card('Соответствие 152-ФЗ', '',
          U.empty('🔐','Чеклист 152-ФЗ ещё не загружен (window.ANALYTICS.pdn152 пуст).'));
        return;
      }

      const done = loadDone();
      const totalAll = PDN.length;
      const doneAll = PDN.filter(p=>done[p.id]).length;
      const pct = totalAll ? Math.round(doneAll/totalAll*100) : 0;

      // прогресс-бар «закрыто X из N»
      const progress =
        `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
           <strong style="font-size:14px">Закрыто ${doneAll} из ${totalAll}</strong>
           <span class="muted" style="font-size:12px">${pct}%</span>
         </div>
         <div style="height:10px;background:var(--line);border-radius:999px;overflow:hidden">
           <div style="height:100%;width:${pct}%;background:${pct>=100?'var(--ok)':'var(--accent)'};transition:width .25s"></div>
         </div>`;

      // фильтр по риску — pill-tabs (НЕ ui.tabs)
      const riskCounts = { '': totalAll, high:0, med:0, low:0 };
      PDN.forEach(p=>{ if(riskCounts[p.risk]!=null) riskCounts[p.risk]++; });
      const riskTabs = [
        { id:'',     label:'Все' },
        { id:'high', label:'Высокий' },
        { id:'med',  label:'Средний' },
        { id:'low',  label:'Низкий' }
      ];
      const filterHtml =
        `<div class="pill-tabs" id="an-pdn-risk" role="tablist" style="margin:12px 0 0">` +
          riskTabs.map(r=>`<button type="button" class="pill${r.id===pdnState.risk?' active':''}" role="tab"
              aria-selected="${r.id===pdnState.risk}" data-risk="${r.id}">${esc(r.label)} <span class="t-count">${riskCounts[r.id]||0}</span></button>`).join('') +
        `</div>`;

      // список пунктов с чекбоксами
      const rows = pdnFiltered();
      const itemsHtml = rows.length
        ? `<div style="display:grid;gap:8px;margin-top:12px">` + rows.map(p=>{
            const checked = !!done[p.id];
            return `<label class="card" data-pdn="${esc(p.id)}" style="display:flex;gap:11px;align-items:flex-start;padding:11px 13px;margin:0;cursor:pointer${checked?';opacity:.72':''}">
                <input type="checkbox" data-pdn-cb="${esc(p.id)}" ${checked?'checked':''} style="margin-top:3px;flex:0 0 auto;width:17px;height:17px;cursor:pointer">
                <span style="flex:1;min-width:0">
                  <span style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">
                    <span style="font-weight:600;line-height:1.4${checked?';text-decoration:line-through':''}">${esc(p.item)}</span>
                    ${p.group?U.badge(p.group):''}${riskBadge(p.risk)}
                  </span>
                  ${p.norm?`<span class="mono muted" style="display:block;font-size:11px;margin-top:4px">📕 ${esc(p.norm)}</span>`:''}
                  ${p.action?`<span style="display:block;color:var(--ink-2);font-size:13px;line-height:1.45;margin-top:4px">→ ${esc(p.action)}</span>`:''}
                </span>
              </label>`;
          }).join('') + `</div>`
        : U.empty('🔍','Нет пунктов с выбранным уровнем риска.');

      elPanel.innerHTML =
        U.card('Прогресс соответствия 152-ФЗ',
          'Чеклист обработки персональных данных (реестр УЦ, CRM, сайт). Отметки сохраняются локально между сессиями.',
          progress +
          `<div class="btn-row" style="margin-top:14px">
             <button class="btn ghost sm" id="an-pdn-reset">Сбросить отметки</button>
             <span class="spacer" style="flex:1"></span>
             <span class="muted" style="font-size:12px">персданные физлиц в самих данных не хранятся</span>
           </div>` +
          filterHtml) +
        U.card('Пункты чеклиста', '', itemsHtml);

      wirePdn();
    }

    function wirePdn(){
      // чекбоксы — persist + локальная перерисовка прогресса
      elPanel.querySelectorAll('[data-pdn-cb]').forEach(cb=>{
        cb.addEventListener('change', ()=>{
          setDone(cb.dataset.pdnCb, cb.checked);
          renderPdn();   // обновит прогресс-бар, счётчики риска и зачёркивание
        });
      });
      // фильтр по риску
      elPanel.querySelectorAll('#an-pdn-risk [data-risk]').forEach(b=>{
        b.onclick = ()=>{ pdnState.risk = b.dataset.risk; renderPdn(); };
      });
      // сброс всех отметок (с подтверждением)
      const reset = elPanel.querySelector('#an-pdn-reset');
      if(reset) reset.onclick = ()=>{
        U.confirm({ title:'Сбросить чеклист 152-ФЗ', message:'Снять все отметки выполнения?', ok:'Сбросить', danger:true })
          .then(yes=>{ if(yes){ try{ ctx.store.set(PDN_STORE_KEY, {}); }catch(e){} renderPdn(); ctx.toast('Отметки 152-ФЗ сброшены','info'); } });
      };
    }

    /* ---------- утилиты ---------- */
    function plural(n, one, few, many){
      const n10=n%10, n100=n%100;
      if(n10===1 && n100!==11) return one;
      if(n10>=2 && n10<=4 && !(n100>=12 && n100<=14)) return few;
      return many;
    }

    /* ====================================================================
       5. ДЕЙСТВИЯ ПАЛИТРЫ (через событие) + размонтирование
       ==================================================================== */
    function onTabEvent(e){ const id = e && e.detail; if(id) selectTab(id); }
    window.addEventListener('analytics:tab', onTabEvent);

    // первый рендер активной вкладки (все const-состояния уже инициализированы)
    renderPanel();

    this.unmount = function(){ window.removeEventListener('analytics:tab', onTabEvent); };
  }
});

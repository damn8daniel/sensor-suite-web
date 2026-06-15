/* Модуль «Реестр УЦ» (P6) — просмотрщик реестра выпускников учебного центра.

   Источник данных — window.REGISTRY_SAMPLE (обезличенный образец). Формат гибкий:
     { schema:[{key,label,type?}], rows:[{...}] }  ИЛИ  { rows:[{...}] }  ИЛИ  { columns, rows }.
   Если sample пуст/нет строк — модуль НИКОГДА не пустой: показываем встроенные демо-строки
   и баннер с приглашением загрузить свой .xlsx (данные не покидают компьютер).

   Возможности:
     • таблица записей (ФИО, программа, даты обучения, № удостоверения, менеджер, статус);
     • живой поиск по ФИО / № удостоверения / программе;
     • фильтры по программе, менеджеру, статусу (select из уникальных значений);
     • счётчик найденных + сортировка по клику на заголовок;
     • экспорт текущей выборки в CSV (через ui.download → window.saveAs или a[download]);
     • локальный импорт .xlsx через window.XLSX (SheetJS) — файл обрабатывается локально,
       ничего не отправляется; при ошибке — toast; если XLSX нет — импорт скрыт.

   Не использует ui.tabs() (известный дефект рекурсии) — фильтры на select + ручные элементы.
   Контракт регистрации: id='registry', dept='Учебный центр', order=25. */

SensorApp.register({
  id: 'registry', title: 'Реестр УЦ', dept: 'Учебный центр', order: 25,
  icon: '📇',
  description: 'Реестр выпускников учебного центра: поиск, фильтры, экспорт CSV, локальный импорт .xlsx',
  keywords: ['реестр','уц','учебный центр','выпускник','удостоверение','программа','обучение','импорт','xlsx','экспорт','csv'],

  // Быстрые действия палитры. Модуль уже смонтирован к моменту run() (палитра дёргает
  // run через setTimeout после навигации), поэтому шлём событие — слушатель внутри mount
  // выполнит действие немедленно.
  actions: [
    { id:'import', title:'Импорт .xlsx в реестр', hint:'Загрузить свой файл реестра локально', icon:'📥',
      keywords:['импорт','xlsx','excel','загрузить','файл'],
      run:()=>{ try{ window.dispatchEvent(new CustomEvent('registry:action', { detail:'import' })); }catch(e){} } },
    { id:'export', title:'Экспорт реестра в CSV', hint:'Выгрузить текущую выборку', icon:'📤',
      keywords:['экспорт','csv','выгрузить','скачать'],
      run:()=>{ try{ window.dispatchEvent(new CustomEvent('registry:action', { detail:'export' })); }catch(e){} } },
    { id:'print', title:'Печать выборки реестра', hint:'Распечатать текущую отфильтрованную таблицу', icon:'🖨',
      keywords:['печать','распечатать','выборка','таблица'],
      run:()=>{ try{ window.dispatchEvent(new CustomEvent('registry:action', { detail:'print' })); }catch(e){} } }
  ],

  mount(root, ctx){
    const U = ctx.ui, esc = U.escape;

    /* ====================================================================
       1. ИСТОЧНИК ДАННЫХ + ФОЛБЭК
       ==================================================================== */
    // Демо-схема и демо-строки (обезличенные — вымышленные ФИО). Используются,
    // когда window.REGISTRY_SAMPLE пуст или не содержит строк.
    const FALLBACK_SCHEMA = [
      { key:'fio',     label:'ФИО',              type:'text' },
      { key:'program', label:'Программа',        type:'text' },
      { key:'period',  label:'Даты обучения',    type:'text' },
      { key:'cert',    label:'№ удостоверения',  type:'text', mono:true },
      { key:'manager', label:'Менеджер',         type:'text' },
      { key:'status',  label:'Статус',           type:'status' }
    ];
    const FALLBACK_ROWS = [
      { fio:'Иванов И. И.',     program:'Пожарная безопасность (ПТМ)',       period:'12.01.2026 – 23.01.2026', cert:'УЦ-2026-0017', manager:'Петрова А.', status:'Выдано' },
      { fio:'Сидоров П. С.',    program:'Охрана труда (40 ч)',               period:'02.02.2026 – 06.02.2026', cert:'УЦ-2026-0042', manager:'Петрова А.', status:'Выдано' },
      { fio:'Кузнецова М. В.',  program:'Профпереподготовка (ПБ, 256 ч)',    period:'15.01.2026 – 28.02.2026', cert:'УЦ-2026-0051', manager:'Орлов Д.',   status:'Обучается' },
      { fio:'Смирнов А. Н.',    program:'Повышение квалификации (ПБ, 72 ч)', period:'10.03.2026 – 17.03.2026', cert:'УЦ-2026-0068', manager:'Орлов Д.',   status:'Готово к выдаче' },
      { fio:'Фёдорова Е. К.',   program:'Охрана труда (40 ч)',               period:'18.03.2026 – 22.03.2026', cert:'УЦ-2026-0073', manager:'Лебедева Н.', status:'Выдано' },
      { fio:'Морозов Д. А.',    program:'Пожарная безопасность (ПТМ)',       period:'01.04.2026 – 11.04.2026', cert:'УЦ-2026-0090', manager:'Лебедева Н.', status:'Обучается' }
    ];

    // Эвристики для авто-определения ключевых колонок (поиск/группировка) по имени или метке.
    function matchKey(schema, ...needles){
      for(const c of schema){
        const hay = ((c.key||'') + ' ' + (c.label||'')).toLowerCase();
        if(needles.some(n=>hay.includes(n))) return c.key;
      }
      return null;
    }

    // Нормализуем источник в { schema:[{key,label,mono?,type?}], rows:[{}], demo:bool, roleKeys }.
    function buildModel(src, isDemo){
      let rows = [];
      let schema = [];
      if(src && Array.isArray(src.rows)) rows = src.rows.slice();
      if(src && Array.isArray(src.schema) && src.schema.length){
        schema = src.schema.map(c=> typeof c==='string' ? { key:c, label:c } : Object.assign({}, c));
      } else if(src && Array.isArray(src.columns) && src.columns.length){
        schema = src.columns.map(c=> typeof c==='string' ? { key:c, label:c } : Object.assign({}, c));
      }
      // Если схемы нет — выводим её из ключей первой строки.
      if(!schema.length && rows.length){
        schema = Object.keys(rows[0]).map(k=>({ key:k, label:k }));
      }
      // нормализуем поле label
      schema.forEach(c=>{ if(c.label==null) c.label = c.key; });

      // роли колонок — для поиска и фильтров (по эвристике имени/метки)
      const roleKeys = {
        fio:     matchKey(schema, 'фио','имя','слушат','ученик','name','student'),
        cert:    matchKey(schema, 'удостовер','сертификат','№','номер','cert','диплом','документ'),
        program: matchKey(schema, 'программ','курс','program','направлен'),
        manager: matchKey(schema, 'менеджер','куратор','manager','ответствен'),
        status:  matchKey(schema, 'статус','состоян','status'),
        date:    matchKey(schema, 'дат','период','срок','обучен','date')
      };
      return { schema, rows, demo:!!isDemo, roleKeys };
    }

    function loadModel(){
      const src = (window.REGISTRY_SAMPLE && typeof window.REGISTRY_SAMPLE==='object') ? window.REGISTRY_SAMPLE : null;
      const hasRows = src && Array.isArray(src.rows) && src.rows.length > 0;
      if(hasRows) return buildModel(src, false);
      // фолбэк-демо
      return buildModel({ schema: FALLBACK_SCHEMA, rows: FALLBACK_ROWS }, true);
    }

    let model = loadModel();          // активная модель (демо или реальная / импортированная)
    let imported = null;              // имя импортированного файла (если был импорт)
    const xlsxAvailable = !!(window.XLSX && typeof window.XLSX.read === 'function');

    /* ====================================================================
       2. СОСТОЯНИЕ (поиск / фильтры / сортировка)
       ==================================================================== */
    const state = {
      q:        '',
      program:  '',
      manager:  '',
      status:   '',
      sortKey:  null,     // ключ колонки сортировки
      sortDir:  1         // 1 ↑, -1 ↓
    };

    function cellText(row, key){
      const v = key!=null ? row[key] : '';
      return v==null ? '' : String(v);
    }

    // уникальные значения для фильтра-select по роли колонки
    function uniqueValues(roleKey){
      const key = model.roleKeys[roleKey];
      if(!key) return [];
      const seen = new Set(), out = [];
      model.rows.forEach(r=>{
        const v = cellText(r, key).trim();
        if(v && !seen.has(v)){ seen.add(v); out.push(v); }
      });
      return out.sort((a,b)=>a.localeCompare(b,'ru'));
    }

    // применить поиск + фильтры → массив строк
    function filteredRows(){
      const q = state.q.trim().toLowerCase();
      const rk = model.roleKeys;
      return model.rows.filter(r=>{
        if(state.program && rk.program && cellText(r, rk.program) !== state.program) return false;
        if(state.manager  && rk.manager && cellText(r, rk.manager)  !== state.manager)  return false;
        if(state.status   && rk.status  && cellText(r, rk.status)   !== state.status)   return false;
        if(q){
          const hay = [rk.fio, rk.cert, rk.program]
            .filter(Boolean)
            .map(k=>cellText(r,k).toLowerCase())
            .join('  ');
          // если эвристики не нашли ни одной колонки — ищем по всем значениям строки
          const text = hay || Object.values(r).map(v=>String(v==null?'':v).toLowerCase()).join('  ');
          if(!text.includes(q)) return false;
        }
        return true;
      });
    }

    // сортировка (стабильная по выбранной колонке; даты пытаемся понять, иначе строки)
    function sortRows(rows){
      if(!state.sortKey) return rows;
      const key = state.sortKey, dir = state.sortDir;
      const col = model.schema.find(c=>c.key===key) || {};
      const isDate = (model.roleKeys.date===key) || /date|дат|период|срок/i.test((col.key||'')+(col.label||''));
      const decorated = rows.map((r,i)=>({ r, i }));
      decorated.sort((a,b)=>{
        const av = cellText(a.r,key), bv = cellText(b.r,key);
        let cmp;
        if(isDate){ cmp = dateVal(av) - dateVal(bv); if(!isFinite(cmp) || cmp===0) cmp = av.localeCompare(bv,'ru'); }
        else { const na=numVal(av), nb=numVal(bv);
          cmp = (na!=null && nb!=null) ? (na-nb) : av.localeCompare(bv,'ru',{numeric:true}); }
        if(cmp===0) cmp = a.i - b.i;            // стабильность
        return cmp * dir;
      });
      return decorated.map(d=>d.r);
    }
    function numVal(s){ const m = String(s).replace(/\s/g,'').replace(',','.').match(/^-?\d+(\.\d+)?$/); return m ? parseFloat(m[0]) : null; }
    function dateVal(s){
      // берём первую дату вида dd.mm.yyyy / yyyy-mm-dd из строки (для периодов «d – d»)
      const ru = String(s).match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
      if(ru){ const y = ru[3].length===2 ? '20'+ru[3] : ru[3]; return new Date(+y, +ru[2]-1, +ru[1]).getTime(); }
      const iso = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      if(iso){ return new Date(+iso[1], +iso[2]-1, +iso[3]).getTime(); }
      return NaN;
    }

    /* ====================================================================
       3. РАЗМЕТКА
       ==================================================================== */
    root.innerHTML =
      `<div id="reg-banner"></div>` +
      `<div id="reg-controls"></div>` +
      `<div id="reg-table"></div>`;

    const elBanner   = root.querySelector('#reg-banner');
    const elControls = root.querySelector('#reg-controls');
    const elTable    = root.querySelector('#reg-table');

    let fileInput = null;            // скрытый input[type=file] для импорта

    renderAll();

    function renderAll(){
      renderBanner();
      renderControls();
      renderTable();
    }

    /* ---------- баннер (демо / импорт / локальность) ---------- */
    function renderBanner(){
      if(model.demo){
        elBanner.innerHTML = U.card('Демо-данные',
          'Показан обезличенный образец реестра. Загрузите свой файл реестра (.xlsx) — данные не покидают компьютер.',
          `<div class="btn-row">${
            xlsxAvailable
              ? `<button class="btn primary" id="reg-import-demo">📥 Загрузить .xlsx</button>`
              : `<span class="badge warn">Импорт .xlsx недоступен (SheetJS не подключён)</span>`
          }<span class="badge info dot">обезличенный образец</span></div>`);
        const b = elBanner.querySelector('#reg-import-demo');
        if(b) b.onclick = triggerImport;
      } else if(imported){
        elBanner.innerHTML = U.card('Импортировано локально',
          'Файл «' + imported + '» обработан на вашем компьютере, ничего не отправляется. Реестр ниже построен из этого файла.',
          `<div class="btn-row"><span class="badge ok dot">локальный файл: ${esc(imported)}</span>
             <button class="btn ghost sm" id="reg-back-demo">Вернуть демо-данные</button></div>`);
        const back = elBanner.querySelector('#reg-back-demo');
        if(back) back.onclick = ()=>{ model = loadModel(); imported = null; resetState(); renderAll(); ctx.toast('Возвращены демо-данные','info'); };
      } else {
        elBanner.innerHTML = '';
      }
    }

    function resetState(){ state.q=''; state.program=''; state.manager=''; state.status=''; state.sortKey=null; state.sortDir=1; }

    /* ---------- панель управления: поиск + фильтры + действия ---------- */
    function renderControls(){
      const rk = model.roleKeys;
      const programs = uniqueValues('program');
      const managers = uniqueValues('manager');
      const statuses = uniqueValues('status');

      const selBlock = (key, label, vals, cur)=> rk[key] && vals.length
        ? U.field(label,
            `<select data-filter="${key}" aria-label="${esc(label)}">
               <option value="">Все (${vals.length})</option>
               ${vals.map(v=>`<option value="${esc(v)}"${v===cur?' selected':''}>${esc(v)}</option>`).join('')}
             </select>`)
        : '';

      const body =
        `<div class="field" style="margin-bottom:10px">
           <div style="position:relative">
             <input id="reg-q" placeholder="Поиск по ФИО, № удостоверения, программе…" autocomplete="off" spellcheck="false" value="${esc(state.q)}" style="padding-right:34px">
             <button id="reg-q-x" type="button" aria-label="Очистить" title="Очистить" style="display:${state.q?'':'none'};position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;padding:2px 6px">×</button>
           </div>
         </div>` +
        `<div class="grid cols-3" style="gap:10px">${
           selBlock('program','Программа', programs, state.program) +
           selBlock('manager','Менеджер', managers, state.manager) +
           selBlock('status','Статус',   statuses, state.status)
         }</div>` +
        `<div class="btn-row" style="margin-top:12px">
           ${xlsxAvailable ? `<button class="btn" id="reg-import">📥 Импорт .xlsx</button>` : ''}
           <button class="btn" id="reg-export">📤 Экспорт CSV</button>
           <button class="btn" id="reg-print" aria-label="Печать выборки" title="Печать текущей выборки">🖨 Печать</button>
           <button class="btn ghost sm" id="reg-clear">Сбросить фильтры</button>
           <span class="spacer" style="flex:1"></span>
           <span class="muted" id="reg-count" style="font-size:12px"></span>
         </div>` +
        (xlsxAvailable
          ? `<p class="hint" style="margin:8px 0 0">Импорт .xlsx обрабатывается локально — файл никуда не отправляется.</p>`
          : `<p class="hint" style="margin:8px 0 0">SheetJS не подключён — импорт .xlsx скрыт; доступен поиск, фильтры и экспорт.</p>`);

      elControls.innerHTML = U.card('Поиск и фильтры', '', body);

      // скрытый input для импорта (живёт в DOM модуля)
      if(xlsxAvailable){
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileInput.hidden = true;
        fileInput.addEventListener('change', onFilePicked);
        elControls.appendChild(fileInput);
      }

      wireControls();
    }

    function wireControls(){
      const q = elControls.querySelector('#reg-q');
      const qx = elControls.querySelector('#reg-q-x');
      if(q){
        const deb = U.debounce(()=>{ state.q = q.value; if(qx) qx.style.display = q.value?'':'none'; renderTable(); }, 90);
        q.addEventListener('input', deb);
      }
      if(qx) qx.onclick = ()=>{ if(q){ q.value=''; } state.q=''; qx.style.display='none'; renderTable(); if(q) q.focus(); };

      elControls.querySelectorAll('[data-filter]').forEach(sel=>{
        sel.addEventListener('change', ()=>{ state[sel.dataset.filter] = sel.value; renderTable(); });
      });

      const imp = elControls.querySelector('#reg-import'); if(imp) imp.onclick = triggerImport;
      const exp = elControls.querySelector('#reg-export'); if(exp) exp.onclick = exportCSV;
      const prn = elControls.querySelector('#reg-print'); if(prn) prn.onclick = printSelection;
      const clr = elControls.querySelector('#reg-clear');
      if(clr) clr.onclick = ()=>{ resetState(); renderControls(); renderTable(); };
    }

    /* ---------- таблица ---------- */
    function renderTable(){
      const rows = sortRows(filteredRows());
      const total = model.rows.length;
      const cnt = elControls.querySelector('#reg-count');
      if(cnt) cnt.textContent = `Найдено: ${rows.length} из ${total}`;

      if(!rows.length){
        elTable.innerHTML = U.card('Записи', '',
          U.empty('🔍','Ничего не найдено по заданным условиям.',
            `<button class="btn sm" id="reg-clear2">Сбросить фильтры</button>`));
        const c2 = elTable.querySelector('#reg-clear2');
        if(c2) c2.onclick = ()=>{ resetState(); renderControls(); renderTable(); };
        return;
      }

      const head = '<thead><tr>' + model.schema.map(c=>{
        const active = state.sortKey===c.key;
        const arrow = active ? (state.sortDir===1 ? ' ▲' : ' ▼') : '';
        return `<th data-sort="${esc(c.key)}" role="button" tabindex="0" title="Сортировать по «${esc(c.label)}»"
                    style="cursor:pointer;-webkit-user-select:none;user-select:none;white-space:nowrap${active?';color:var(--accent-dd)':''}">${esc(c.label)}<span class="muted" style="font-size:11px">${arrow}</span></th>`;
      }).join('') + '</tr></thead>';

      const sk = model.roleKeys.status;
      const tbody = '<tbody>' + rows.map(r=> '<tr>' + model.schema.map(c=>{
        const raw = cellText(r, c.key);
        if(c.key===sk && raw){
          return `<td>${statusBadge(raw)}</td>`;
        }
        const mono = c.mono || c.type==='num' ? ' class="mono"' : '';
        return `<td${mono}>${esc(raw)}</td>`;
      }).join('') + '</tr>').join('') + '</tbody>';

      const tbl = `<div class="tbl-wrap"><table class="tbl">${head}${tbody}</table></div>`;
      elTable.innerHTML = U.card('Записи реестра',
        rows.length===total ? `Всего записей: ${total}. Клик по заголовку — сортировка.`
                             : `Показано ${rows.length} из ${total}. Клик по заголовку — сортировка.`,
        tbl);

      // сортировка по клику на заголовок
      elTable.querySelectorAll('th[data-sort]').forEach(th=>{
        const apply = ()=>{
          const key = th.dataset.sort;
          if(state.sortKey===key) state.sortDir = -state.sortDir;
          else { state.sortKey = key; state.sortDir = 1; }
          renderTable();
        };
        th.onclick = apply;
        th.onkeydown = e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); apply(); } };
      });
    }

    function statusBadge(s){
      const t = s.toLowerCase();
      let type = 'info';
      if(/выдан|готов|заверш|выпущ/.test(t)) type = 'ok';
      else if(/обуч|процесс|идёт|идет/.test(t)) type = 'warn';
      else if(/отчисл|аннул|просроч|отказ/.test(t)) type = 'err';
      return `<span class="badge ${type} dot">${esc(s)}</span>`;
    }

    /* ====================================================================
       4. ИМПОРТ .xlsx (локально, через SheetJS)
       ==================================================================== */
    function triggerImport(){
      if(!xlsxAvailable){ ctx.toast('Импорт .xlsx недоступен: SheetJS не подключён','err'); return; }
      if(fileInput){ fileInput.value=''; fileInput.click(); }
    }

    function onFilePicked(e){
      const f = e.target.files && e.target.files[0];
      if(!f) return;
      const reader = new FileReader();
      reader.onload = ev=>{
        try{
          const data = new Uint8Array(ev.target.result);
          const wb = window.XLSX.read(data, { type:'array' });
          const sheetName = wb.SheetNames && wb.SheetNames[0];
          if(!sheetName) throw new Error('в файле нет листов');
          const ws = wb.Sheets[sheetName];
          // defval:'' — чтобы пустые ячейки давали единый набор ключей
          const json = window.XLSX.utils.sheet_to_json(ws, { defval:'', raw:false });
          const rows = (json||[]).filter(r=> Object.values(r).some(v=> String(v==null?'':v).trim()!=='' ));
          if(!rows.length) throw new Error('лист «'+sheetName+'» пуст или без данных');
          // строим модель из импортированных строк (схема — из ключей)
          model = buildModel({ rows }, false);
          imported = f.name || 'импорт.xlsx';
          resetState();
          renderAll();
          ctx.toast('Импортировано локально: ' + rows.length + ' строк (лист «' + sheetName + '»)','ok');
        }catch(err){
          ctx.toast('Не удалось прочитать .xlsx: ' + (err && err.message || err),'err');
        }
      };
      reader.onerror = ()=>{ ctx.toast('Ошибка чтения файла','err'); };
      try{ reader.readAsArrayBuffer(f); }
      catch(err){ ctx.toast('Ошибка чтения файла: ' + (err && err.message || err),'err'); }
    }

    /* ====================================================================
       5. ЭКСПОРТ CSV (текущая выборка)
       ==================================================================== */
    function csvCell(v){
      const s = String(v==null?'':v);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
    }
    function exportCSV(){
      const rows = sortRows(filteredRows());
      if(!rows.length){ ctx.toast('Нет строк для экспорта','warn'); return; }
      const sep = ';';   // ; — дружелюбно для Excel с русской локалью
      const header = model.schema.map(c=>csvCell(c.label)).join(sep);
      const lines = rows.map(r=> model.schema.map(c=>csvCell(cellText(r,c.key))).join(sep));
      const csv = '﻿' + [header].concat(lines).join('\r\n');   // BOM → корректная кириллица в Excel
      const stamp = new Date().toISOString().slice(0,10);
      const name = (imported ? 'registry-' : 'registry-demo-') + stamp + '.csv';
      try{
        const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
        U.download(name, blob);
        ctx.toast('Экспортировано ' + rows.length + ' строк → ' + name,'ok');
      }catch(err){
        ctx.toast('Не удалось выгрузить CSV: ' + (err && err.message || err),'err');
      }
    }

    /* ====================================================================
       5b. ПЕЧАТЬ ТЕКУЩЕЙ ВЫБОРКИ (через ui.printTable)
       ==================================================================== */
    function printSelection(){
      const rows = sortRows(filteredRows());
      if(!rows.length){ ctx.toast('Нет строк для печати','warn'); return; }
      const total = model.rows.length;
      const columns = model.schema.map(c=>({ label: c.label, key: c.key }));
      const data = rows.map(r=>{
        const o = {};
        model.schema.forEach(c=>{ o[c.key] = cellText(r, c.key); });
        return o;
      });
      const meta = [
        { label:'Источник', value: imported ? ('импорт: ' + imported) : (model.demo ? 'обезличенный образец' : 'реестр УЦ') },
        { label:'Показано', value: rows.length===total ? ('все записи: ' + total) : (rows.length + ' из ' + total) }
      ];
      if(state.q)       meta.push({ label:'Поиск', value: state.q });
      if(state.program) meta.push({ label:'Программа', value: state.program });
      if(state.manager) meta.push({ label:'Менеджер', value: state.manager });
      if(state.status)  meta.push({ label:'Статус', value: state.status });
      U.printTable('Реестр УЦ — выборка', columns, data, {
        subtitle: 'Текущая отфильтрованная выборка',
        meta: meta,
        footer: 'Сформировано в Сенсор Suite. Данные обрабатываются локально.'
      });
    }

    /* ====================================================================
       6. ДЕЙСТВИЯ ПАЛИТРЫ (через событие)
       ==================================================================== */
    function onAction(e){
      const what = e && e.detail;
      if(what==='import') triggerImport();
      else if(what==='export') exportCSV();
      else if(what==='print') printSelection();
    }
    window.addEventListener('registry:action', onAction);

    this.unmount = function(){
      window.removeEventListener('registry:action', onAction);
      if(fileInput){ fileInput.removeEventListener('change', onFilePicked); fileInput = null; }
    };
  }
});

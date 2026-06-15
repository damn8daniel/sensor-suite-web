/* Модуль «Контрагенты» — пробив организаций по ИНН/названию через DaData и СПАРК.
   Закрывает боль «проверка плательщика» (плательщик ≠ получатель услуги):
   нашёл → собрал единую карточку → положил в картотеку → отправил в
   лицензирование с предзаполнением реквизитов.

   Контракт сохранён: id='counterparties', dept='Контрагенты', order=60,
   ключ хранилища 'counterparties'. Данные интеграций приходят УЖЕ плоско
   нормализованными ядром: dadata → {name,inn,ogrn,kpp,address,manager,status},
   spark → {name,inn,ogrn,address,manager,status,risk}. Здесь приводим их к
   единому виду карточки и добавляем защитный разбор «сырых» ответов. */
SensorApp.register({
  id: 'counterparties', title: 'Контрагенты', dept: 'Контрагенты', order: 60,
  icon: '🔎', description: 'Пробив организаций по ИНН/названию · DaData + СПАРК · картотека',
  keywords: ['контрагент','инн','огрн','пробив','dadata','дадата','спарк','spark','плательщик','картотека','реквизиты','проверка'],

  // быстрые действия для командной палитры (Cmd/Ctrl+K)
  actions: [
    { id:'focus', title:'Контрагенты: новый пробив', hint:'Поставить курсор в строку поиска', icon:'🔎',
      run(ctx){ const i = document.querySelector('#cp-q'); if(i){ i.focus(); i.select && i.select(); } } },
    { id:'export', title:'Контрагенты: экспорт картотеки', hint:'Скачать JSON/CSV', icon:'⤓',
      run(){ const b = document.querySelector('#cp-export'); if(b) b.click(); } }
  ],

  mount(root, ctx){
    const U = ctx.ui;
    const E = U.escape;
    const STORE_KEY = 'counterparties';
    const PREFILL_KEY = 'lic_prefill'; // передаётся в «Лицензирование»

    /* ============================================================
       1. Нормализация ответа интеграций → единая карточка
       ------------------------------------------------------------
       Ядро уже отдаёт плоский объект. Но на случай прямого сырого
       ответа (suggestions[], data:{…}, SPARK Report) — разбираем и его. */
    function pickName(d, s){
      if (d.name && typeof d.name === 'object')
        return d.name.short_with_opf || d.name.full_with_opf || d.name.short || d.name.full || '';
      return d.name || d.fullName || d.shortName || d.FullName || d.ShortName ||
             d.CompanyName || (s && s.value) || '';
    }
    function pickManager(d){
      if (typeof d.manager === 'string' && d.manager) return d.manager;
      if (d.management && (d.management.name || d.management.post))
        return [d.management.name, d.management.post].filter(Boolean).join(', ');
      if (d.fio) return [d.fio.surname, d.fio.name, d.fio.patronymic].filter(Boolean).join(' ');
      const m = d.Manager || d.Head || d.Director || d.director || d.head || d.ceo;
      if (m && typeof m === 'object') return [m.Name || m.FullName, m.Post].filter(Boolean).join(', ');
      return m || '';
    }
    function pickAddress(d){
      if (d.address && typeof d.address === 'object')
        return d.address.unrestricted_value || d.address.value || '';
      const a = d.address || d.legalAddress || d.LegalAddress || d.Address;
      if (a && typeof a === 'object') return a.FullAddress || a.unrestricted_value || a.value || a.Value || '';
      return a || '';
    }

    function normalize(raw, source){
      if (!raw) return null;
      // развернуть возможные обёртки сырого ответа
      let s = raw;
      if (Array.isArray(raw)) s = raw[0];
      else if (raw.suggestions) s = (raw.suggestions || [])[0];
      if (!s) return null;
      const d = s.data || s.Report || s.report || s.Company || s.company || s;

      const card = {
        name:    pickName(d, s) || '—',
        inn:     String(d.inn || d.INN || d.Inn || '').trim() || '—',
        ogrn:    String(d.ogrn || d.OGRN || d.Ogrn || '').trim() || '—',
        kpp:     String(d.kpp || d.KPP || '').trim() || '',
        address: pickAddress(d) || '—',
        manager: pickManager(d) || '—',
        type:    orgTypeByInn(d.inn || d.INN || d.Inn),
        risk:    riskLabel(d.risk || d.Risk || d.RiskFactors),
        source:  source
      };
      const rawStatus = d.status || d.statusText || d.Status || d.State ||
                        (d.state && (d.state.status || d.state.code)) || '';
      card.status    = humanStatus(rawStatus);
      card.statusRaw = String(rawStatus || card.status || '').toUpperCase();
      return card;
    }

    function orgTypeByInn(inn){
      const n = String(inn || '').replace(/\D/g, '');
      if (n.length === 12) return 'ИП';
      if (n.length === 10) return 'ООО';
      return '';
    }

    // приводит и англ. коды DaData, и уже-русские строки SPARK/ядра к человеку
    function humanStatus(s){
      const m = String(s || '').toUpperCase();
      if (!m) return '—';
      if (/(ACTIVE|ДЕЙСТВ)/.test(m)) return 'Действующая';
      if (/(LIQUIDATING|ЛИКВИДИРУ)/.test(m)) return 'Ликвидируется';
      if (/(LIQUIDATED|ЛИКВИДИРОВ)/.test(m)) return 'Ликвидирована';
      if (/(REORGANIZ|РЕОРГАНИЗ|ПРИСОЕДИН)/.test(m)) return 'Реорганизация';
      if (/(BANKRUPT|БАНКРОТ)/.test(m)) return 'Банкротство';
      return s || '—';
    }
    function statusOk(card){
      const m = (card && (card.statusRaw || card.status)) || '';
      return /(ACTIVE|ДЕЙСТВ)/i.test(String(m));
    }
    function statusType(card){
      if (statusOk(card)) return 'ok';
      const m = String((card && (card.statusRaw || card.status)) || '');
      if (!m || m === '—') return '';
      return /(LIQUIDAT|ЛИКВИД|BANKRUPT|БАНКРОТ)/i.test(m) ? 'err' : 'warn';
    }
    function riskLabel(v){
      const s = String(v || '').toLowerCase();
      if (!s) return '';
      if (/(red|высок|красн)/.test(s)) return 'высокий';
      if (/(yellow|средн|жёлт|желт)/.test(s)) return 'средний';
      if (/(green|низк|зелён|зелен)/.test(s)) return 'низкий';
      return String(v);
    }
    function riskType(label){
      if (label === 'низкий') return 'ok';
      if (label === 'средний') return 'warn';
      if (label === 'высокий') return 'err';
      return '';
    }

    /* ============================================================
       2. Картотека (ctx.store) — дедуп по ИНН, поиск, экспорт
       ============================================================ */
    function load(){ const a = ctx.store.get(STORE_KEY, []); return Array.isArray(a) ? a : []; }
    function persist(a){ ctx.store.set(STORE_KEY, a); }
    function digits(s){ return String(s == null ? '' : s).replace(/\D/g, ''); }
    function hasInn(card){ return card && card.inn && card.inn !== '—' && digits(card.inn).length >= 10; }

    let view = { q: '', src: 'all', sort: 'recent' };

    function addToList(card, opts){
      opts = opts || {};
      if (!card) return false;
      const list = load();
      if (hasInn(card)){
        const key = digits(card.inn);
        const idx = list.findIndex(c => digits(c.inn) === key && digits(c.inn).length);
        if (idx >= 0){
          // обновляем существующую запись свежими данными, сохраняя дату добавления
          const prev = list[idx];
          list[idx] = Object.assign({}, prev, card, { savedAt: prev.savedAt, updatedAt: new Date().toISOString() });
          // подвинуть наверх
          list.unshift(list.splice(idx, 1)[0]);
          persist(list);
          if (!opts.silent) ctx.toast('Контрагент уже был — обновил данные ✓', 'info');
          renderCards();
          return true;
        }
      }
      list.unshift(Object.assign({ savedAt: new Date().toISOString() }, card));
      persist(list);
      if (!opts.silent) ctx.toast('Добавлено в картотеку ✓', 'ok');
      renderCards();
      return true;
    }

    function removeOne(savedAt){
      persist(load().filter(c => c.savedAt !== savedAt));
      renderCards();
    }
    async function removeWithConfirm(card){
      const ok = await U.confirm({
        title: 'Удалить из картотеки',
        message: 'Удалить «' + (card.name || '—') + '» из картотеки?',
        detail: card.inn && card.inn !== '—' ? 'ИНН ' + card.inn : '',
        ok: 'Удалить', danger: true
      });
      if (ok){ removeOne(card.savedAt); ctx.toast('Удалено из картотеки', 'info'); }
    }
    async function clearAll(){
      const n = load().length;
      if (!n) return;
      const ok = await U.confirm({
        title: 'Очистить картотеку',
        message: 'Удалить все записи из картотеки (' + n + ')?',
        detail: 'Действие необратимо. Перед очисткой можно выгрузить экспорт.',
        ok: 'Очистить всё', danger: true
      });
      if (ok){ persist([]); renderCards(); ctx.toast('Картотека очищена', 'info'); }
    }

    function filteredSorted(){
      let list = load();
      if (view.src !== 'all') list = list.filter(c => (c.source || '') === view.src);
      const q = view.q.trim().toLowerCase();
      if (q){
        const qd = digits(q);
        list = list.filter(c => {
          const hay = [c.name, c.inn, c.ogrn, c.kpp, c.address, c.manager].join(' ').toLowerCase();
          return hay.indexOf(q) >= 0 || (qd && digits(c.inn).indexOf(qd) >= 0);
        });
      }
      const by = view.sort;
      list = list.slice().sort((a, b) => {
        if (by === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
        if (by === 'status') return (statusOk(b) - statusOk(a)) ||
                                     String(a.name || '').localeCompare(String(b.name || ''), 'ru');
        // recent
        return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
      });
      return list;
    }

    /* ----- экспорт / импорт ----- */
    function exportJson(){
      const list = load();
      if (!list.length) return ctx.toast('Картотека пуста — нечего выгружать', 'info');
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json;charset=utf-8' });
      U.download('контрагенты — картотека (' + stamp() + ').json', blob);
      ctx.toast('Экспортировано в JSON ✓', 'ok');
    }
    function exportCsv(){
      const list = load();
      if (!list.length) return ctx.toast('Картотека пуста — нечего выгружать', 'info');
      const cols = [
        ['name', 'Наименование'], ['inn', 'ИНН'], ['ogrn', 'ОГРН'], ['kpp', 'КПП'],
        ['address', 'Адрес'], ['manager', 'Руководитель'], ['status', 'Статус'],
        ['risk', 'Риск'], ['source', 'Источник'], ['savedAt', 'Добавлен']
      ];
      const esc = v => { v = String(v == null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const head = cols.map(c => esc(c[1])).join(';');
      const body = list.map(r => cols.map(c => esc(r[c[0]])).join(';')).join('\r\n');
      const blob = new Blob(['﻿' + head + '\r\n' + body], { type: 'text/csv;charset=utf-8' });
      U.download('контрагенты — картотека (' + stamp() + ').csv', blob);
      ctx.toast('Экспортировано в CSV ✓', 'ok');
    }
    function importJson(){
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const arr = JSON.parse(rd.result);
            if (!Array.isArray(arr)) throw new Error('ожидался массив записей');
            let added = 0;
            // импортируем снизу вверх, чтобы сохранить исходный порядок
            arr.slice().reverse().forEach(item => {
              if (item && (item.name || item.inn)) { addToList(item, { silent: true }); added++; }
            });
            renderCards();
            ctx.toast('Импортировано записей: ' + added + ' ✓', 'ok');
          } catch (e){ ctx.toast('Не удалось импортировать: ' + (e.message || e), 'err'); }
        };
        rd.readAsText(f);
      };
      inp.click();
    }
    function stamp(){
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }
    function fmtDate(iso){
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d)) return '—';
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    /* ============================================================
       3. Переход в «Лицензирование» с предзаполнением
       ------------------------------------------------------------
       Модуль «Лицензирование» не редактируем. У него есть поле
       #lookup-inn и кнопка #lookup, которые тянут реквизиты из DaData.
       Кладём карточку в store (PREFILL_KEY) как след, переходим на
       маршрут и дожидаемся появления его DOM, затем подставляем ИНН и
       запускаем штатный пробив — реквизиты заполнятся из того же ИНН. */
    function toLicensing(card){
      addToList(card, { silent: true });
      try { ctx.store.set(PREFILL_KEY, { inn: card.inn, name: card.name, source: card.source, at: new Date().toISOString() }); } catch (e){}
      const inn = (card.inn && card.inn !== '—') ? digits(card.inn) : '';
      ctx.toast('Открываю лицензирование' + (inn ? ' · ИНН ' + card.inn : ''), 'info');
      if (ctx.go) ctx.go('licensing'); else location.hash = '#/licensing';
      if (!inn) return;
      // дождаться монтирования модуля и подставить ИНН в его форму
      let tries = 0;
      const tick = () => {
        const field = document.querySelector('#lookup-inn');
        const btn = document.querySelector('#lookup');
        if (field && btn){
          field.value = inn;
          field.dispatchEvent(new Event('input', { bubbles: true }));
          // также проставим ИНН в основное поле реквизитов, если уже отрисовано
          const reqInn = document.querySelector('#req-fields [data-key="inn"]');
          if (reqInn){ reqInn.value = inn; reqInn.dispatchEvent(new Event('input', { bubbles: true })); }
          btn.click(); // штатный пробив DaData → заполнит реквизиты
          return;
        }
        if (tries++ < 40) setTimeout(tick, 60);
      };
      setTimeout(tick, 80);
    }

    /* ============================================================
       4. Разметка
       ============================================================ */
    root.innerHTML =
      U.card('Пробив контрагента',
        'Введите ИНН (10 цифр — ООО, 12 — ИП) или название организации. DaData работает из браузера; СПАРК — только в desktop-версии (в web показываются демо-данные).',
        `<div class="field" style="margin-bottom:10px">
           <label>ИНН или название организации</label>
           <input id="cp-q" placeholder="7707083893 или «Газпром»" autocomplete="off" spellcheck="false" inputmode="search">
           <div id="cp-hint" class="foot" style="margin-top:6px;min-height:16px"></div>
         </div>
         <div class="btn-row">
           <button class="btn primary" id="cp-dadata">🔎 DaData</button>
           <button class="btn" id="cp-spark">⚡ СПАРК</button>
           <span id="cp-status" class="badge" style="display:none"></span>
         </div>`) +
      `<div id="cp-result"></div>` +
      U.card('Картотека',
        'Найденные контрагенты сохраняются здесь (дедуп по ИНН). Поиск, экспорт и переход в лицензирование с автозаполнением реквизитов.',
        `<div id="cp-toolbar" class="cp-toolbar"></div>
         <div id="cp-cards"></div>`);

    const elQ      = root.querySelector('#cp-q');
    const elHint   = root.querySelector('#cp-hint');
    const elStatus = root.querySelector('#cp-status');
    const elResult = root.querySelector('#cp-result');
    const elCards  = root.querySelector('#cp-cards');
    const elBar    = root.querySelector('#cp-toolbar');
    const btnDa    = root.querySelector('#cp-dadata');
    const btnSpark = root.querySelector('#cp-spark');

    // живая подсказка по вводу: тип запроса (ИНН/название) и валидность длины
    const hintInput = U.debounce(() => {
      const q = elQ.value.trim();
      if (!q){ elHint.textContent = ''; return; }
      const d = digits(q);
      if (/^\d+$/.test(q)){
        if (d.length === 10) elHint.innerHTML = U.badge('ИНН · ООО (10 цифр)', 'info');
        else if (d.length === 12) elHint.innerHTML = U.badge('ИНН · ИП (12 цифр)', 'info');
        else elHint.innerHTML = U.badge('ИНН: нужно 10 или 12 цифр (введено ' + d.length + ')', 'warn');
      } else {
        elHint.innerHTML = U.badge('Поиск по названию · DaData suggest', '');
      }
    }, 120);
    elQ.addEventListener('input', hintInput);

    function setBusy(busy, label){
      btnDa.disabled = busy; btnSpark.disabled = busy;
      if (busy){
        elStatus.style.display = ''; elStatus.className = 'badge';
        elStatus.innerHTML = U.spinner + ' ' + E(label || 'Запрос…');
        elResult.innerHTML = U.card('Результат', '', U.skeleton({ lines: 5, widths: ['40%', '70%', '90%', '60%', '50%'] }));
      } else {
        elStatus.style.display = 'none';
      }
    }

    function sourceBadge(res){
      if (!res || (!res.mock && !res.error)) return U.badge('данные получены', 'ok');
      if (res.error) return U.badge('ошибка источника', 'err');
      if (res.reason === 'web-blocked') return `<span class="badge warn" title="${E(res.note || '')}">демо · только desktop</span>`;
      return `<span class="badge warn" title="${E(res.note || '')}">демо · нет ключей</span>`;
    }

    /* ----- единая карточка результата ----- */
    function renderResult(card, res){
      if (!card){
        elResult.innerHTML = U.card('Результат', '',
          U.empty('🔍', 'Ничего не найдено. Проверьте ИНН (10/12 цифр) или попробуйте другой источник.'));
        return;
      }
      const rows = [
        ['ИНН', `<span class="mono">${E(card.inn)}</span>${card.kpp ? ` <span class="muted">/ КПП <span class="mono">${E(card.kpp)}</span></span>` : ''}` +
                (card.type ? ` ${U.badge(card.type, '')}` : '')],
        ['ОГРН', `<span class="mono">${E(card.ogrn)}</span>`],
        ['Адрес', E(card.address)],
        ['Руководитель / ИП', E(card.manager)],
        ['Статус', `${U.badge(card.status, statusType(card))}${card.risk ? ' ' + U.badge('риск: ' + card.risk, riskType(card.risk)) : ''}`]
      ];
      elResult.innerHTML = U.card(E(card.name),
        'Источник: ' + E(card.source),
        `<div class="cp-card-head">
           ${sourceBadge(res)}
           ${res && res.note ? `<span class="foot" style="margin-left:2px">${E(res.note)}</span>` : ''}
         </div>
         <table class="tbl"><tbody>` +
          rows.map(r => `<tr><th style="width:170px">${r[0]}</th><td>${r[1]}</td></tr>`).join('') +
        `</tbody></table>
         <div class="btn-row" style="margin-top:14px">
           <button class="btn primary sm" id="cp-save">＋ В картотеку</button>
           <button class="btn sm" id="cp-lic">→ В лицензирование</button>
           <button class="btn ghost sm" id="cp-copy">⧉ Копировать реквизиты</button>
           ${hasInn(card) ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="https://bo.nalog.ru/search?query=${encodeURIComponent(digits(card.inn))}">↗ bo.nalog.ru</a>` : ''}
         </div>`);
      elResult.querySelector('#cp-save').onclick = () => addToList(card);
      elResult.querySelector('#cp-lic').onclick  = () => toLicensing(card);
      elResult.querySelector('#cp-copy').onclick = () => U.copy(reqText(card), 'Реквизиты скопированы ✓');
    }

    function reqText(c){
      return [
        c.name,
        'ИНН: ' + c.inn + (c.kpp ? '   КПП: ' + c.kpp : ''),
        'ОГРН: ' + c.ogrn,
        'Адрес: ' + c.address,
        'Руководитель: ' + c.manager,
        'Статус: ' + c.status + (c.risk ? '   Риск: ' + c.risk : ''),
        'Источник: ' + c.source
      ].join('\n');
    }

    /* ============================================================
       5. Картотека: панель управления + таблица
       ============================================================ */
    function renderToolbar(){
      const all = load();
      const active = all.filter(statusOk).length;
      const sources = {}; all.forEach(c => { sources[c.source || '—'] = (sources[c.source || '—'] || 0) + 1; });

      elBar.innerHTML =
        `<div class="cp-bar-row">
           <input id="cp-search" class="cp-search" type="search" placeholder="Поиск: название, ИНН, ОГРН, адрес…"
                  autocomplete="off" spellcheck="false" value="${E(view.q)}" ${all.length ? '' : 'disabled'}>
           <select id="cp-sort" title="Сортировка" ${all.length ? '' : 'disabled'}>
             <option value="recent"${view.sort === 'recent' ? ' selected' : ''}>Сначала новые</option>
             <option value="name"${view.sort === 'name' ? ' selected' : ''}>По названию</option>
             <option value="status"${view.sort === 'status' ? ' selected' : ''}>По статусу</option>
           </select>
         </div>
         <div class="cp-bar-row cp-bar-2">
           <div class="pill-tabs" id="cp-srcfilter" style="margin-bottom:0">
             <span class="pill ${view.src === 'all' ? 'active' : ''}" data-src="all">Все <span class="t-count">${all.length}</span></span>
             ${Object.keys(sources).sort().map(s =>
               `<span class="pill ${view.src === s ? 'active' : ''}" data-src="${E(s)}">${E(s)} <span class="t-count">${sources[s]}</span></span>`).join('')}
           </div>
           <span class="spacer" style="flex:1"></span>
           <div class="btn-row">
             ${all.length ? `<span class="badge" title="Действующих по статусу">${active} активн. из ${all.length}</span>` : ''}
             <button class="btn ghost sm" id="cp-import" title="Импорт картотеки из JSON">⤒ Импорт</button>
             <button class="btn ghost sm" id="cp-export" ${all.length ? '' : 'disabled'} title="Экспорт картотеки">⤓ Экспорт</button>
             <button class="btn ghost sm" id="cp-clear" ${all.length ? '' : 'disabled'} title="Очистить картотеку">✕ Очистить</button>
           </div>
         </div>`;

      const search = elBar.querySelector('#cp-search');
      const onSearch = U.debounce(() => { view.q = search.value; renderCardsBody(); }, 160);
      search.addEventListener('input', onSearch);
      // не теряем фокус при перерисовке тулбара
      if (elBar._focusSearch){ search.focus(); const v = search.value; search.value = ''; search.value = v; elBar._focusSearch = false; }

      elBar.querySelector('#cp-sort').addEventListener('change', e => { view.sort = e.target.value; renderCardsBody(); });
      elBar.querySelectorAll('#cp-srcfilter .pill').forEach(p => p.onclick = () => {
        view.src = p.dataset.src; renderToolbar(); renderCardsBody();
      });
      elBar.querySelector('#cp-export').onclick = () => exportMenu();
      elBar.querySelector('#cp-import').onclick = () => importJson();
      elBar.querySelector('#cp-clear').onclick  = () => clearAll();
    }

    function exportMenu(){
      const m = U.modal('Экспорт картотеки',
        `<p class="hint" style="margin-top:-4px">В картотеке ${load().length} ${plural(load().length, 'запись', 'записи', 'записей')}. Выберите формат выгрузки.</p>
         <div class="btn-row" style="margin-top:8px">
           <button class="btn primary" data-fmt="json">⤓ JSON</button>
           <button class="btn" data-fmt="csv">⤓ CSV (Excel)</button>
         </div>`);
      m.body.querySelector('[data-fmt="json"]').onclick = () => { m.close(); exportJson(); };
      m.body.querySelector('[data-fmt="csv"]').onclick  = () => { m.close(); exportCsv(); };
    }
    function plural(n, one, few, many){
      const m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return one;
      if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
      return many;
    }

    function renderCardsBody(){
      const all = load();
      if (!all.length){
        elCards.innerHTML = U.empty('🗂️', 'Картотека пуста. Найдите организацию выше и нажмите «＋ В картотеку».');
        return;
      }
      const list = filteredSorted();
      if (!list.length){
        elCards.innerHTML = U.empty('🔍', 'Ничего не найдено по фильтру.',
          `<button class="btn sm" id="cp-reset">Сбросить фильтр</button>`);
        const r = elCards.querySelector('#cp-reset');
        if (r) r.onclick = () => { view.q = ''; view.src = 'all'; renderToolbar(); renderCardsBody(); };
        return;
      }

      const cols = [
        { key: 'name', label: 'Организация', render: (v, c) =>
            `<div class="cp-org">
               <button class="cp-org-name" data-open="${E(c.savedAt)}" title="Открыть карточку">${E(c.name || '—')}</button>
               <div class="foot cp-org-sub">${c.type ? E(c.type) + ' · ' : ''}добавлен ${E(fmtDate(c.savedAt))}${c.updatedAt ? ' · обновлён ' + E(fmtDate(c.updatedAt)) : ''}</div>
             </div>` },
        { key: 'inn', label: 'ИНН', mono: true, render: (v) => `${E(v || '—')}` },
        { key: 'status', label: 'Статус', render: (v, c) =>
            U.badge(c.status || '—', statusType(c)) + (c.risk ? ' ' + U.badge(c.risk, riskType(c.risk)) : '') },
        { key: 'source', label: 'Источник', render: (v) => U.badge(v || '—', '') },
        { key: '_act', label: '', align: 'right', render: (v, c) =>
            `<div class="cp-row-act">
               <button class="btn ghost sm" data-lic="${E(c.savedAt)}" title="В лицензирование с автозаполнением">→ лиценз.</button>
               <button class="btn ghost sm" data-copy="${E(c.savedAt)}" title="Копировать реквизиты">⧉</button>
               <button class="btn ghost sm cp-del" data-del="${E(c.savedAt)}" title="Удалить из картотеки" aria-label="Удалить">✕</button>
             </div>` }
      ];

      elCards.innerHTML =
        U.table(list, cols, { maxHeight: '460px', empty: 'Ничего не найдено по фильтру.' }) +
        `<div class="foot" style="margin-top:10px">${list.length} ${plural(list.length, 'запись', 'записи', 'записей')}${view.q || view.src !== 'all' ? ' (по фильтру)' : ''} · дедупликация по ИНН</div>`;

      const byAt = at => list.find(c => c.savedAt === at);
      elCards.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openCardModal(byAt(b.dataset.open)));
      elCards.querySelectorAll('[data-lic]').forEach(b => b.onclick = () => toLicensing(byAt(b.dataset.lic)));
      elCards.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => U.copy(reqText(byAt(b.dataset.copy)), 'Реквизиты скопированы ✓'));
      elCards.querySelectorAll('[data-del]').forEach(b => b.onclick = () => removeWithConfirm(byAt(b.dataset.del)));
    }

    function renderCards(){ renderToolbar(); renderCardsBody(); }

    /* ----- модалка просмотра карточки из картотеки ----- */
    function openCardModal(card){
      if (!card) return;
      const rows = [
        ['ИНН', `<span class="mono">${E(card.inn)}</span>${card.kpp ? ` <span class="muted">/ КПП <span class="mono">${E(card.kpp)}</span></span>` : ''}${card.type ? ' ' + U.badge(card.type, '') : ''}`],
        ['ОГРН', `<span class="mono">${E(card.ogrn)}</span>`],
        ['Адрес', E(card.address)],
        ['Руководитель / ИП', E(card.manager)],
        ['Статус', U.badge(card.status || '—', statusType(card)) + (card.risk ? ' ' + U.badge('риск: ' + card.risk, riskType(card.risk)) : '')],
        ['Источник', E(card.source || '—')],
        ['Добавлен', E(fmtDate(card.savedAt)) + (card.updatedAt ? ' · обновлён ' + E(fmtDate(card.updatedAt)) : '')]
      ];
      const m = U.modal(card.name || 'Контрагент',
        `<table class="tbl"><tbody>` +
          rows.map(r => `<tr><th style="width:170px">${r[0]}</th><td>${r[1]}</td></tr>`).join('') +
        `</tbody></table>
         <div class="btn-row" style="margin-top:16px;justify-content:flex-end">
           <button class="btn ghost sm" data-act="del">✕ Удалить</button>
           <button class="btn sm" data-act="copy">⧉ Копировать</button>
           <button class="btn primary sm" data-act="lic">→ В лицензирование</button>
         </div>`);
      m.body.querySelector('[data-act="copy"]').onclick = () => U.copy(reqText(card), 'Реквизиты скопированы ✓');
      m.body.querySelector('[data-act="lic"]').onclick  = () => { m.close(); toLicensing(card); };
      m.body.querySelector('[data-act="del"]').onclick  = async () => { m.close(); await removeWithConfirm(card); };
    }

    /* ============================================================
       6. Запросы к источникам
       ============================================================ */
    async function runDaData(){
      const q = elQ.value.trim();
      if (!q) return ctx.toast('Введите ИНН или название', 'err');
      const onlyDigits = /^\d{10}(\d{2})?$/.test(q);
      setBusy(true, onlyDigits ? 'DaData: поиск по ИНН…' : 'DaData: поиск по названию…');
      try {
        const res = await ctx.integrations.dadata.run(onlyDigits ? 'findById' : 'suggest', { query: q });
        renderResult(normalize(res && res.data, 'DaData'), res);
        if (res && res.error) ctx.toast('DaData: ' + res.error, 'err');
      } catch (e){
        renderResult(null, null);
        ctx.toast('Ошибка DaData: ' + (e && e.message || e), 'err');
      } finally { setBusy(false); }
    }

    async function runSpark(){
      const q = elQ.value.trim();
      if (!q) return ctx.toast('Введите ИНН или название', 'err');
      setBusy(true, 'СПАРК: запрос справки…');
      try {
        const res = await ctx.integrations.spark.run('company', { inn: q, query: q });
        renderResult(normalize(res && res.data, 'СПАРК'), res);
        if (res && res.error) ctx.toast('СПАРК: ' + res.error, 'err');
      } catch (e){
        renderResult(null, null);
        ctx.toast('Ошибка СПАРК: ' + (e && e.message || e), 'err');
      } finally { setBusy(false); }
    }

    btnDa.onclick = runDaData;
    btnSpark.onclick = runSpark;
    elQ.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); runDaData(); } });

    /* ============================================================
       7. Старт
       ============================================================ */
    renderCards();
    elQ.focus();
  }
});

/* ---- стили модуля (инжектируются один раз; только дополнение, классы из app.css не трогаются) ---- */
(function injectCounterpartiesStyles(){
  if (document.getElementById('cp-styles')) return;
  const css = `
  .cp-toolbar{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
  .cp-bar-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .cp-bar-row.cp-bar-2{gap:8px}
  .cp-search{flex:1;min-width:220px}
  #cp-sort{max-width:170px;flex:0 0 auto}
  .cp-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .cp-org{display:flex;flex-direction:column;gap:2px;min-width:0}
  .cp-org-name{appearance:none;background:none;border:none;padding:0;margin:0;cursor:pointer;
    font:inherit;font-weight:600;color:var(--ink);text-align:left;letter-spacing:-.01em;
    border-radius:var(--radius-xs);transition:color var(--t-fast) var(--ease)}
  .cp-org-name:hover{color:var(--accent-d)}
  .cp-org-name:focus-visible{outline:none;box-shadow:var(--ring)}
  .cp-org-sub{font-size:11.5px}
  .cp-row-act{display:inline-flex;gap:4px;justify-content:flex-end;white-space:nowrap}
  .cp-row-act .btn.sm{padding:5px 8px}
  .btn.ghost.sm.cp-del:hover{background:var(--err-soft);color:var(--err-d)}
  @media(max-width:560px){
    .cp-bar-row{flex-direction:column;align-items:stretch}
    #cp-sort{max-width:none}
    .cp-row-act{flex-wrap:wrap}
  }`;
  const tag = document.createElement('style');
  tag.id = 'cp-styles';
  tag.textContent = css;
  document.head.appendChild(tag);
})();

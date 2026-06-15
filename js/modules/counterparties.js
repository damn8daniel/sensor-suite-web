/* Модуль «Контрагенты» — пробив организаций по ИНН/названию через DaData и СПАРК.
   Закрывает боль «Глаз Бога» / проверка плательщика (плательщик ≠ получатель услуги):
   нашёл → положил в картотеку → отправил в лицензирование. */
SensorApp.register({
  id: 'counterparties', title: 'Контрагенты', dept: 'Контрагенты', order: 60,
  icon: '🔎', description: 'Пробив организаций по ИНН/названию · DaData + СПАРК · картотека',
  mount(root, ctx){
    const U = ctx.ui;
    const STORE_KEY = 'counterparties';

    // --- нормализация ответа DaData/СПАРК к единому виду карточки ---
    function normalize(raw, source){
      if(!raw) return null;
      // DaData findById/suggest отдаёт массив suggestions ИЛИ объект {suggestions:[...]}
      let s = raw;
      if (Array.isArray(raw)) s = raw[0];
      else if (raw.suggestions) s = (raw.suggestions||[])[0];
      if(!s) return null;
      const d = s.data || s; // DaData кладёт реквизиты в .data; СПАРК-мок — плоско
      const name =
        s.value || (d.name && (d.name.full_with_opf || d.name.short_with_opf || d.name.full)) ||
        d.fullName || d.shortName || d.name || '—';
      const status =
        (d.state && (d.state.status || d.state.code)) || d.status || d.statusText || '—';
      return {
        name: name,
        inn: d.inn || d.INN || '—',
        ogrn: d.ogrn || d.OGRN || '—',
        kpp: d.kpp || d.KPP || '',
        address:
          (d.address && (d.address.unrestricted_value || d.address.value)) ||
          d.address || d.legalAddress || '—',
        director:
          (d.management && (d.management.name || d.management.post && d.management.name)) ||
          d.director || d.head || d.ceo || '—',
        directorPost: (d.management && d.management.post) || d.directorPost || 'Руководитель',
        status: humanStatus(status),
        statusRaw: String(status||'').toUpperCase(),
        source: source
      };
    }
    function humanStatus(s){
      const m = String(s||'').toUpperCase();
      if (m.indexOf('ACTIVE') >= 0 || m.indexOf('ДЕЙСТВ') >= 0) return 'Действующая';
      if (m.indexOf('LIQUIDAT') >= 0 || m.indexOf('ЛИКВИД') >= 0) return 'Ликвидирована';
      if (m.indexOf('REORGANIZ') >= 0) return 'Реорганизация';
      if (m.indexOf('BANKRUPT') >= 0 || m.indexOf('БАНКРОТ') >= 0) return 'Банкротство';
      return s || '—';
    }
    function statusOk(card){
      const m = card.statusRaw;
      return m.indexOf('ACTIVE') >= 0 || m.indexOf('ДЕЙСТВ') >= 0;
    }

    // --- картотека (ctx.store) ---
    function load(){ const a = ctx.store.get(STORE_KEY, []); return Array.isArray(a) ? a : []; }
    function persist(a){ ctx.store.set(STORE_KEY, a); }

    // --- разметка ---
    root.innerHTML =
      U.card('Пробив контрагента',
        'Введите ИНН (10 или 12 цифр) или название организации. DaData — из браузера; СПАРК — только в desktop-версии (демо-данные в web).',
        `<div class="field">
           <label>ИНН или название организации</label>
           <input id="q" placeholder="7707083893 или «Газпром»" autocomplete="off">
         </div>
         <div class="btn-row">
           <button class="btn primary" id="btn-dadata">🔎 DaData</button>
           <button class="btn" id="btn-spark">⚡ СПАРК</button>
           <span id="status" class="badge" style="display:none"></span>
         </div>`) +
      `<div id="result"></div>` +
      U.card('Картотека', 'Найденные контрагенты сохраняются здесь. Кнопка «В лицензирование» открывает оформление документов.',
        `<div id="cards"></div>`);

    const elQ = root.querySelector('#q');
    const elStatus = root.querySelector('#status');
    const elResult = root.querySelector('#result');
    const elCards = root.querySelector('#cards');

    function setBusy(busy, label){
      root.querySelector('#btn-dadata').disabled = busy;
      root.querySelector('#btn-spark').disabled = busy;
      if(busy){ elStatus.style.display=''; elStatus.className='badge'; elStatus.innerHTML = U.spinner + ' ' + U.escape(label||'Запрос…'); }
      else { elStatus.style.display='none'; }
    }

    // --- бейдж демо/только desktop ---
    function sourceBadge(res){
      if(!res || !res.mock) return '<span class="badge ok">данные получены</span>';
      if(res.reason === 'web-blocked') return '<span class="badge warn" title="'+U.escape(res.note||'')+'">демо · только desktop</span>';
      return '<span class="badge warn" title="'+U.escape(res.note||'')+'">демо · нет ключей</span>';
    }

    function renderResult(card, res){
      if(!card){ elResult.innerHTML = U.card('Результат','', U.empty('🔍','Ничего не найдено. Проверьте ИНН или попробуйте другой источник.')); return; }
      elResult.innerHTML = U.card(
        U.escape(card.name),
        'Источник: ' + U.escape(card.source),
        `<div style="margin-bottom:10px">${sourceBadge(res)} ${card.status!=='—'?`<span class="badge ${statusOk(card)?'ok':'err'}">${U.escape(card.status)}</span>`:''}</div>
         <table class="tbl">
           <tbody>
             <tr><th>ИНН</th><td class="mono">${U.escape(card.inn)}${card.kpp?` <span class="muted">/ КПП ${U.escape(card.kpp)}</span>`:''}</td></tr>
             <tr><th>ОГРН</th><td class="mono">${U.escape(card.ogrn)}</td></tr>
             <tr><th>Адрес</th><td>${U.escape(card.address)}</td></tr>
             <tr><th>${U.escape(card.directorPost||'Руководитель')}</th><td>${U.escape(card.director)}</td></tr>
             <tr><th>Статус</th><td>${U.escape(card.status)}</td></tr>
           </tbody>
         </table>
         <div class="btn-row" style="margin-top:12px">
           <button class="btn primary sm" id="save">＋ В картотеку</button>
           <button class="btn sm" id="to-lic">→ В лицензирование</button>
         </div>`);
      elResult.querySelector('#save').onclick = ()=>addToList(card);
      elResult.querySelector('#to-lic').onclick = ()=>{ addToList(card, true); location.hash = '#/licensing'; };
    }

    function addToList(card, silent){
      const list = load();
      if (list.some(c => c.inn && card.inn && c.inn === card.inn && card.inn !== '—')){
        if(!silent) ctx.toast('Этот контрагент уже в картотеке','info');
        renderCards(); return;
      }
      list.unshift(Object.assign({ savedAt: new Date().toISOString() }, card));
      persist(list);
      if(!silent) ctx.toast('Добавлено в картотеку ✓','ok');
      renderCards();
    }

    function removeFromList(inn, savedAt){
      const list = load().filter(c => !(c.inn === inn && c.savedAt === savedAt));
      persist(list);
      renderCards();
    }

    function renderCards(){
      const list = load();
      if(!list.length){ elCards.innerHTML = U.empty('🗂️','Картотека пуста. Найдите организацию и нажмите «В картотеку».'); return; }
      elCards.innerHTML =
        `<table class="tbl">
           <thead><tr><th>Организация</th><th>ИНН</th><th>Статус</th><th>Источник</th><th></th></tr></thead>
           <tbody>` +
        list.map(c=>`
           <tr>
             <td>${U.escape(c.name)}</td>
             <td class="mono">${U.escape(c.inn)}</td>
             <td><span class="badge ${statusOk(c)?'ok':'err'}">${U.escape(c.status)}</span></td>
             <td><span class="badge">${U.escape(c.source||'—')}</span></td>
             <td style="text-align:right;white-space:nowrap">
               <button class="btn ghost sm" data-lic="${U.escape(c.inn)}" data-at="${U.escape(c.savedAt)}">→ лиценз.</button>
               <button class="btn ghost sm" data-del="${U.escape(c.inn)}" data-at="${U.escape(c.savedAt)}">✕</button>
             </td>
           </tr>`).join('') +
        `</tbody></table>`;
      elCards.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>removeFromList(b.dataset.del, b.dataset.at));
      elCards.querySelectorAll('[data-lic]').forEach(b=>b.onclick=()=>{ location.hash = '#/licensing'; });
    }

    // --- запросы ---
    async function runDaData(){
      const q = elQ.value.trim();
      if(!q) return ctx.toast('Введите ИНН или название','err');
      const onlyDigits = /^\d{10}(\d{2})?$/.test(q);
      setBusy(true, onlyDigits ? 'DaData: findById…' : 'DaData: suggest…');
      try{
        const res = await ctx.integrations.dadata.run(onlyDigits ? 'findById' : 'suggest', { query: q });
        renderResult(normalize(res && res.data, 'DaData'), res);
        if(res && res.note) ctx.toast(res.note, res.reason==='web-blocked'?'info':'info');
        else if(res && res.error) ctx.toast('DaData: '+res.error, 'err');
      }catch(e){ ctx.toast('Ошибка DaData: '+(e&&e.message||e),'err'); }
      finally{ setBusy(false); }
    }

    async function runSpark(){
      const q = elQ.value.trim();
      if(!q) return ctx.toast('Введите ИНН или название','err');
      setBusy(true, 'СПАРК: запрос…');
      try{
        const res = await ctx.integrations.spark.run('company', { inn: q, query: q });
        renderResult(normalize(res && res.data, 'СПАРК'), res);
        if(res && res.note) ctx.toast(res.note, 'info');
        else if(res && res.error) ctx.toast('СПАРК: '+res.error, 'err');
      }catch(e){ ctx.toast('Ошибка СПАРК: '+(e&&e.message||e),'err'); }
      finally{ setBusy(false); }
    }

    root.querySelector('#btn-dadata').onclick = runDaData;
    root.querySelector('#btn-spark').onclick = runSpark;
    elQ.addEventListener('keydown', e=>{ if(e.key==='Enter') runDaData(); });

    renderCards();
  }
});

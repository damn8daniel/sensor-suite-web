/* Модуль «Лицензирование» — ПОЛНАЯ ФАБРИКА документов «Спарты» (паритет УЦ-P1).
   Полный мастер подготовки пакета документов на лицензию МЧС (монтаж/ТО/ремонт
   средств ОПБ) и сопутствующих бумаг для ООО и ИП:
     1) форма организации (ООО/ИП) → 2) тип документа: из ВСТРОЕННЫХ шаблонов
        window.SPARTA_TEMPLATES (с пометкой «реальный шаблон»), а при их отсутствии —
        из каталога имён window.SEED.sparta (фолбэк) →
     3) если у типа есть встроенный b64-шаблон и window.SPARTA_FIELDS[form][docId] —
        ФОРМА ПОЛЕЙ по токенам (label + подсказка source); кнопка «Заполнить из
        контрагента (DaData)» подтягивает {ORG_*}/{IP_*} реквизиты по ИНН →
     4) реквизиты с валидацией ИНН/КПП/ОГРН(ИП) по контрольным суммам →
     5) генерация .docx из ВСТРОЕННОГО шаблона (декод b64 → PizZip → docxtemplater),
        либо из загруженного пользователем .docx, либо текстовый предпросмотр/экспорт →
     6) «Сгенерировать ВЕСЬ пакет» — все встроенные документы формы одним .zip →
     7) сохранение/загрузка черновиков.
   SPARTA_TEMPLATES = { 'ООО':{docId:{name,b64,tokens?}}, 'ИП':{docId:{...}} }
   SPARTA_FIELDS    = { 'ООО':{docId:[{token,label,source}]}, 'ИП':{docId:[...]} }
   Файлы sparta-ooo.js/sparta-ip.js могут быть ещё пустыми — всё читается в рантайме
   с фолбэком на текущий каталог имён, генерация обёрнута в try/catch.
   Контракт сохранён: id 'licensing', dept 'Лицензирование', order 20.
   Без import/export, только SensorApp.register и ctx.ui-хелперы. */
SensorApp.register({
  id: 'licensing', title: 'Лицензирование', dept: 'Лицензирование', order: 20,
  icon: '🛡️', description: 'Пакеты документов на лицензию · ООО / ИП · автозаполнение по ИНН, валидация реквизитов',

  /* быстрые действия для командной палитры (⌘K) */
  actions: [
    { id:'preview', title:'Предпросмотр документа', hint:'Собрать текст из реквизитов', icon:'👁',
      run(ctx){ const b=document.getElementById('lic-preview'); if(b) b.click(); } },
    { id:'gen', title:'Сгенерировать документ', hint:'docx из шаблона или .txt', icon:'⤓',
      run(ctx){ const b=document.getElementById('lic-gen'); if(b) b.click(); } },
    { id:'lookup', title:'Заполнить из контрагента (DaData)', hint:'Подтянуть реквизиты по ИНН', icon:'🔎',
      run(ctx){ const b=document.getElementById('lic-lookup'); if(b) b.click(); } },
    { id:'draft', title:'Сохранить черновик пакета', hint:'Запомнить реквизиты и тип', icon:'💾',
      run(ctx){ const b=document.getElementById('lic-save-draft'); if(b) b.click(); } },
    { id:'pkg', title:'Сгенерировать ВЕСЬ пакет', hint:'Все встроенные документы формы в .zip', icon:'📦',
      run(ctx){ const b=document.getElementById('lic-gen-pkg'); if(b) b.click(); } }
  ],

  mount(root, ctx){
    const U  = ctx.ui;
    const E  = U.escape;
    const DRAFTS_KEY = 'licensing_drafts';

    /* ====================================================================
       1. СПРАВОЧНИК ТИПОВ ДОКУМЕНТОВ  (источник: window.SEED.sparta)
       Поддерживаем все исторические формы сида:
         • {types:[{group:'ООО'|'ИП', templates:[строки|{id,name}]}]}  (текущий сид)
         • {templates:[...]} / {documents:[...]} / просто массив         (легаси)
       ==================================================================== */
    const FALLBACK = [
      { id:'info_letter',  name:'Информационное письмо о невозможности проведения проверки удалённо', forms:['ООО','ИП'] },
      { id:'priobschenie', name:'Приобщение документов на проверке',                                  forms:['ООО','ИП'] },
      { id:'prikaz_otv',   name:'Приказ о назначении ответственного (ЛВД)',                           forms:['ООО','ИП'] },
      { id:'prikaz_uvol',  name:'Приказ об увольнении',                                               forms:['ООО','ИП'] },
      { id:'cheklist_case',name:'Чек-лист для сбора чемодана',                                         forms:['ООО','ИП'] },
      { id:'arenda',       name:'Договор аренды оборудования',                                         forms:['ООО','ИП'] },
      { id:'arenda_break', name:'Соглашение о расторжении договора аренды оборудования',               forms:['ООО','ИП'] },
      { id:'doverennost',  name:'Доверенность на представление интересов в ГУ МЧС',                    forms:['ООО','ИП'] },
      { id:'td1',          name:'Трудовой договор — Форма 1',                                          forms:['ООО','ИП'] },
      { id:'td4',          name:'Трудовой договор — Форма 4',                                          forms:['ООО','ИП'] }
    ];

    const sparta = (ctx.data && ctx.data.sparta) || {};

    /* ВСТРОЕННЫЕ шаблоны Спарты (пишутся параллельными агентами в sparta-ooo.js /
       sparta-ip.js). Читаются в рантайме; на момент работы могут быть пустыми {}. */
    const SPARTA_TPL = (typeof window !== 'undefined' && window.SPARTA_TEMPLATES && typeof window.SPARTA_TEMPLATES === 'object') ? window.SPARTA_TEMPLATES : {};
    const SPARTA_FLD = (typeof window !== 'undefined' && window.SPARTA_FIELDS    && typeof window.SPARTA_FIELDS    === 'object') ? window.SPARTA_FIELDS    : {};
    // есть ли встроенные шаблоны хоть для одной формы
    function tplMapFor(form){ const m = SPARTA_TPL[form]; return (m && typeof m === 'object') ? m : null; }
    function fieldsFor(form, docId){ const m = SPARTA_FLD[form]; const a = m && m[docId]; return Array.isArray(a) ? a : null; }
    function tplEntry(form, docId){ const m = tplMapFor(form); const e = m && m[docId]; return (e && (e.b64 || e.name)) ? e : null; }
    const hasBuiltinTemplates = ['ООО','ИП'].some(f => { const m = tplMapFor(f); return m && Object.keys(m).length; });

    // привести любое значение к {id,name}
    const slug = s => 'd_' + String(s).toLowerCase()
      .replace(/[«»"'(),.]/g,'').replace(/[^a-zа-я0-9]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,40);
    function asItem(t, i){
      if (t && typeof t === 'object'){
        const name = t.name || t.title || ('Документ ' + (i + 1));
        return { id: t.id || slug(name), name, forms: Array.isArray(t.forms) && t.forms.length ? t.forms : null };
      }
      const name = String(t);
      return { id: slug(name), name, forms: null };
    }

    let docTypes = [];
    if (hasBuiltinTemplates){
      /* ИСТОЧНИК — ВСТРОЕННЫЕ ШАБЛОНЫ: один тип на (форма+docId). Один и тот же docId,
         встречающийся в обеих формах, схлопывается в тип с обеими формами; b64 хранится
         по форме отдельно (см. tplEntry). builtin:true → пометка «реальный шаблон». */
      const byId = new Map();
      ['ООО','ИП'].forEach(form => {
        const m = tplMapFor(form); if (!m) return;
        Object.keys(m).forEach(docId => {
          const e = m[docId] || {};
          const name = e.name || docId;
          if (!byId.has(docId)) byId.set(docId, { id: docId, name, forms: new Set(), builtin: true });
          byId.get(docId).forms.add(form);
        });
      });
      docTypes = [...byId.values()].map(d => ({ id: d.id, name: d.name, forms: [...d.forms], builtin: true }));
    } else
    if (Array.isArray(sparta.types) && sparta.types.length){
      // сводим одинаковые имена документов из разных групп в один тип с обеими формами
      const byName = new Map();
      sparta.types.forEach(grp => {
        const form = /ип/i.test(grp.group || '') ? 'ИП' : (/ооо|юр/i.test(grp.group || '') ? 'ООО' : (grp.group || ''));
        (grp.templates || grp.documents || []).forEach((t, i) => {
          const it = asItem(t, i);
          // нормализуем «… (для ИП)» / «… (ЛВД, для ИП)» к общему имени,
          // чтобы схлопнуть дубликаты по форме, сохранив уточнение в скобках.
          let baseName = it.name
            // «(ЛВД, для ИП)» → «(ЛВД)», «(ЛВД, для ООО)» → «(ЛВД)»
            .replace(/,\s*для\s+(ИП|ООО)\s*\)/gi, ')')
            // «(для ИП)» / «(для ООО)» целиком — убрать
            .replace(/\s*\(\s*для\s+(ИП|ООО)\s*\)/gi, '')
            // хвостовое «(ИП)» / «ИП» без скобок
            .replace(/\s*\(?\s*ИП\s*\)?\s*$/i, '')
            .replace(/\s*\(\s*\)\s*/g, ' ')
            .trim();
          if (!baseName) baseName = it.name.trim();
          const key = baseName.toLowerCase();
          if (!byName.has(key)) byName.set(key, { id: slug(baseName), name: baseName, forms: new Set() });
          if (form) byName.get(key).forms.add(form);
        });
      });
      docTypes = [...byName.values()].map(d => ({ id: d.id, name: d.name, forms: d.forms.size ? [...d.forms] : ['ООО','ИП'] }));
    } else {
      const list = Array.isArray(sparta) ? sparta
                 : (Array.isArray(sparta.templates) ? sparta.templates
                 : (Array.isArray(sparta.documents) ? sparta.documents : FALLBACK));
      docTypes = list.map((t, i) => { const it = asItem(t, i); return { id: it.id, name: it.name, forms: it.forms || ['ООО','ИП'] }; });
    }
    if (!docTypes.length) docTypes = FALLBACK;
    const docSource = hasBuiltinTemplates
      ? 'встроенные обезличенные шаблоны .docx (реальные бланки «Спарты»)'
      : (sparta.source || 'каталог шаблонов СПАРТА (обезличено)');

    /* ====================================================================
       2. РЕКВИЗИТЫ
       ==================================================================== */
    const FIELDS = [
      { key:'name',     label:'Наименование организации', ph:'ООО «Ромашка» / ИП Иванов Иван Иванович', req:true,  hint:'Полное наименование с организационно-правовой формой' },
      { key:'inn',      label:'ИНН',                       ph:'10 цифр — ООО · 12 цифр — ИП', mono:true, req:true,  maxlen:12, digits:true },
      { key:'ogrn',     label:'ОГРН / ОГРНИП',             ph:'13 цифр (ОГРН) или 15 (ОГРНИП)', mono:true, maxlen:15, digits:true },
      { key:'kpp',      label:'КПП',                       ph:'9 знаков', mono:true, maxlen:9, oooOnly:true, hint:'Только для ООО' },
      { key:'address',  label:'Юридический адрес',         ph:'г. Москва, ул. Примерная, д. 1, оф. 10' },
      { key:'director', label:'Руководитель / ИП',         ph:'Иванов Иван Иванович', hint:'ФИО и при необходимости должность' },
      { key:'post',     label:'Должность подписанта',      ph:'Генеральный директор', oooOnly:true },
      { key:'phone',    label:'Телефон',                   ph:'+7 (___) ___-__-__' },
      { key:'work',     label:'Вид работ',                 ph:'Монтаж, ТО и ремонт средств обеспечения пожарной безопасности', full:true }
    ];

    let state = { form:'ООО', docType: docTypes[0] && docTypes[0].id, tpl:null, tplName:'', tokens:[], docFilter:'', docValues:{} };

    /* ====================================================================
       3. РАЗМЕТКА
       ==================================================================== */
    root.innerHTML =
      U.card('Что готовим',
        'Выберите форму организации и тип документа. Перечень типов — из каталога «Спарты»; формы переведены в проверяемые поля.',
        `<div class="field"><label id="lbl-form">Форма организации</label>
           <div class="pill-tabs" id="form-tabs" role="tablist" aria-labelledby="lbl-form">
             <button type="button" class="pill ${state.form==='ООО'?'active':''}" role="tab" aria-selected="${state.form==='ООО'}" data-form="ООО">ООО</button>
             <button type="button" class="pill ${state.form==='ИП'?'active':''}" role="tab" aria-selected="${state.form==='ИП'}" data-form="ИП">ИП</button>
           </div></div>
         <div class="field">
           <label for="doc-filter">Тип документа <span class="tok" id="doc-count"></span></label>
           <input id="doc-filter" type="search" placeholder="Поиск по типу документа…" autocomplete="off" spellcheck="false" style="margin-bottom:8px">
           <select id="doc-type" size="1" aria-label="Тип документа"></select>
           <p class="hint" id="doc-meta" style="margin:8px 0 0"></p>
         </div>`) +

      U.card('Реквизиты',
        'Заполните вручную или подтяните по ИНН из картотеки контрагентов (DaData). Контрольные суммы ИНН/ОГРН/КПП проверяются на лету.',
        `<div class="btn-row" style="margin-bottom:6px">
           <input id="lookup-inn" placeholder="ИНН для пробива" class="mono" inputmode="numeric" autocomplete="off" style="max-width:220px">
           <button class="btn" id="lic-lookup" type="button">🔎 Заполнить из контрагента</button>
           <span id="lookup-note" class="badge" style="display:none"></span>
           <button class="btn ghost sm" id="lic-demo" type="button" style="margin-left:auto" title="Подставить корректный демо-образец реквизитов">Демо-образец</button>
         </div>
         <p class="foot" style="margin:0 0 14px">Подсказка: введите ИНН и нажмите Enter, чтобы подтянуть реквизиты, либо заполните поля вручную.</p>
         <div id="req-fields" class="grid cols-2"></div>
         <div id="req-errors" style="margin-top:6px"></div>
         <div class="divider"></div>
         <div id="completeness"></div>`) +

      U.card('Поля документа',
        'Поля встроенного шаблона выбранного типа. Реквизиты {ORG_*}/{IP_*} подтягиваются из блока «Реквизиты» (в т.ч. по ИНН через DaData); остальные заполните вручную.',
        `<div id="doc-fields-wrap"></div>`) +

      U.card('Свой шаблон документа (необязательно)',
        'Загрузите .docx с полями вида {ОРГАНИЗАЦИЯ}, {ИНН}, {АДРЕС} — заполним их данными формы. Без шаблона соберём аккуратный текстовый документ.',
        `<div class="btn-row">
           <label class="btn primary">📎 Загрузить .docx<input id="tpl" type="file" accept=".docx" hidden></label>
           <button class="btn ghost" id="tpl-clear" type="button" style="display:none">Убрать шаблон</button>
           <span id="tplname" class="badge">шаблон не выбран</span>
         </div>
         <div id="tpl-tokens" style="margin-top:12px"></div>`) +

      U.card('Готовность пакета',
        'Сводка по выбранному документу и реквизитам. Обновляется по мере заполнения формы.',
        `<div id="lic-passport"></div>`) +

      U.card('Генерация и предпросмотр', 'Соберите .docx из встроенного/загруженного шаблона или текстовый документ — либо посмотрите предпросмотр. «Весь пакет» собирает все встроенные документы выбранной формы в один .zip.',
        `<div class="btn-row">
           <button class="btn primary" id="lic-gen" type="button">⤓ Сгенерировать .docx</button>
           <button class="btn" id="lic-gen-pkg" type="button" style="display:none">📦 Сгенерировать ВЕСЬ пакет</button>
           <button class="btn" id="lic-preview" type="button">👁 Предпросмотр</button>
           <button class="btn" id="lic-copy" type="button">⧉ Копировать текст</button>
           <button class="btn ghost" id="lic-clear" type="button" style="margin-left:auto">Очистить форму</button>
         </div>
         <div id="lic-pkg-progress" hidden style="margin-top:10px"></div>
         <div id="preview-wrap" style="margin-top:14px"></div>`) +

      U.card('Черновики пакетов',
        'Сохраняйте набор реквизитов и тип документа, чтобы вернуться к нему позже. Хранится локально на этом устройстве.',
        `<div class="btn-row" style="margin-bottom:6px">
           <button class="btn" id="lic-save-draft" type="button">💾 Сохранить текущий как черновик</button>
         </div>
         <div id="drafts-wrap" style="margin-top:8px"></div>`) +

      U.card('Справочник типов документов «Спарты» ('+docTypes.length+')',
        'Источник: '+docSource+'. Доступность по форме организации указана бейджем.',
        `<div id="catalog-wrap"></div>`);

    /* короткие ссылки на узлы */
    const sel        = root.querySelector('#doc-type');
    const docFilter  = root.querySelector('#doc-filter');
    const docMeta    = root.querySelector('#doc-meta');
    const docCount   = root.querySelector('#doc-count');
    const reqWrap    = root.querySelector('#req-fields');
    const reqErrors  = root.querySelector('#req-errors');
    const completeEl = root.querySelector('#completeness');
    const previewWrap= root.querySelector('#preview-wrap');
    const draftsWrap = root.querySelector('#drafts-wrap');
    const passportEl = root.querySelector('#lic-passport');
    const docFieldsWrap = root.querySelector('#doc-fields-wrap');
    const genPkgBtn  = root.querySelector('#lic-gen-pkg');

    /* ====================================================================
       4. ТИПЫ ДОКУМЕНТОВ: фильтр + селект + мета
       ==================================================================== */
    function typesForForm(){ return docTypes.filter(d => d.forms.indexOf(state.form) >= 0); }
    function visibleTypes(){
      const q = state.docFilter.trim().toLowerCase();
      const base = typesForForm();
      return q ? base.filter(d => d.name.toLowerCase().indexOf(q) >= 0) : base;
    }
    function fillTypes(){
      const list = visibleTypes();
      const all = typesForForm();
      sel.innerHTML = list.length
        ? list.map(d => `<option value="${E(d.id)}">${E(d.name)}</option>`).join('')
        : `<option value="" disabled selected>Ничего не найдено</option>`;
      if (list.length){
        if (!list.find(d => d.id === state.docType)) state.docType = list[0].id;
        sel.value = state.docType;
      } else { state.docType = ''; }
      docCount.textContent = state.docFilter
        ? `${list.length} из ${all.length}`
        : `${all.length} для ${state.form}`;
      updateDocMeta();
      renderDocFields();
    }
    function updateDocMeta(){
      const dt = docTypes.find(d => d.id === state.docType);
      if (!dt){ docMeta.textContent = 'Выберите тип документа.'; return; }
      const real = dt.builtin && tplEntry(state.form, dt.id);
      docMeta.innerHTML = `Выбран: <strong>${E(dt.name)}</strong> · доступен для ${dt.forms.map(f=>E(f)).join(' и ')}.`
        + (real ? ` <span class="badge ok dot" title="генерация из встроенного .docx-бланка">реальный шаблон</span>` : '');
    }
    sel.addEventListener('change', () => { state.docType = sel.value; updateDocMeta(); renderDocFields(); renderPassport(); });
    docFilter.addEventListener('input', U.debounce(() => { state.docFilter = docFilter.value; fillTypes(); }, 140));

    /* ====================================================================
       5. ТАБЫ ФОРМЫ ОРГАНИЗАЦИИ
       ==================================================================== */
    root.querySelector('#form-tabs').addEventListener('click', e => {
      const p = e.target.closest('.pill'); if (!p) return;
      setForm(p.dataset.form);
    });
    function setForm(form){
      if (state.form === form) return;
      const vals = collect();              // сохраняем введённое при переключении
      state.form = form;
      root.querySelectorAll('#form-tabs .pill').forEach(x => {
        const on = x.dataset.form === form; x.classList.toggle('active', on); x.setAttribute('aria-selected', on);
      });
      fillTypes();
      renderFields(vals);
      renderCatalog();
    }

    /* ====================================================================
       6. ПОЛЯ РЕКВИЗИТОВ
       ==================================================================== */
    function fieldsForForm(){ return FIELDS.filter(f => !(f.oooOnly && state.form === 'ИП')); }
    function renderFields(preset){
      const vals = preset || collect();
      reqWrap.innerHTML = fieldsForForm().map(f => {
        const attrs = [
          `data-key="${E(f.key)}"`,
          `id="f-${E(f.key)}"`,
          `placeholder="${E(f.ph)}"`,
          f.mono ? 'class="mono"' : '',
          f.maxlen ? `maxlength="${f.maxlen}"` : '',
          f.digits ? 'inputmode="numeric"' : '',
          'autocomplete="off"',
          `value="${E(vals[f.key] || '')}"`
        ].filter(Boolean).join(' ');
        const tok = f.req ? 'обязательно' : (f.hint || '');
        const cell = U.field(f.label, `<input ${attrs}>`, tok);
        return f.full ? `<div style="grid-column:1/-1">${cell}</div>` : cell;
      }).join('');
      // живая валидация цифровых полей
      ['inn','ogrn','kpp'].forEach(k => {
        const inp = reqWrap.querySelector(`[data-key="${k}"]`);
        if (inp) inp.addEventListener('input', () => {
          if (k !== 'kpp') inp.value = inp.value.replace(/\D/g, '');
          runValidation(); updateCompleteness();
        });
      });
      fieldsForForm().forEach(f => {
        const inp = reqWrap.querySelector(`[data-key="${f.key}"]`);
        if (inp) inp.addEventListener('input', U.debounce(updateCompleteness, 120));
      });
      runValidation(); updateCompleteness();
    }
    function collect(){
      const o = {};
      reqWrap.querySelectorAll('[data-key]').forEach(i => o[i.dataset.key] = i.value.trim());
      return o;
    }
    function setVals(map){
      reqWrap.querySelectorAll('[data-key]').forEach(i => { if (map[i.dataset.key] != null) i.value = map[i.dataset.key]; });
    }

    /* ====================================================================
       7. ВАЛИДАЦИЯ ИНН / ОГРН / КПП (контрольные суммы)
       ==================================================================== */
    function innChecksum(inn){
      const d = inn.split('').map(Number);
      const k = w => w.reduce((s, wi, i) => s + wi * d[i], 0) % 11 % 10;
      if (inn.length === 10) return d[9] === k([2,4,10,3,5,9,4,6,8]);
      if (inn.length === 12){
        const n11 = k([7,2,4,10,3,5,9,4,6,8]);
        const n12 = k([3,7,2,4,10,3,5,9,4,6,8]);
        return d[10] === n11 && d[11] === n12;
      }
      return false;
    }
    // ОГРН (13) и ОГРНИП (15): последняя цифра = (число без неё) mod (len-2) mod 10
    function ogrnChecksum(ogrn){
      if (!/^\d+$/.test(ogrn)) return false;
      if (ogrn.length === 13){
        const ctrl = Number(BigIntSafe(ogrn.slice(0, 12)) % 11n % 10n);
        return ctrl === Number(ogrn[12]);
      }
      if (ogrn.length === 15){
        const ctrl = Number(BigIntSafe(ogrn.slice(0, 14)) % 13n % 10n);
        return ctrl === Number(ogrn[14]);
      }
      return false;
    }
    function BigIntSafe(s){ try { return BigInt(s); } catch(e){ return 0n; } }

    // вернуть {state:'ok'|'err'|'idle', msg} по конкретному полю
    function checkInn(v){
      if (!v) return { state:'idle' };
      if (!/^\d+$/.test(v)) return { state:'err', msg:'ИНН: только цифры' };
      const need = state.form === 'ООО' ? 10 : 12;
      if (v.length !== need) return { state:'err', msg:`ИНН ${state.form}: нужно ${need} цифр (введено ${v.length})` };
      if (!innChecksum(v)) return { state:'err', msg:'ИНН: не сходится контрольная сумма' };
      return { state:'ok', msg:'ИНН корректен' };
    }
    function checkOgrn(v){
      if (!v) return { state:'idle' };
      if (!/^\d+$/.test(v)) return { state:'err', msg:'ОГРН: только цифры' };
      const need = state.form === 'ООО' ? 13 : 15;
      if (v.length !== need) return { state:'err', msg:`${state.form==='ООО'?'ОГРН':'ОГРНИП'}: нужно ${need} цифр (введено ${v.length})` };
      if (!ogrnChecksum(v)) return { state:'err', msg:`${state.form==='ООО'?'ОГРН':'ОГРНИП'}: контрольный разряд не совпал` };
      return { state:'ok', msg:`${state.form==='ООО'?'ОГРН':'ОГРНИП'} корректен` };
    }
    function checkKpp(v){
      if (!v || state.form === 'ИП') return { state:'idle' };
      if (!/^\d{4}[\dA-Z]{2}\d{3}$/i.test(v)) return { state:'err', msg:'КПП: формат NNNNPPNNN (9 знаков)' };
      return { state:'ok', msg:'КПП корректен' };
    }

    function runValidation(){
      const v = collect();
      const checks = { inn: checkInn(v.inn || ''), ogrn: checkOgrn(v.ogrn || ''), kpp: checkKpp(v.kpp || '') };
      // покрасить поля
      Object.keys(checks).forEach(k => {
        const inp = reqWrap.querySelector(`[data-key="${k}"]`);
        if (!inp) return;
        if (checks[k].state === 'err') inp.setAttribute('aria-invalid', 'true');
        else inp.removeAttribute('aria-invalid');
      });
      // собрать строку статусов
      const chips = [];
      [['inn','ИНН'],['ogrn','ОГРН'],['kpp','КПП']].forEach(([k]) => {
        const c = checks[k];
        if (c.state === 'ok')  chips.push(`<span class="badge ok">${E(c.msg)} ✓</span>`);
        if (c.state === 'err') chips.push(`<span class="badge err">${E(c.msg)}</span>`);
      });
      reqErrors.innerHTML = chips.length ? `<div class="btn-row">${chips.join('')}</div>` : '';
      return checks;
    }
    function validForGen(){
      const c = runValidation();
      // ИНН обязателен и должен быть корректен; ОГРН/КПП — если заполнены, не должны быть с ошибкой
      const v = collect();
      if (!v.inn) return { ok:false, msg:'Укажите ИНН организации' };
      if (c.inn.state !== 'ok') return { ok:false, msg:c.inn.msg || 'Проверьте ИНН' };
      if (c.ogrn.state === 'err') return { ok:false, msg:c.ogrn.msg };
      if (c.kpp.state === 'err') return { ok:false, msg:c.kpp.msg };
      return { ok:true };
    }

    /* ====================================================================
       8. ИНДИКАТОР ЗАПОЛНЕННОСТИ
       ==================================================================== */
    function updateCompleteness(){
      const v = collect();
      const fields = fieldsForForm();
      const filled = fields.filter(f => (v[f.key] || '').length).length;
      const pct = fields.length ? Math.round(filled / fields.length * 100) : 0;
      const reqMissing = fields.filter(f => f.req && !(v[f.key] || '').length).map(f => f.label.toLowerCase());
      completeEl.innerHTML =
        `<div style="display:flex;align-items:center;gap:10px">
           <div class="bar" style="flex:1"><span style="width:${pct}%"></span></div>
           <span class="mono muted" style="white-space:nowrap">${filled}/${fields.length} · ${pct}%</span>
         </div>
         <p class="foot" style="margin:8px 0 0">${
           reqMissing.length
             ? 'Не заполнено обязательное: ' + reqMissing.map(E).join(', ') + '.'
             : 'Обязательные поля заполнены. Можно генерировать документ.'
         }</p>`;
      renderPassport();
    }

    /* ====================================================================
       8b. ПАСПОРТ ПАКЕТА — сводная готовность к генерации
       Лёгкая «приборная панель»: что за документ, форма, статус реквизитов,
       способ генерации и итоговый вердикт. Помогает увидеть пакет целиком,
       не пролистывая форму. Использует только существующие классы/токены.
       ==================================================================== */
    function renderPassport(){
      if (!passportEl) return;
      const v   = collect();
      const dt  = docTypes.find(d => d.id === state.docType);
      const c   = { inn: checkInn(v.inn || ''), ogrn: checkOgrn(v.ogrn || ''), kpp: checkKpp(v.kpp || '') };
      const gen = validForGen();

      // строка-«реквизит» паспорта: подпись + значение + опциональный статус-бейдж
      const row = (label, value, badge) =>
        `<div style="display:flex;align-items:baseline;gap:10px;padding:7px 0;border-top:1px solid var(--line)">
           <span class="foot" style="flex:0 0 132px">${E(label)}</span>
           <span class="meta" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${value}</span>
           ${badge || ''}
         </div>`;

      const dash = '<span class="muted">—</span>';
      const idBadge = (chk, idleText) =>
        chk.state === 'ok'  ? `<span class="badge ok dot">${E(chk.msg)}</span>`
      : chk.state === 'err' ? `<span class="badge err dot">${E(chk.msg)}</span>`
      :                       `<span class="badge">${E(idleText)}</span>`;

      const dtP = docTypes.find(d => d.id === state.docType);
      const builtinP = dtP && dtP.builtin ? tplEntry(state.form, dtP.id) : null;
      const builtinFldsP = builtinP ? (builtinFieldsFor(state.form, dtP.id) || []) : [];
      const tplBadge = builtinP
        ? `<span class="badge ok dot">встроенный .docx · ${builtinFldsP.length} полей</span>`
        : state.tpl
        ? `<span class="badge ok dot">свой .docx · ${state.tokens.length} полей</span>`
        : `<span class="badge">текстовый документ</span>`;

      const verdict = gen.ok
        ? `<span class="badge ok dot">готово к генерации</span>`
        : `<span class="badge warn dot">${E(gen.msg || 'нужны данные')}</span>`;

      passportEl.innerHTML =
        `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
           <span class="badge info dot">${E(state.form)}</span>
           <strong style="font-size:13.5px">${dt ? E(dt.name) : 'Тип документа не выбран'}</strong>
           <span style="margin-left:auto">${verdict}</span>
         </div>` +
        row('Организация', v.name ? `<strong>${E(v.name)}</strong>` : dash) +
        row('ИНН', v.inn ? `<span class="mono">${E(v.inn)}</span>` : dash, v.inn ? idBadge(c.inn, '') : '') +
        row(state.form === 'ИП' ? 'ОГРНИП' : 'ОГРН', v.ogrn ? `<span class="mono">${E(v.ogrn)}</span>` : dash, v.ogrn ? idBadge(c.ogrn, '') : '') +
        (state.form === 'ООО'
          ? row('КПП', v.kpp ? `<span class="mono">${E(v.kpp)}</span>` : dash, v.kpp ? idBadge(c.kpp, '') : '')
          : '') +
        row('Подписант', v.director ? E(v.director) : dash) +
        row('Способ генерации', '', tplBadge);
    }

    /* ====================================================================
       9. АВТОЗАПОЛНЕНИЕ ИЗ DaData
       ==================================================================== */
    root.querySelector('#lic-lookup').addEventListener('click', async () => {
      const btn  = root.querySelector('#lic-lookup');
      const note = root.querySelector('#lookup-note');
      const raw  = (root.querySelector('#lookup-inn').value.trim()) || (collect().inn || '');
      const q    = raw.replace(/\s/g, '');
      if (!q) return ctx.toast('Укажите ИНН для пробива', 'err');
      const byId = /^\d{10}(\d{2})?$/.test(q);
      btn.disabled = true; const label = btn.innerHTML; btn.innerHTML = U.spinner + ' Поиск…';
      try {
        const dadata = ctx.integrations.dadata;
        const res = dadata ? await dadata.run(byId ? 'findById' : 'suggest', { query: q })
                           : { ok:false, data:null, note:'DaData не подключена' };
        const d = res && res.data;
        if (!d || !(d.name || d.inn)){ ctx.toast('Контрагент не найден', 'err'); note.style.display='none'; }
        else {
          apply(d);
          note.style.display = '';
          if (res.mock || !res.ok){
            note.className = 'badge warn';
            note.textContent = res.reason === 'web-blocked' ? 'демо · только desktop' : 'демо-данные';
            note.title = res.note || '';
          } else {
            note.className = 'badge ok'; note.textContent = 'данные DaData ✓'; note.title = '';
          }
          ctx.toast('Реквизиты заполнены', 'ok');
        }
      } catch (err){ ctx.toast('Ошибка пробива: ' + (err && err.message || err), 'err'); }
      finally { btn.disabled = false; btn.innerHTML = label; }
    });
    root.querySelector('#lookup-inn').addEventListener('keydown', e => {
      if (e.key === 'Enter'){ e.preventDefault(); root.querySelector('#lic-lookup').click(); }
    });

    /* быстрый старт: корректный обезличенный образец под текущую форму
       (контрольные суммы ИНН/ОГРН/КПП проходят валидацию — удобно для демо/обучения) */
    const DEMO = {
      'ООО': { name:'ООО «Ромашка»', inn:'7707083893', ogrn:'1027700132195', kpp:'770701001',
               address:'г. Москва, ул. Примерная, д. 1, оф. 10', director:'Иванов Иван Иванович',
               post:'Генеральный директор', phone:'+7 (495) 123-45-67',
               work:'Монтаж, ТО и ремонт средств обеспечения пожарной безопасности' },
      'ИП':  { name:'ИП Петров Пётр Петрович', inn:'500100732259', ogrn:'304500116000157',
               address:'Московская обл., г. Подольск, ул. Образцовая, д. 5', director:'Петров Пётр Петрович',
               phone:'+7 (495) 765-43-21',
               work:'Монтаж, ТО и ремонт средств обеспечения пожарной безопасности' }
    };
    root.querySelector('#lic-demo').addEventListener('click', () => {
      const d = DEMO[state.form] || DEMO['ООО'];
      setVals(Object.assign(Object.fromEntries(FIELDS.map(f => [f.key, ''])), d));
      runValidation(); updateCompleteness(); renderDocFields();
      ctx.toast('Подставлен демо-образец реквизитов', 'info');
    });

    function apply(d){
      // d — плоский объект DaData: {name,inn,ogrn,kpp,address,manager,status,type}
      // авто-переключение формы: приоритет у явного признака type (ИП/ЮЛ),
      // иначе — по числу ЦИФР ИНН (а не длине строки, чтобы пробелы/мусор не сбивали).
      const innDigits = String(d.inn || '').replace(/\D/g, '');
      const wantForm = (d.type === 'ИП' || d.type === 'INDIVIDUAL') ? 'ИП'
                     : (d.type === 'ЮЛ' || d.type === 'LEGAL')      ? 'ООО'
                     : innDigits.length === 12 ? 'ИП'
                     : innDigits.length === 10 ? 'ООО' : null;
      if (wantForm && state.form !== wantForm) setForm(wantForm);
      const map = { name:d.name, inn:d.inn, ogrn:d.ogrn, kpp:d.kpp, address:d.address, director:d.manager };
      Object.keys(map).forEach(k => { if (map[k] == null) delete map[k]; });
      setVals(map);
      runValidation(); updateCompleteness(); renderDocFields();
    }

    /* ====================================================================
       10. ШАБЛОН .docx
       ==================================================================== */
    function detect(zip){
      const set = new Set();
      const parts = zip.file(/word\/(document|header\d+|footer\d+)\.xml/);
      parts.forEach(p => { const text = p.asText().replace(/<[^>]+>/g, '');
        (text.match(/\{[^{}<>]+\}/g) || []).forEach(t => set.add(t.slice(1, -1).trim())); });
      return [...set];
    }
    root.querySelector('#tpl').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      if (!/\.docx$/i.test(file.name)){ resetTpl(); ctx.toast('Нужен файл .docx', 'err'); return; }
      const rd = new FileReader();
      rd.onload = () => {
        try {
          state.tpl = rd.result; state.tplName = file.name;
          const zip = new PizZip(state.tpl);
          state.tokens = detect(zip);
          root.querySelector('#tplname').textContent = file.name + ' · ' + state.tokens.length + ' полей';
          root.querySelector('#tplname').className = 'badge ok';
          root.querySelector('#tpl-clear').style.display = '';
          renderTokenReport(); renderPassport();
        } catch (err){ resetTpl(); ctx.toast('Не удалось прочитать шаблон: ' + (err && err.message || err), 'err'); }
      };
      rd.onerror = () => { resetTpl(); ctx.toast('Ошибка чтения файла', 'err'); };
      rd.readAsArrayBuffer(file);
    });
    root.querySelector('#tpl-clear').addEventListener('click', () => { resetTpl(); ctx.toast('Шаблон убран', 'info'); });
    function resetTpl(){
      state.tpl = null; state.tplName = ''; state.tokens = [];
      const b = root.querySelector('#tplname'); b.textContent = 'шаблон не выбран'; b.className = 'badge';
      root.querySelector('#tpl-clear').style.display = 'none';
      root.querySelector('#tpl-tokens').innerHTML = '';
      const inp = root.querySelector('#tpl'); if (inp) inp.value = '';
      renderPassport();
    }
    // какие токены шаблона мы умеем заполнять данными формы
    function renderTokenReport(){
      const wrap = root.querySelector('#tpl-tokens');
      if (!state.tokens.length){ wrap.innerHTML = `<p class="hint">В шаблоне не найдено полей вида <span class="mono">{ПОЛЕ}</span>.</p>`; return; }
      const data = docData();
      const known = state.tokens.filter(t => norm(t) in dataIndex(data));
      const unknown = state.tokens.filter(t => !(norm(t) in dataIndex(data)));
      wrap.innerHTML =
        `<p class="hint" style="margin-bottom:8px">Найдено полей: ${state.tokens.length}. Заполним: <strong>${known.length}</strong>${unknown.length?`, оставим пустыми: ${unknown.length}`:''}.</p>` +
        `<div class="btn-row">` +
          state.tokens.map(t => {
            const ok = norm(t) in dataIndex(data);
            return `<span class="badge ${ok?'ok':''}" title="${ok?'будет заполнено':'нет данных в форме'}">{${E(t)}}</span>`;
          }).join('') +
        `</div>`;
    }
    function norm(t){ return String(t).toUpperCase().replace(/\s+/g, '_').replace(/[ЁË]/g, 'Е'); }
    function dataIndex(data){ const ix = {}; Object.keys(data).forEach(k => ix[norm(k)] = data[k]); return ix; }

    /* ====================================================================
       10b. ВСТРОЕННЫЕ ШАБЛОНЫ СПАРТЫ: поля документа + значения по токенам
       Токены реальных бланков — латиницей (ORG_../IP_.. реквизиты + поля
       конкретного документа). Реквизиты из блока «Реквизиты» проецируются на
       ORG_../IP_.. токены автоматически; остальные токены заполняются вручную и
       хранятся в state.docValues[token].
       ==================================================================== */
    // карта: какие токены покрываются реквизитами формы (см. блок «Реквизиты»)
    function reqTokenMap(){
      const v = collect();
      const isIP = state.form === 'ИП';
      const m = {
        // организация / ИП
        ORG_FULL_NAME: v.name || '', ORG_SHORT_NAME: v.name || '', ORG_NAME: v.name || '',
        IP_FULL_NAME: isIP ? (v.name || '') : '', IP_NAME: isIP ? (v.name || '') : '',
        ORG_INN: v.inn || '', IP_INN: isIP ? (v.inn || '') : '', INN: v.inn || '',
        ORG_OGRN: !isIP ? (v.ogrn || '') : '', IP_OGRNIP: isIP ? (v.ogrn || '') : '', OGRN: v.ogrn || '', OGRNIP: isIP ? (v.ogrn || '') : '',
        ORG_KPP: v.kpp || '', KPP: v.kpp || '',
        ORG_ADDRESS: v.address || '', IP_ADDRESS: isIP ? (v.address || '') : '', ADDRESS: v.address || '',
        ORG_DIRECTOR: !isIP ? (v.director || '') : '', DIRECTOR: v.director || '',
        IP_FIO: isIP ? (v.director || v.name || '') : '', DIRECTOR_FIO: v.director || '',
        ORG_POSITION: !isIP ? (v.post || 'Генеральный директор') : '', POSITION: !isIP ? (v.post || '') : 'Индивидуальный предприниматель',
        ORG_PHONE: v.phone || '', IP_PHONE: isIP ? (v.phone || '') : '', PHONE: v.phone || '',
        WORK_TYPE: v.work || '', WORKS: v.work || '',
        DATE: new Date().toLocaleDateString('ru-RU'), CITY: 'Москва'
      };
      const out = {}; Object.keys(m).forEach(k => out[norm(k)] = m[k]); return out;
    }
    // есть ли у текущего выбора встроенный шаблон + список полей
    function builtinFieldsFor(form, docId){
      if (!tplEntry(form, docId)) return null;
      const flds = fieldsFor(form, docId);
      if (flds && flds.length) return flds;
      // полей нет в SPARTA_FIELDS, но шаблон есть — выведем поля из токенов шаблона
      const e = tplEntry(form, docId);
      const toks = Array.isArray(e.tokens) ? e.tokens : [];
      return toks.map(tk => ({ token: tk, label: tk, source: '' }));
    }
    function currentBuiltinFields(){ return builtinFieldsFor(state.form, state.docType); }
    // итоговые значения по токенам для render(): реквизиты + ручные поля документа
    function builtinValues(form, docId){
      const out = reqTokenMap();
      const flds = builtinFieldsFor(form, docId) || [];
      flds.forEach(f => {
        const tk = norm(f.token);
        const manual = state.docValues[tk];
        if (manual != null && String(manual).length) out[tk] = manual;     // ручной приоритет, если заполнено
        else if (!(tk in out)) out[tk] = '';                                // незаполненный токен — пусто
      });
      return out;
    }

    // отрисовать форму полей документа (только для встроенных шаблонов)
    function renderDocFields(){
      if (!docFieldsWrap) return;
      const dt = docTypes.find(d => d.id === state.docType);
      const flds = (dt && dt.builtin) ? currentBuiltinFields() : null;
      if (!flds || !flds.length){
        docFieldsWrap.innerHTML = hasBuiltinTemplates
          ? U.empty('🧩', 'У выбранного типа нет встроенного шаблона с полями — будет собран текстовый документ или используйте свой .docx ниже.')
          : U.empty('🧩', 'Встроенные шаблоны «Спарты» ещё не загружены. Документ соберётся текстом, либо загрузите свой .docx ниже.');
        if (genPkgBtn) genPkgBtn.style.display = 'none';
        return;
      }
      const reqIx = reqTokenMap();
      docFieldsWrap.innerHTML =
        `<p class="hint" style="margin-bottom:10px">Полей в документе: <strong>${flds.length}</strong>. Поля с пометкой <span class="tok">из реквизитов</span> подставятся автоматически — их можно переопределить.</p>` +
        `<div class="grid cols-2">` +
        flds.map(f => {
          const tk = norm(f.token);
          const fromReq = (tk in reqIx) && String(reqIx[tk]).length;
          const tok = f.source ? ('источник: ' + f.source) : (fromReq ? 'из реквизитов' : 'заполните вручную');
          const ph = fromReq ? String(reqIx[tk]) : ('{' + f.token + '}');
          const val = state.docValues[tk] != null ? state.docValues[tk] : '';
          const attrs = [
            `data-tok="${E(tk)}"`, `id="dt-${E(tk)}"`,
            `placeholder="${E(ph)}"`, 'autocomplete="off"', `value="${E(val)}"`
          ].join(' ');
          return U.field(f.label || f.token, `<input ${attrs}>`, tok);
        }).join('') +
        `</div>`;
      docFieldsWrap.querySelectorAll('[data-tok]').forEach(inp => {
        inp.addEventListener('input', U.debounce(() => {
          const tk = inp.dataset.tok;
          if (String(inp.value).length) state.docValues[tk] = inp.value;
          else delete state.docValues[tk];
        }, 120));
      });
      // показать кнопку пакетной генерации, если у формы есть встроенные шаблоны
      if (genPkgBtn){
        const m = tplMapFor(state.form);
        genPkgBtn.style.display = (m && Object.keys(m).length) ? '' : 'none';
      }
    }

    /* ====================================================================
       11. ДАННЫЕ ДЛЯ ДОКУМЕНТА  (синонимы полей шаблона)
       ==================================================================== */
    function docData(){
      const v = collect();
      const dt = docTypes.find(d => d.id === state.docType);
      const today = new Date().toLocaleDateString('ru-RU');
      return {
        ОРГАНИЗАЦИЯ: v.name || '', НАИМЕНОВАНИЕ: v.name || '', КОМПАНИЯ: v.name || '',
        ФОРМА: state.form,
        ИНН: v.inn || '',
        ОГРН: state.form === 'ООО' ? (v.ogrn || '') : '', ОГРНИП: state.form === 'ИП' ? (v.ogrn || '') : '',
        КПП: v.kpp || '',
        АДРЕС: v.address || '', ЮРАДРЕС: v.address || '', ЮРИДИЧЕСКИЙ_АДРЕС: v.address || '',
        ДИРЕКТОР: v.director || '', РУКОВОДИТЕЛЬ: v.director || '', ИП: state.form === 'ИП' ? (v.director || '') : '',
        ДОЛЖНОСТЬ: state.form === 'ООО' ? (v.post || 'Генеральный директор') : 'Индивидуальный предприниматель',
        ТЕЛЕФОН: v.phone || '',
        ВИД_РАБОТ: v.work || '', ВИДРАБОТ: v.work || '', РАБОТЫ: v.work || '',
        ТИП_ДОКУМЕНТА: dt ? dt.name : '', ДОКУМЕНТ: dt ? dt.name : '',
        ДАТА: today, ГОРОД: 'Москва'
      };
    }

    /* ====================================================================
       12. ТЕКСТОВЫЙ ДОКУМЕНТ (фолбэк без шаблона)
       ==================================================================== */
    function buildText(){
      const v = collect();
      const dt = docTypes.find(d => d.id === state.docType);
      const isIP = state.form === 'ИП';
      const L = [];
      L.push((dt ? dt.name : 'Документ').toUpperCase());
      L.push('');
      L.push('Реквизиты ' + (isIP ? 'индивидуального предпринимателя' : 'организации') + ':');
      L.push('  Форма: ' + state.form);
      L.push('  Наименование: ' + (v.name || '—'));
      L.push('  ИНН: ' + (v.inn || '—'));
      L.push('  ' + (isIP ? 'ОГРНИП' : 'ОГРН') + ': ' + (v.ogrn || '—'));
      if (!isIP) L.push('  КПП: ' + (v.kpp || '—'));
      L.push('  Юридический адрес: ' + (v.address || '—'));
      L.push('  ' + (isIP ? 'ИП' : 'Руководитель') + ': ' + (v.director || '—'));
      if (!isIP && v.post) L.push('  Должность: ' + v.post);
      if (v.phone) L.push('  Телефон: ' + v.phone);
      L.push('  Вид работ: ' + (v.work || '—'));
      L.push('');
      L.push('Дата: ' + new Date().toLocaleDateString('ru-RU') + ', г. Москва');
      L.push('');
      const signer = isIP ? (v.director || '') : (v.director || '');
      L.push((isIP ? 'ИП' : (v.post || 'Руководитель')) + ': ____________________ / ' + signer + ' /');
      L.push('М.П.');
      return L.join('\n');
    }
    function previewHTML(text){
      return `<pre class="mono" style="white-space:pre-wrap;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--radius-s);padding:14px;max-height:360px;overflow:auto;font-size:12.5px;line-height:1.6">${E(text)}</pre>`;
    }
    function previewEmpty(){
      previewWrap.innerHTML = U.empty('📄',
        'Предпросмотр появится здесь. Нажмите «Предпросмотр», чтобы собрать документ из текущих реквизитов.');
    }

    /* ====================================================================
       13. КНОПКИ: предпросмотр / копировать / очистить / генерация
       ==================================================================== */
    root.querySelector('#lic-preview').addEventListener('click', () => {
      previewWrap.innerHTML = previewHTML(buildText());
    });
    root.querySelector('#lic-copy').addEventListener('click', () => { U.copy(buildText(), 'Текст документа скопирован ✓'); });
    root.querySelector('#lic-clear').addEventListener('click', async () => {
      const yes = await U.confirm({ title:'Очистить форму', message:'Сбросить все реквизиты и предпросмотр?', ok:'Очистить', cancel:'Отмена', danger:true });
      if (!yes) return;
      setVals(Object.fromEntries(FIELDS.map(f => [f.key, ''])));
      state.docValues = {};
      root.querySelector('#lookup-inn').value = '';
      root.querySelector('#lookup-note').style.display = 'none';
      previewEmpty();
      renderDocFields();
      runValidation(); updateCompleteness();
      ctx.toast('Форма очищена', 'info');
    });

    const safeName = s => String(s || 'документ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'документ';

    // отрендерить ВСТРОЕННЫЙ b64-шаблон в .docx (Uint8Array). Бросает при ошибке.
    function renderBuiltin(entry, values){
      if (typeof PizZip === 'undefined' || typeof window === 'undefined' || !window.docxtemplater)
        throw new Error('Библиотеки PizZip/docxtemplater недоступны');
      const zip = new PizZip(entry.b64, { base64:true });
      const toks = Array.isArray(entry.tokens) ? entry.tokens : null;
      if (toks && !toks.length){
        // графический бланк без полей — отдаём как есть
        return zip.generate({ type:'uint8array', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      }
      const doc = new window.docxtemplater(zip, {
        paragraphLoop:true, linebreaks:true,
        delimiters:{ start:'{', end:'}' }, nullGetter:()=> ''
      });
      doc.render(values);
      return doc.getZip().generate({ type:'uint8array', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }

    root.querySelector('#lic-gen').addEventListener('click', () => {
      const valid = validForGen();
      if (!valid.ok) return ctx.toast(valid.msg, 'err');
      const v = collect();
      const dt = docTypes.find(d => d.id === state.docType);
      const base = safeName((dt ? dt.name : 'документ') + ' — ' + (v.name || state.form));
      const builtin = dt && dt.builtin ? tplEntry(state.form, dt.id) : null;

      if (builtin && builtin.b64){
        // ПРИОРИТЕТ — встроенный реальный шаблон Спарты
        try {
          const u8 = renderBuiltin(builtin, builtinValues(state.form, dt.id));
          const blob = new Blob([u8], { type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
          U.download(base + '.docx', blob);
          ctx.toast('Документ из встроенного шаблона сгенерирован ✓', 'ok');
        } catch (err){ ctx.toast('Ошибка генерации встроенного шаблона: ' + (err && err.message || err), 'err'); }
      } else if (state.tpl){
        try {
          const zip = new PizZip(state.tpl);
          const doc = new window.docxtemplater(zip, {
            paragraphLoop: true, linebreaks: true,
            delimiters: { start:'{', end:'}' }, nullGetter: () => ''
          });
          doc.render(dataIndex(docData()));   // ключи нормализованы под токены шаблона
          const blob = doc.getZip().generate({ type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
          U.download(base + '.docx', blob);
          ctx.toast('Документ из шаблона сгенерирован ✓', 'ok');
        } catch (err){ ctx.toast('Ошибка генерации шаблона: ' + (err && err.message || err), 'err'); }
      } else {
        const text = buildText();
        previewWrap.innerHTML = previewHTML(text);
        const blob = new Blob(['﻿' + text], { type:'text/plain;charset=utf-8' });
        U.download(base + '.txt', blob);
        ctx.toast('Текстовый документ собран и выгружен ✓', 'ok');
      }
    });

    /* ====================================================================
       13b. ПАКЕТНАЯ ГЕНЕРАЦИЯ — все встроенные документы формы → один .zip
       (паритет с фабрикой УЦ: декод b64 → PizZip → docxtemplater → zip).
       ==================================================================== */
    const pkgProg = root.querySelector('#lic-pkg-progress');
    function setPkgProgress(n, total, msg){
      if (!pkgProg) return;
      if (n >= total && !msg){ pkgProg.hidden = true; return; }
      pkgProg.hidden = false;
      const pct = total ? Math.round(n / total * 100) : 0;
      pkgProg.innerHTML = `<div style="display:flex;align-items:center;gap:10px"><div class="bar" style="flex:1"><span style="width:${pct}%"></span></div><span class="mono muted" style="white-space:nowrap">${E(msg || (n + ' из ' + total))}</span></div>`;
    }
    if (genPkgBtn) genPkgBtn.addEventListener('click', () => {
      const m = tplMapFor(state.form);
      const ids = m ? Object.keys(m) : [];
      if (!ids.length) return ctx.toast('Для формы «' + state.form + '» нет встроенных шаблонов', 'err');
      const valid = validForGen();
      if (!valid.ok) return ctx.toast(valid.msg, 'err');
      if (typeof PizZip === 'undefined' || typeof window === 'undefined' || !window.docxtemplater)
        return ctx.toast('Библиотеки генерации .docx недоступны', 'err');

      const v = collect();
      const total = ids.length;
      setPkgProgress(0, total, 'Подготовка…');
      genPkgBtn.disabled = true;
      const built = [];                 // {name, content}
      const usedNames = {};
      const uniqueName = base => { let n = base, i = 2; while (usedNames[n]){ n = base.replace(/\.docx$/i, '') + ' (' + (i++) + ').docx'; } usedNames[n] = true; return n; };
      try {
        ids.forEach((docId, i) => {
          const e = m[docId] || {};
          const title = e.name || docId;
          setPkgProgress(i, total, 'Сборка: ' + title + '…');
          if (!e.b64) return;           // нет тела шаблона — пропускаем
          const u8 = renderBuiltin(e, builtinValues(state.form, docId));
          built.push({ name: uniqueName(safeName(title) + '.docx'), content: u8 });
        });
        if (!built.length){ setPkgProgress(total, total, ''); return ctx.toast('Не из чего собирать пакет', 'err'); }
        const orgTag = safeName(v.name || state.form);
        if (built.length === 1){
          const blob = new Blob([built[0].content], { type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
          U.download(built[0].name, blob);
        } else {
          setPkgProgress(total, total, 'Упаковка в .zip…');
          const out = new PizZip();
          built.forEach(b => out.file(b.name, b.content));
          const zipBlob = out.generate({ type:'blob', mimeType:'application/zip' });
          U.download('Пакет ' + state.form + ' — ' + orgTag + '.zip', zipBlob);
        }
        setPkgProgress(total, total, '');
        ctx.toast('Пакет «' + state.form + '» собран: ' + built.length + ' док. ✓', 'ok');
      } catch (err){
        setPkgProgress(total, total, '');
        ctx.toast('Ошибка генерации пакета: ' + (err && err.message || err), 'err');
      } finally { genPkgBtn.disabled = false; }
    });

    /* ====================================================================
       14. ЧЕРНОВИКИ (ctx.store)
       ==================================================================== */
    function loadDrafts(){ const a = ctx.store.get(DRAFTS_KEY, []); return Array.isArray(a) ? a : []; }
    function saveDrafts(a){ ctx.store.set(DRAFTS_KEY, a); }

    root.querySelector('#lic-save-draft').addEventListener('click', async () => {
      const v = collect();
      const dt = docTypes.find(d => d.id === state.docType);
      const def = v.name || (dt ? dt.name : 'Черновик');
      const title = await U.prompt({ title:'Сохранить черновик', label:'Название черновика', value:def, required:true, ok:'Сохранить' });
      if (title == null) return;
      const list = loadDrafts();
      list.unshift({
        id: 'dft_' + Date.now().toString(36),
        title: String(title).trim().slice(0, 120),   // защита от чрезмерно длинных имён
        form: state.form, docType: state.docType, docName: dt ? dt.name : '',
        vals: v, docValues: Object.assign({}, state.docValues), savedAt: new Date().toISOString()
      });
      saveDrafts(list.slice(0, 50));
      renderDrafts();
      ctx.toast('Черновик сохранён ✓', 'ok');
    });

    function applyDraft(d){
      if (d.form && d.form !== state.form) setForm(d.form);
      if (d.docType){ state.docType = d.docType; }
      // тип мог быть скрыт фильтром — сбрасываем фильтр, чтобы он отобразился
      state.docFilter = ''; docFilter.value = '';
      state.docValues = (d.docValues && typeof d.docValues === 'object') ? Object.assign({}, d.docValues) : {};
      fillTypes();
      setVals(Object.assign(Object.fromEntries(FIELDS.map(f => [f.key, ''])), d.vals || {}));
      // сбрасываем поле/бейдж пробива — иначе старая отметка «данные DaData ✓»
      // повисает над уже другими реквизитами загруженного черновика
      const li = root.querySelector('#lookup-inn'); if (li) li.value = '';
      const ln = root.querySelector('#lookup-note'); if (ln) ln.style.display = 'none';
      runValidation(); updateCompleteness(); renderDocFields();
      root.scrollTo ? root.scrollTo({ top:0 }) : null;
      ctx.toast('Черновик «' + (d.title || '') + '» загружен', 'ok');
    }

    function renderDrafts(){
      const list = loadDrafts();
      if (!list.length){
        draftsWrap.innerHTML = U.empty('🗂️', 'Черновиков пока нет. Заполните реквизиты и нажмите «Сохранить текущий как черновик».');
        return;
      }
      const rows = list.map(d => ({
        title: d.title || '—',
        meta: `${d.form || ''}${d.docName ? ' · ' + d.docName : ''}`,
        inn: (d.vals && d.vals.inn) || '—',
        when: new Date(d.savedAt || Date.now()).toLocaleDateString('ru-RU'),
        _d: d
      }));
      draftsWrap.innerHTML = U.table(rows, [
        { key:'title', label:'Черновик', render:(val, r) => `<strong>${E(val)}</strong><div class="foot">${E(r.meta)}</div>` },
        { key:'inn',   label:'ИНН', mono:true },
        { key:'when',  label:'Сохранён', align:'right' },
        { key:'_act',  label:'', align:'right', render:(_x, r) =>
            `<button class="btn ghost sm" data-load="${E(r._d.id)}">Загрузить</button>` +
            `<button class="btn ghost sm" data-del="${E(r._d.id)}" aria-label="Удалить черновик">✕</button>` }
      ], { empty:'Черновиков нет.' });
      draftsWrap.querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
        const d = loadDrafts().find(x => x.id === b.dataset.load); if (d) applyDraft(d);
      });
      draftsWrap.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        const yes = await U.confirm({ title:'Удалить черновик', message:'Удалить этот черновик безвозвратно?', ok:'Удалить', danger:true });
        if (!yes) return;
        saveDrafts(loadDrafts().filter(x => x.id !== b.dataset.del));
        renderDrafts(); ctx.toast('Черновик удалён', 'info');
      });
    }

    /* ====================================================================
       15. КАТАЛОГ ТИПОВ ДОКУМЕНТОВ (справочник)
       ==================================================================== */
    function renderCatalog(){
      const wrap = root.querySelector('#catalog-wrap');
      const rows = docTypes.map(d => ({
        name: d.name,
        forms: d.forms,
        _id: d.id,
        real: !!(d.builtin && (tplEntry('ООО', d.id) || tplEntry('ИП', d.id))),
        avail: d.forms.indexOf(state.form) >= 0
      }));
      wrap.innerHTML = U.table(rows, [
        { key:'name', label:'Тип документа', render:(val, r) =>
            `${E(val)} ${r.real ? '<span class="badge ok dot" title="есть встроенный .docx-бланк">реальный шаблон</span> ' : ''}${r.avail ? '' : '<span class="badge" title="недоступен для выбранной формы">не для ' + E(state.form) + '</span>'}` },
        { key:'forms', label:'Формы', width:'130px', render:(val) =>
            val.map(f => `<span class="badge${f===state.form?' info':''}">${E(f)}</span>`).join(' ') },
        { key:'_pick', label:'', align:'right', render:(_x, r) =>
            r.avail ? `<button class="btn ghost sm" data-pick="${E(r._id)}">Выбрать</button>` : '' }
      ], { empty:'Справочник пуст.', maxHeight:'300px' });
      wrap.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
        state.docFilter = ''; docFilter.value = '';
        state.docType = b.dataset.pick; fillTypes();
        sel.focus();
        ctx.toast('Тип документа выбран', 'ok');
      });
    }

    /* ====================================================================
       16. INIT
       ==================================================================== */
    fillTypes();
    renderFields();
    renderDocFields();   // после renderFields — чтобы плейсхолдеры подтянули реквизиты
    renderDrafts();
    renderCatalog();
    renderPassport();
    previewEmpty();
  }
});

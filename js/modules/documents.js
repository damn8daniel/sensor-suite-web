/* Модуль «Документы» — эталонный: генерация .docx из шаблона с {полями} прямо в браузере.
   Возможности: drag&drop шаблона, авто-определение полей (вкл. вложенные {#секции}
   и повторяющиеся), пресеты 6 пакетов УЦ из плейсхолдеров, валидация, склонение ФИО
   (морфология RU в браузере), предпросмотр, экспорт .docx + печать, история генераций.
   Контракт сохранён: id=documents, dept=Документооборот, поля читаются из
   ctx.data.placeholders.fields ({placeholder, category, source, package}). */
SensorApp.register({
  id: 'documents', title: 'Документы', dept: 'Документооборот', order: 10,
  icon: '📄', description: 'Генерация документов из шаблонов · 55 полей, 6 пакетов УЦ',
  keywords: ['docx','шаблон','пакет','уц','склонение','фио','плейсхолдер','генерация'],

  // быстрые действия для командной палитры (⌘K)
  actions: [
    { id:'upload', title:'Загрузить шаблон .docx', hint:'Документы · открыть файл',
      keywords:['docx','шаблон','файл'], run(){ const i=document.getElementById('doc-tpl'); if(i) i.click(); } },
    { id:'history', title:'История генераций', hint:'Документы · журнал',
      keywords:['журнал','лог'], run(){ const t=document.querySelector('[data-doc-tab="history"]'); if(t) t.click(); } }
  ],

  mount(root, ctx){
    const U = ctx.ui;
    const seed = (ctx.data.placeholders && ctx.data.placeholders.fields) || [];
    const HKEY = 'documents_history';
    const DKEY = 'documents_draft';

    /* ======================================================================
       1. МОРФОЛОГИЯ — склонение ФИО (родительный/дательный/творительный)
       Лёгкий rule-based движок для русских ФИО. Не претендует на 100 %,
       но корректно обрабатывает подавляющее большинство фамилий/имён/отчеств.
       Падежи: gen (кого/чего), dat (кому/чему), ins (кем/чем).
       ====================================================================== */
    const Morph = (function(){
      const VOW = 'аеёиоуыэюя';
      const isVowel = c => VOW.indexOf(c) >= 0;
      const last = (s,n) => s.slice(s.length - (n||1));
      const endsWith = (s, arr) => arr.some(e => s.slice(-e.length) === e);

      // Определение пола по отчеству, затем по имени, затем по фамилии
      function detectGender(parts){
        const [f, n, p] = parts;
        if (p){
          if (/(вич|ич|оглы|улы)$/i.test(p)) return 'm';
          if (/(вна|чна|кызы|гызы)$/i.test(p)) return 'f';
        }
        if (n){
          const nl = n.toLowerCase();
          if (/(а|я)$/.test(nl) && !/(никита|илья|кузьма|фома|лука|данила|савва|кирилл)$/.test(nl)) return 'f';
          return 'm';
        }
        if (f){
          const fl = f.toLowerCase();
          if (/(ова|ева|ёва|ина|ына|ская|цкая|ая|яя)$/.test(fl)) return 'f';
        }
        return 'm';
      }

      // Имя
      function nameDecline(name, kase, gender){
        const l = name.toLowerCase();
        const cap = s => name[0] + s.slice(1);
        if (gender === 'f'){
          if (endsWith(l, ['ия'])) return cap(l.slice(0,-1) + ({gen:'и',dat:'и',ins:'ей'}[kase]));
          if (last(l) === 'я') return cap(l.slice(0,-1) + ({gen:'и',dat:'е',ins:'ей'}[kase]));
          if (last(l) === 'а'){
            const pre = l[l.length-2];
            const g = ('гкхжчшщ'.indexOf(pre) >= 0) ? 'и' : 'ы';
            return cap(l.slice(0,-1) + ({gen:g,dat:'е',ins:'ой'}[kase]));
          }
          if (last(l) === 'ь') return cap(l.slice(0,-1) + ({gen:'и',dat:'и',ins:'ью'}[kase]));
          return name; // Любовь и пр. неизменяемые — оставляем
        }
        // мужской
        if (endsWith(l, ['ий'])) return cap(l.slice(0,-2) + ({gen:'ия',dat:'ию',ins:'ием'}[kase]));
        if (endsWith(l, ['ей'])) return cap(l.slice(0,-2) + ({gen:'ея',dat:'ею',ins:'еем'}[kase]));
        if (last(l) === 'й') return cap(l.slice(0,-1) + ({gen:'я',dat:'ю',ins:'ем'}[kase]));
        if (last(l) === 'ь') return cap(l.slice(0,-1) + ({gen:'я',dat:'ю',ins:'ём'}[kase]));
        if (last(l) === 'а') return cap(l.slice(0,-1) + ({gen:'ы',dat:'е',ins:'ой'}[kase])); // Никита, Кузьма
        if (last(l) === 'я') return cap(l.slice(0,-1) + ({gen:'и',dat:'е',ins:'ей'}[kase]));
        if (!isVowel(last(l))){ // согласная: Иван → Ивана
          return cap(l + ({gen:'а',dat:'у',ins:'ом'}[kase]));
        }
        return name;
      }

      // Отчество
      function patrDecline(patr, kase, gender){
        const l = patr.toLowerCase();
        const cap = s => patr[0] + s.slice(1);
        if (gender === 'm'){
          if (endsWith(l, ['ич'])) return cap(l + ({gen:'а',dat:'у',ins:'ем'}[kase]));
          if (endsWith(l, ['оглы','улы'])) return patr; // тюркские — не склоняем
        } else {
          if (endsWith(l, ['вна','чна'])) return cap(l.slice(0,-1) + ({gen:'ы',dat:'е',ins:'ой'}[kase]));
          if (endsWith(l, ['кызы','гызы'])) return patr;
        }
        return patr;
      }

      // Фамилия
      function surnameDecline(sur, kase, gender){
        const l = sur.toLowerCase();
        const cap = s => sur[0] + s.slice(1);
        // несклоняемые: на -о, -е, -и, -у, -ю, -ых/-их, иностранные на гласную
        if (/(ко|енко|ово|аго|яго|их|ых)$/.test(l)) return sur;
        if (isVowel(last(l)) && !/(ая|яя|а|я)$/.test(l)) return sur;

        if (gender === 'f'){
          if (endsWith(l, ['ова','ева','ёва','ина','ына'])) return cap(l.slice(0,-1) + ({gen:'ой',dat:'ой',ins:'ой'}[kase]));
          if (endsWith(l, ['ская','цкая'])) return cap(l.slice(0,-2) + ({gen:'ой',dat:'ой',ins:'ой'}[kase]));
          if (endsWith(l, ['ая','яя'])) return cap(l.slice(0,-2) + ({gen:'ой',dat:'ой',ins:'ой'}[kase]));
          if (last(l) === 'а') return cap(l.slice(0,-1) + ({gen:'ы',dat:'е',ins:'ой'}[kase]));
          if (last(l) === 'я') return cap(l.slice(0,-1) + ({gen:'и',dat:'е',ins:'ей'}[kase]));
          return sur; // на согласную (Гринберг) у женщин не склоняется
        }
        // мужской
        if (endsWith(l, ['ов','ев','ёв','ин','ын'])) return cap(l + ({gen:'а',dat:'у',ins:'ым'}[kase]));
        if (endsWith(l, ['ский','цкий','ный','ый','ой','ий'])) return cap(l.slice(0,-2) + ({gen:'ого',dat:'ому',ins:'им'}[kase]));
        if (last(l) === 'ь') return cap(l.slice(0,-1) + ({gen:'я',dat:'ю',ins:'ем'}[kase]));
        if (last(l) === 'й') return cap(l.slice(0,-1) + ({gen:'я',dat:'ю',ins:'ем'}[kase]));
        if (last(l) === 'а') return cap(l.slice(0,-1) + ({gen:'ы',dat:'е',ins:'ой'}[kase]));
        if (last(l) === 'я') return cap(l.slice(0,-1) + ({gen:'и',dat:'е',ей:'ей'}[kase]||({gen:'и',dat:'е',ins:'ей'}[kase])));
        if (!isVowel(last(l))) return cap(l + ({gen:'а',dat:'у',ins:'ом'}[kase])); // Гринберг → Гринберга
        return sur;
      }

      // ФИО целиком. kase: 'gen'|'dat'|'ins'. Возвращает строку.
      function declineFio(fio, kase){
        if (!fio) return fio;
        const parts = String(fio).trim().split(/\s+/);
        if (!parts.length) return fio;
        const g = detectGender(parts);
        const out = parts.slice();
        out[0] = surnameDecline(parts[0], kase, g);
        if (parts[1]) out[1] = nameDecline(parts[1], kase, g);
        if (parts[2]) out[2] = patrDecline(parts[2], kase, g);
        return out.join(' ');
      }

      // Инициалы: «Иванов Иван Иванович» → «Иванов И. И.»
      function initials(fio){
        const p = String(fio||'').trim().split(/\s+/);
        if (p.length < 2) return fio;
        const ini = p.slice(1).filter(Boolean).map(x => x[0].toUpperCase() + '.').join(' ');
        return (p[0] + ' ' + ini).trim();
      }

      return { declineFio, detectGender, initials };
    })();

    /* ======================================================================
       2. СЛОВАРЬ ПОЛЕЙ — человекочитаемые подписи, типы, маски, валидация
       ====================================================================== */
    const seedByTok = {};
    seed.forEach(f => { const t = f.placeholder.replace(/[{}]/g,'').trim(); seedByTok[t] = f; });

    // тип поля по имени токена (для подходящего инпута и валидации)
    function fieldType(tok){
      const u = tok.toUpperCase();
      if (/(_DATE|_DATE_|DATE$|DATE_)/.test(u) || /ДАТА/.test(u)) return 'date';
      if (/(INN)/.test(u)) return 'inn';
      if (/(OGRN)/.test(u)) return 'ogrn';
      if (/(NUMBER|_NUM|КОД|CODE)/.test(u)) return 'text';
      if (/(ADDRESS|АДРЕС)/.test(u)) return 'multiline';
      if (/(FULL_NAME|ФИО|NAME)/.test(u)) return 'name';
      if (/(STANDARDS|OKVED|EDUCATION|COURSE_NAME)/.test(u)) return 'multiline';
      return 'text';
    }

    // падеж по суффиксу токена: _GENITIVE → gen, _GENITIVE2 (дательный в сидe) → dat, _DATIVE → dat, _INST → ins
    function caseFor(tok){
      const u = tok.toUpperCase();
      if (/GENITIVE2$/.test(u)) return 'dat';   // в сидe GENITIVE2 используется как дательный
      if (/(GENITIVE|_GEN)$/.test(u)) return 'gen';
      if (/(DATIVE|_DAT)$/.test(u)) return 'dat';
      if (/(INST|_INS|TVOR)$/.test(u)) return 'ins';
      return null;
    }
    // базовый ФИО-токен, от которого можно автосклонять.
    //  EXPERT_FULL_NAME_GENITIVE → EXPERT_FULL_NAME
    //  PROF_STUDENT_NAME_GENITIVE / _GENITIVE2 → PROF_STUDENT_FULL_NAME (в сидe базовый = …_FULL_NAME)
    function baseNameTok(tok){
      // 1) уже есть _FULL_NAME — просто снимаем суффикс падежа
      if (/_FULL_NAME_(GENITIVE2|GENITIVE|DATIVE|INST)$/i.test(tok))
        return tok.replace(/_(GENITIVE2|GENITIVE|DATIVE|INST)$/i,'');
      // 2) форма …_NAME_GENITIVE → базовый …_FULL_NAME
      if (/_NAME_(GENITIVE2|GENITIVE|DATIVE|INST)$/i.test(tok))
        return tok.replace(/_NAME_(GENITIVE2|GENITIVE|DATIVE|INST)$/i,'_FULL_NAME');
      // 3) прочее — просто снимаем суффикс падежа
      return tok.replace(/_(GENITIVE2|GENITIVE|DATIVE|INST)$/i,'');
    }

    function prettyLabel(tok){
      const map = {
        EXPERT_ORG_FULL_NAME:'Эксперт-организация — полное наименование',
        EXPERT_ORG_SHORT_NAME:'Эксперт-организация — краткое наименование',
        EXPERT_ORG_INN:'ИНН организации', EXPERT_ORG_OGRN:'ОГРН организации',
        EXPERT_ORG_ADDRESS:'Юридический адрес организации',
        EXPERT_FULL_NAME:'ФИО эксперта', EXPERT_FULL_NAME_GENITIVE:'ФИО эксперта (род. падеж)',
        CERTIFICATE_NUMBER:'Номер сертификата', CERTIFICATE_DATE:'Дата сертификата',
        ATTESTAT_NUMBER:'Номер аттестата', ATTESTAT_DATE:'Дата аттестата'
      };
      if (map[tok]) return map[tok];
      const k = caseFor(tok);
      const human = tok
        .replace(/^(EXPERT|ISO|PROF|PROFPP|UPK|MPB)_/,'')
        .replace(/_/g,' ').toLowerCase()
        .replace(/\bfull name\b/,'ФИО').replace(/\bname\b/,'имя')
        .replace(/\binn\b/,'ИНН').replace(/\bogrn\b/,'ОГРН')
        .replace(/\bokved\b/,'ОКВЭД').replace(/\biso\b/,'ИСО')
        .replace(/\bdate\b/,'дата').replace(/\bnumber\b/,'номер')
        .replace(/\bstudent\b/,'обучающийся').replace(/\bexpert\b/,'эксперт')
        .replace(/\borg\b/,'организация').replace(/\bcourse\b/,'курс')
        .replace(/\bstart\b/,'начало').replace(/\bend\b/,'окончание')
        .replace(/\bworkplace\b/,'место работы').replace(/\bposition\b/,'должность')
        .replace(/\beducation\b/,'образование').replace(/\bdiploma\b/,'диплом')
        .replace(/\bprotocol\b/,'протокол').replace(/\bcertificate\b/,'удостоверение')
        .replace(/\bcert\b/,'сертификат').replace(/\bstandards\b/,'стандарты')
        .replace(/\breg\b/,'рег.').replace(/\bcode\b/,'код')
        .replace(/\bgenitive2\b/,'').replace(/\bgenitive\b/,'').replace(/\bdative\b/,'')
        .trim();
      let lbl = human.charAt(0).toUpperCase() + human.slice(1);
      if (k === 'gen') lbl += ' (род. падеж)';
      if (k === 'dat') lbl += ' (дат. падеж)';
      if (k === 'ins') lbl += ' (твор. падеж)';
      return lbl;
    }

    // группа полей по семантике токена (для секций формы)
    function groupOf(tok){
      const s = seedByTok[tok];
      if (s && s.category) return s.category;
      const u = tok.toUpperCase();
      if (/(ORG|INN|OGRN|ADDRESS|OKVED)/.test(u)) return 'Данные организации';
      if (/(EXPERT|STUDENT|NAME)/.test(u)) return 'Данные физлица';
      return 'Реквизиты';
    }
    function sourceOf(tok){ const s = seedByTok[tok]; return s && s.source ? s.source : ''; }

    /* ======================================================================
       3. ВАЛИДАЦИЯ
       ====================================================================== */
    function validateValue(type, v){
      const val = String(v == null ? '' : v).trim();
      if (!val) return null; // пустое = «не заполнено», обрабатывается отдельно
      if (type === 'inn'){
        if (!/^\d{10}(\d{2})?$/.test(val)) return 'ИНН: 10 цифр (юрлицо) или 12 (ИП)';
        return innChecksum(val) ? null : 'ИНН: неверная контрольная сумма';
      }
      if (type === 'ogrn'){
        if (!/^\d{13}(\d{2})?$/.test(val)) return 'ОГРН: 13 цифр (или ОГРНИП — 15)';
        return null;
      }
      if (type === 'date'){
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(val)) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
        return 'Дата: ДД.ММ.ГГГГ';
      }
      if (type === 'name'){
        if (val.split(/\s+/).length < 2) return 'Укажите минимум фамилию и имя';
        return null;
      }
      return null;
    }
    function innChecksum(inn){
      const d = inn.split('').map(Number);
      const c = (w) => w.reduce((s,k,i)=>s + k*d[i], 0) % 11 % 10;
      if (inn.length === 10) return c([2,4,10,3,5,9,4,6,8]) === d[9];
      if (inn.length === 12){
        const n11 = c([7,2,4,10,3,5,9,4,6,8]); const n12 = c([3,7,2,4,10,3,5,9,4,6,8]);
        return n11 === d[10] && n12 === d[11];
      }
      return false;
    }
    // нормализация даты ISO → ДД.ММ.ГГГГ для вывода
    function normDate(v){
      const val = String(v||'').trim();
      const m = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return `${m[3]}.${m[2]}.${m[1]}`;
      return val;
    }

    /* ======================================================================
       4. ПРЕСЕТЫ — 6 пакетов УЦ из плейсхолдеров (группировка по package)
       ====================================================================== */
    const packages = (function(){
      const order = [], byName = {};
      seed.forEach(f => {
        const p = f.package || 'Прочее';
        if (!byName[p]){ byName[p] = []; order.push(p); }
        byName[p].push(f.placeholder.replace(/[{}]/g,'').trim());
      });
      return order.map(name => ({
        name,
        short: name.replace(/ПАКЕТ\s*\d+\s*:?\s*/i,'').trim(),
        num: (name.match(/ПАКЕТ\s*(\d+)/i) || [])[1] || '',
        tokens: byName[name]
      }));
    })();

    /* ======================================================================
       5. ОБНАРУЖЕНИЕ ПОЛЕЙ В .docx (плоские + вложенные {#секции} + повторы)
       ====================================================================== */
    // склейка раздробленного docxtemplater-текста: <w:t> куски рядом
    function flatXml(p){
      let xml = p.asText();
      // убираем теги, но сохраняем порядок текста; docxtemplater может дробить {ПОЛЕ}
      return xml.replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'');
    }
    function detect(zip){
      const flat = [];        // плоские {ПОЛЕ}
      const loops = [];       // {#секция}…{/секция} с вложенными полями
      const counts = {};      // частота вхождений (повторы)
      const seenFlat = new Set();
      const seenLoop = new Set();

      const parts = zip.file(/word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml/);
      let text = '';
      parts.forEach(p => { text += '\n' + flatXml(p); });

      // 1) секции-петли: {#name} ... {/name}
      const loopRe = /\{#([^{}#\/\s]+)\}([\s\S]*?)\{\/\1\}/g;
      let lm;
      while ((lm = loopRe.exec(text)) !== null){
        const name = lm[1].trim();
        const inner = lm[2];
        const innerTokens = [];
        (inner.match(/\{([^{}#\/^][^{}]*)\}/g) || []).forEach(t => {
          const tk = t.slice(1,-1).trim();
          if (tk && !/^[#/^]/.test(tk)){ innerTokens.push(tk); counts[tk] = (counts[tk]||0)+1; }
        });
        if (!seenLoop.has(name)){ seenLoop.add(name); loops.push({ name, tokens: [...new Set(innerTokens)] }); }
      }
      // 2) маскируем уже разобранные петли, чтобы их внутренние поля не дублировались как плоские
      const masked = text.replace(loopRe, ' ');
      // 3) плоские поля (исключая управляющие {#}, {/}, {^})
      (masked.match(/\{([^{}]+)\}/g) || []).forEach(t => {
        const tk = t.slice(1,-1).trim();
        if (!tk || /^[#/^]/.test(tk)) return;
        counts[tk] = (counts[tk]||0)+1;
        if (!seenFlat.has(tk)){ seenFlat.add(tk); flat.push(tk); }
      });
      return { flat, loops, counts };
    }

    /* ======================================================================
       6. СОСТОЯНИЕ МОДУЛЯ
       ====================================================================== */
    let tpl = null, tplName = '', detected = null, activePreset = null;

    /* ======================================================================
       7. РАЗМЕТКА (вкладки: Генератор · Справочник · История)
       ====================================================================== */
    root.innerHTML = `<div id="doc-tabs"></div>`;

    const tabs = U.tabs([
      { id:'gen', label:'Генератор', icon:'📝', render: panel => { panel.innerHTML = ''; panel.appendChild(buildGen()); } },
      { id:'ref', label:'Справочник полей', icon:'📚', count: seed.length, render: panel => { panel.innerHTML = buildRef(); bindRef(panel); } },
      { id:'history', label:'История', icon:'🕘', count: load().length, render: panel => { panel.innerHTML = ''; panel.appendChild(buildHistory()); } }
    ], { variant:'underline', store:'documents' });
    // прокидываем data-атрибуты на кнопки табов (для actions)
    [...tabs.bar.children].forEach(b => b.setAttribute('data-doc-tab', b.dataset.id));
    root.querySelector('#doc-tabs').appendChild(tabs.el);

    /* ----------------------------------------------------------------------
       7a. ВКЛАДКА «ГЕНЕРАТОР»
       ---------------------------------------------------------------------- */
    function buildGen(){
      const wrap = document.createElement('div');

      // --- дропзона + пресеты ---
      const top = document.createElement('div');
      top.className = 'card';
      top.innerHTML =
        `<h3>Шаблон документа ${badgeEnv()}</h3>
         <p class="hint">Перетащите .docx-шаблон в зону ниже или выберите файл. Поддерживаются поля <code class="mono">{ПОЛЕ}</code>, повторяющиеся поля и вложенные секции <code class="mono">{#список}…{/список}</code>. Приложение само найдёт поля и построит форму.</p>
         <label class="dropzone" id="doc-dz" tabindex="0" role="button" aria-label="Загрузить .docx-шаблон">
           <input id="doc-tpl" type="file" accept=".docx" hidden>
           <span class="dz-ic" aria-hidden="true">⬆</span>
           <span class="dz-main">Перетащите <b>.docx</b> сюда</span>
           <span class="dz-sub">или нажмите, чтобы выбрать файл</span>
         </label>
         <div class="doc-tplbar" id="doc-tplbar" hidden></div>
         <div class="divider"></div>
         <div class="field" style="margin-bottom:8px">
           <label>Быстрый пресет — пакет УЦ <span class="tok">подставит поля без шаблона</span></label>
           <div class="pill-tabs" id="doc-presets" style="margin-bottom:0"></div>
         </div>`;
      wrap.appendChild(top);

      // пресеты-пилюли
      const presetBar = top.querySelector('#doc-presets');
      packages.forEach(pk => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pill'; b.dataset.pk = pk.name;
        b.innerHTML = `<span class="t-ic" aria-hidden="true">📦</span>${U.escape(pk.short)} <span class="t-count">${pk.tokens.length}</span>`;
        b.title = pk.name + ' · ' + pk.tokens.length + ' полей';
        b.onclick = () => applyPreset(pk, presetBar);
        presetBar.appendChild(b);
      });

      // форма
      const formWrap = document.createElement('div');
      formWrap.id = 'doc-form';
      wrap.appendChild(formWrap);

      // первичный рендер пустого состояния / восстановление черновика
      const draft = ctx.store.get(DKEY, null);
      if (draft && Array.isArray(draft.flat) && draft.flat.length){
        detected = { flat: draft.flat, loops: draft.loops || [], counts: draft.counts || {} };
        renderForm(formWrap, draft.values || {}, draft.label || 'Черновик');
      } else {
        renderEmpty(formWrap);
      }

      // привязка дропзоны (узлы формы/плашки резолвим «вживую» через root —
      // tabs-хелпер может перерисовать панель, поэтому не держимся за замыкание)
      bindDropzone(top.querySelector('#doc-dz'), top.querySelector('#doc-tpl'));
      return wrap;
    }

    // живые ссылки на узлы текущей вкладки «Генератор»
    function liveForm(){ return root.querySelector('#doc-form'); }
    function liveTplbar(){ return root.querySelector('#doc-tplbar'); }

    function badgeEnv(){ return ''; }

    function renderEmpty(formWrap){
      if (!formWrap) return;
      // обзорная статистика по сид-данным — даёт ощущение наполненности вместо «пустоты»
      const totalTok = seed.length;
      const groups = {};
      seed.forEach(f => { const c = f.category || 'Прочее'; groups[c] = (groups[c]||0) + 1; });
      const groupChips = Object.keys(groups).slice(0,4)
        .map(g => `<span class="badge">${U.escape(g)} <span class="t-count">${groups[g]}</span></span>`).join('');

      // карта пакетов как точки входа — клик строит форму (мост к пресетам)
      const packCards = packages.map(p =>
        `<button type="button" class="doc-pack" data-empty-pack="${U.escape(p.name)}"
                 style="cursor:pointer;text-align:left;font:inherit;width:100%"
                 title="Открыть пакет «${U.escape(p.short)}» в форме">
           <div class="doc-pack-h"><span class="doc-pack-n">${U.escape(p.num||'•')}</span><b>${U.escape(p.short)}</b></div>
           <div class="doc-pack-meta">${p.tokens.length} ${plural(p.tokens.length,'поле','поля','полей')} · нажмите, чтобы заполнить</div>
         </button>`).join('');

      formWrap.innerHTML =
        `<div class="card">
           <h3>Поля документа <span class="badge info">${totalTok} ${plural(totalTok,'поле','поля','полей')} в базе</span></h3>
           <p class="hint">Поля появятся здесь после загрузки <code class="mono">.docx</code>-шаблона или выбора пакета. Система уже знает справочник полей для всех пакетов УЦ — выберите готовый набор ниже, чтобы начать без файла.</p>
           <div class="doc-empty-stats" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${groupChips}</div>
           <div class="grid cols-2" id="doc-empty-packs">${packCards}</div>
           <p class="foot" style="margin:14px 0 0">Совет: для экспорта в <code class="mono">.docx</code> нужен файл-шаблон. Без файла доступны заполнение, предпросмотр и печать карты значений.</p>
         </div>`;

      formWrap.querySelectorAll('[data-empty-pack]').forEach(b => {
        b.onclick = () => {
          const pk = packages.find(p => p.name === b.dataset.emptyPack);
          if (pk) applyPreset(pk, root.querySelector('#doc-presets'));
        };
      });
    }

    // --- drag & drop ---
    function bindDropzone(dz, input){
      input.addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFile(f); });
      ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag'); }));
      ['dragleave','dragend','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); if (ev!=='drop') dz.classList.remove('drag'); }));
      dz.addEventListener('drop', e => {
        dz.classList.remove('drag');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        if (!/\.docx$/i.test(f.name)){ ctx.toast('Нужен файл .docx','err'); return; }
        loadFile(f);
      });
      dz.addEventListener('keydown', e => { if (e.key==='Enter' || e.key===' '){ e.preventDefault(); input.click(); } });
    }

    function loadFile(file){
      tplName = file.name;
      const formWrap0 = liveForm();
      if (formWrap0) formWrap0.innerHTML = U.card('Поля документа','', U.skeleton({ lines:5, widths:['40%','100%','100%','100%','55%'] }));
      const rd = new FileReader();
      rd.onload = () => {
        const formWrap = liveForm(), tplbar = liveTplbar();
        try{
          tpl = rd.result;
          const zip = new PizZip(tpl);
          detected = detect(zip);
          activePreset = null;
          const totalFields = detected.flat.length + detected.loops.reduce((s,l)=>s+l.tokens.length,0);
          if (tplbar){
            const repeated = Object.keys(detected.counts || {}).filter(k => detected.counts[k] > 1).length;
            tplbar.hidden = false;
            tplbar.innerHTML =
              `<span class="badge ok dot">${U.escape(file.name)}</span>
               <span class="badge">${totalFields} ${plural(totalFields,'поле','поля','полей')}</span>
               ${detected.loops.length?`<span class="badge info">${detected.loops.length} ${plural(detected.loops.length,'секция','секции','секций')}</span>`:''}
               ${repeated?`<span class="badge" title="Поля встречаются в шаблоне несколько раз">${repeated} ${plural(repeated,'повтор','повтора','повторов')}</span>`:''}
               <button class="btn ghost sm" id="doc-clear-tpl" type="button" title="Сбросить шаблон">✕ сбросить</button>`;
            tplbar.querySelector('#doc-clear-tpl').onclick = () => resetTpl();
          }
          if (!totalFields){
            if (formWrap) formWrap.innerHTML = U.card('Поля документа','',
              U.empty('🔍','В шаблоне не найдено полей вида {ПОЛЕ}. Проверьте, что в .docx используются фигурные скобки.'));
            return;
          }
          renderForm(formWrap, {}, file.name);
          ctx.toast('Шаблон разобран: '+totalFields+' '+plural(totalFields,'поле','поля','полей'),'ok');
        }catch(err){
          if (formWrap) renderEmpty(formWrap);
          ctx.toast('Не удалось прочитать шаблон: '+(err.message||err),'err');
        }
      };
      rd.onerror = () => ctx.toast('Ошибка чтения файла','err');
      rd.readAsArrayBuffer(file);
    }

    function resetTpl(){
      tpl = null; tplName = ''; detected = null; activePreset = null;
      const tplbar = liveTplbar(); if (tplbar){ tplbar.hidden = true; tplbar.innerHTML = ''; }
      const bar = root.querySelector('#doc-presets'); if (bar) [...bar.children].forEach(b=>b.classList.remove('active'));
      ctx.store.set(DKEY, null);
      const formWrap = liveForm(); if (formWrap) renderEmpty(formWrap);
    }

    // применить пресет (без файла) — строим форму из набора токенов пакета
    function applyPreset(pk, bar){
      bar = bar || root.querySelector('#doc-presets');
      if (bar) [...bar.children].forEach(b => b.classList.toggle('active', b.dataset.pk === pk.name));
      activePreset = pk.name;
      detected = { flat: pk.tokens.slice(), loops: [], counts: {} };
      // если шаблон не загружен — генерация .docx недоступна, но форма/предпросмотр работают
      renderForm(liveForm(), {}, pk.name);
      ctx.toast(pk.short + ' · ' + pk.tokens.length + ' полей','info');
    }

    /* --- построение формы из detected (flat + loops) --- */
    function renderForm(formWrap, values, label){
      formWrap = formWrap || liveForm();
      values = values || {};
      if (!formWrap) return;
      if (!detected){ renderEmpty(formWrap); return; }
      const flat = detected.flat || [];
      const loops = detected.loops || [];
      const counts = detected.counts || {};

      // группировка плоских полей по семантике
      const groups = {};
      const gorder = [];
      flat.forEach(tok => {
        const g = groupOf(tok);
        if (!groups[g]){ groups[g] = []; gorder.push(g); }
        groups[g].push(tok);
      });

      // сводка по составу формы: типы полей, авто-склоняемые, секции
      const autoCount = flat.filter(t => isAuto(t)).length;
      const dateCount = flat.filter(t => fieldType(t) === 'date').length;
      const reqCount = flat.filter(t => { const ty = fieldType(t); return ty==='inn'||ty==='ogrn'||ty==='name'; }).length;
      const summaryChips = [
        `<span class="badge">${flat.length} ${plural(flat.length,'поле','поля','полей')}</span>`,
        loops.length ? `<span class="badge info">${loops.length} ${plural(loops.length,'секция','секции','секций')}</span>` : '',
        autoCount ? `<span class="badge ok dot">${autoCount} авто-склонение</span>` : '',
        dateCount ? `<span class="badge">${dateCount} ${plural(dateCount,'дата','даты','дат')}</span>` : '',
        reqCount ? `<span class="badge warn">${reqCount} с проверкой</span>` : ''
      ].filter(Boolean).join('');

      // строка поиска по полям — появляется при большом числе полей (удобно для пакетов на 50+)
      const showSearch = flat.length > 8;

      let html = '';
      // строка-заголовок формы
      const noTpl = !tpl;
      html += `<div class="card doc-form-head">
        <h3>Заполните поля
          ${activePreset?`<span class="badge info">пресет: ${U.escape(packages.find(p=>p.name===activePreset)?.short||'')}</span>`:''}
          ${noTpl?`<span class="badge warn" title="Для .docx загрузите файл-шаблон">без файла-шаблона</span>`:''}
        </h3>
        <p class="hint">${U.escape(label||'')} · ${flat.length+loops.reduce((s,l)=>s+l.tokens.length,0)} ${plural(flat.length,'поле','поля','полей')}. Поля с пометкой <span class="tok">авто</span> склоняются из ФИО автоматически.</p>
        <div class="doc-summary" style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px">${summaryChips}</div>
        ${showSearch?`<div class="field" style="margin:0 0 12px;position:relative">
          <input id="doc-search" type="search" placeholder="Поиск по полям — название или {ТОКЕН}…" autocomplete="off" aria-label="Поиск по полям" style="padding-left:32px">
          <span aria-hidden="true" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:13px;pointer-events:none">⌕</span>
        </div>`:''}
        <div class="doc-progress"><div class="bar"><span id="doc-bar" style="width:0%"></span></div><span class="doc-progress-lbl" id="doc-bar-lbl">0 из 0</span></div>
      </div>`;

      // секции групп
      gorder.forEach(g => {
        html += `<div class="card" data-doc-group="${U.escape(g)}"><h3>${U.escape(g)} <span class="badge" data-group-count>${groups[g].length}</span></h3>`;
        groups[g].forEach(tok => { html += fieldRow(tok, values[tok], counts[tok]); });
        html += `</div>`;
      });

      // петли-секции
      loops.forEach(loop => {
        html += `<div class="card doc-loop" data-loop="${U.escape(loop.name)}">
          <h3>Список: ${U.escape(loop.name)} <span class="badge info">повторяющийся блок</span></h3>
          <p class="hint">Повторяющаяся секция шаблона. Добавьте нужное число строк.</p>
          <div class="doc-loop-rows" data-loop-rows="${U.escape(loop.name)}"></div>
          <div class="btn-row" style="margin-top:8px">
            <button class="btn sm" type="button" data-loop-add="${U.escape(loop.name)}">＋ Добавить строку</button>
          </div>
        </div>`;
      });

      // панель действий
      html += `<div class="card doc-actions">
        <div class="btn-row">
          <button class="btn primary" id="doc-gen" ${noTpl?'disabled title="Загрузите .docx-шаблон, чтобы экспортировать"':''}>⤓ Сгенерировать .docx</button>
          <button class="btn" id="doc-preview">👁 Предпросмотр</button>
          <button class="btn" id="doc-print">🖨 Печать</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn ghost sm" id="doc-fill-demo" title="Заполнить демо-значениями">✨ Демо</button>
          <button class="btn ghost sm" id="doc-clear">Очистить</button>
        </div>
        <p class="foot" style="margin:10px 0 0">Данные не покидают браузер. Черновик автосохраняется локально.</p>
      </div>`;

      formWrap.innerHTML = html;

      // инициализация петель (по 1 строке)
      loops.forEach(loop => {
        const host = formWrap.querySelector(`[data-loop-rows="${cssEsc(loop.name)}"]`);
        addLoopRow(host, loop, (values[loop.name] && values[loop.name][0]) || {});
        formWrap.querySelector(`[data-loop-add="${cssEsc(loop.name)}"]`).onclick = () => addLoopRow(host, loop, {});
      });

      bindFormEvents(formWrap, loops);
      // автозаполнение склоняемых при изменении ФИО
      wireDeclension(formWrap, flat);
      wireFieldSearch(formWrap);
      updateProgress(formWrap);
    }

    /* --- живой поиск/фильтр по полям формы (название, токен, источник) --- */
    function wireFieldSearch(formWrap){
      const search = formWrap.querySelector('#doc-search');
      if (!search) return;
      const fields = [...formWrap.querySelectorAll('.doc-field')];
      // кэшируем искомый текст каждого поля (подпись + токен + источник)
      fields.forEach(f => { f.dataset.search = (f.textContent || '').toLowerCase().replace(/\s+/g,' ').trim(); });
      const apply = () => {
        const q = search.value.trim().toLowerCase();
        let shown = 0;
        fields.forEach(f => {
          const hit = !q || f.dataset.search.indexOf(q) >= 0;
          f.hidden = !hit;
          if (hit) shown++;
        });
        // скрываем секции, в которых не осталось видимых полей
        formWrap.querySelectorAll('[data-doc-group]').forEach(card => {
          const any = [...card.querySelectorAll('.doc-field')].some(f => !f.hidden);
          card.hidden = q && !any;
        });
        // плашка «ничего не найдено»
        let none = formWrap.querySelector('#doc-search-none');
        if (q && shown === 0){
          if (!none){
            none = document.createElement('div');
            none.id = 'doc-search-none'; none.className = 'card';
            none.innerHTML = U.empty('🔍','По запросу ничего не найдено. Очистите поиск, чтобы увидеть все поля.');
            const head = formWrap.querySelector('.doc-form-head');
            if (head && head.nextSibling) formWrap.insertBefore(none, head.nextSibling); else formWrap.appendChild(none);
          }
          none.hidden = false;
        } else if (none){ none.hidden = true; }
      };
      search.addEventListener('input', U.debounce(apply, 120));
      search.addEventListener('search', apply);
    }

    // одна строка поля
    function fieldRow(tok, value, count){
      const type = fieldType(tok);
      const auto = isAuto(tok);
      const src = sourceOf(tok);
      const tokLabel = '{'+tok+'}' + (count>1?` ×${count}`:'');
      const label = prettyLabel(tok) +
        (auto?' <span class="tok" style="color:var(--ok-d)">авто</span>':'') +
        (src?` <span class="tok">· ${U.escape(src)}</span>`:'');
      const ph = U.escape(placeholderHint(tok, type));
      let input;
      if (type === 'multiline'){
        input = `<textarea data-tok="${U.escape(tok)}" rows="2" placeholder="${ph}">${U.escape(value||'')}</textarea>`;
      } else if (type === 'date'){
        input = `<input data-tok="${U.escape(tok)}" data-type="date" inputmode="numeric" placeholder="ДД.ММ.ГГГГ" value="${U.escape(value||'')}">`;
      } else if (type === 'inn' || type === 'ogrn'){
        input = `<input data-tok="${U.escape(tok)}" data-type="${type}" inputmode="numeric" placeholder="${ph}" value="${U.escape(value||'')}">`;
      } else if (type === 'name'){
        input = `<input data-tok="${U.escape(tok)}" data-type="name" placeholder="${ph}" value="${U.escape(value||'')}" autocomplete="off">`;
      } else {
        input = `<input data-tok="${U.escape(tok)}" placeholder="${ph}" value="${U.escape(value||'')}" autocomplete="off">`;
      }
      return `<div class="field doc-field" data-field="${U.escape(tok)}">
        <label>${label} <span class="tok">${U.escape(tokLabel)}</span></label>
        ${input}
        <div class="doc-err" data-err="${U.escape(tok)}" hidden></div>
      </div>`;
    }

    function placeholderHint(tok, type){
      if (type === 'inn') return '10 или 12 цифр';
      if (type === 'ogrn') return '13 цифр';
      if (type === 'date') return 'ДД.ММ.ГГГГ';
      if (type === 'name') return 'Фамилия Имя Отчество';
      if (/ADDRESS|АДРЕС/i.test(tok)) return 'Индекс, регион, город, улица, дом';
      if (/OKVED/i.test(tok)) return '00.00, 00.00 …';
      return tok;
    }

    function isAuto(tok){
      const k = caseFor(tok);
      if (!k) return false;
      const base = baseNameTok(tok);
      // авто, если есть базовый ФИО-токен среди текущих полей
      return detected && detected.flat && detected.flat.indexOf(base) >= 0 && base !== tok;
    }

    // петля: добавить строку с инпутами под токены секции
    function addLoopRow(host, loop, vals){
      vals = vals || {};
      const idx = host.children.length;
      const row = document.createElement('div');
      row.className = 'doc-loop-row';
      row.innerHTML =
        loop.tokens.map(tok =>
          `<div class="field" style="margin-bottom:8px">
             <label>${U.escape(prettyLabel(tok))} <span class="tok">{${U.escape(tok)}}</span></label>
             <input data-loop-tok="${U.escape(loop.name)}" data-tok="${U.escape(tok)}" placeholder="${U.escape(tok)}" value="${U.escape(vals[tok]||'')}">
           </div>`).join('') +
        `<button class="btn ghost sm doc-loop-del" type="button" title="Удалить строку" aria-label="Удалить строку">✕</button>`;
      row.querySelector('.doc-loop-del').onclick = () => { row.remove(); updateProgress(host.closest('#doc-form')); };
      host.appendChild(row);
    }

    /* --- автосклонение: при вводе базового ФИО заполняем _GENITIVE/_DATIVE поля --- */
    function wireDeclension(formWrap, flat){
      flat.forEach(tok => {
        const k = caseFor(tok);
        if (!k) return;
        const base = baseNameTok(tok);
        if (base === tok || flat.indexOf(base) < 0) return;
        const srcInput = formWrap.querySelector(`[data-tok="${cssEsc(base)}"]`);
        const dstInput = formWrap.querySelector(`[data-tok="${cssEsc(tok)}"]`);
        if (!srcInput || !dstInput) return;
        dstInput.dataset.auto = '1';
        const apply = () => {
          if (dstInput.dataset.touched === '1') return; // пользователь правил руками — не перетираем
          const v = srcInput.value.trim();
          dstInput.value = v ? Morph.declineFio(v, k) : '';
          dstInput.classList.toggle('doc-auto-filled', !!v);
          clearError(formWrap, tok);
        };
        srcInput.addEventListener('input', apply);
        dstInput.addEventListener('input', () => { dstInput.dataset.touched = '1'; dstInput.classList.remove('doc-auto-filled'); });
        if (srcInput.value.trim()) apply();
      });
    }

    function bindFormEvents(formWrap, loops){
      const onAny = U.debounce(() => { updateProgress(formWrap); saveDraft(formWrap, loops); }, 300);
      formWrap.querySelectorAll('[data-tok]').forEach(inp => {
        inp.addEventListener('input', () => { liveValidate(formWrap, inp); onAny(); });
        inp.addEventListener('blur', () => liveValidate(formWrap, inp, true));
      });
      const gen = formWrap.querySelector('#doc-gen'); if (gen) gen.onclick = () => doGenerate(formWrap, loops);
      formWrap.querySelector('#doc-preview').onclick = () => doPreview(formWrap, loops);
      formWrap.querySelector('#doc-print').onclick = () => doPrint(formWrap, loops);
      formWrap.querySelector('#doc-clear').onclick = async () => {
        const ok = await U.confirm({ title:'Очистить форму?', message:'Все введённые значения будут удалены.', ok:'Очистить', danger:true });
        if (!ok) return;
        formWrap.querySelectorAll('[data-tok]').forEach(i => { i.value=''; i.dataset.touched=''; i.classList.remove('doc-auto-filled'); clearError(formWrap, i.dataset.tok); });
        updateProgress(formWrap); saveDraft(formWrap, loops);
      };
      formWrap.querySelector('#doc-fill-demo').onclick = () => { fillDemo(formWrap); updateProgress(formWrap); saveDraft(formWrap, loops); };
    }

    function liveValidate(formWrap, inp, showOk){
      const tok = inp.dataset.tok;
      const type = inp.dataset.type || fieldType(tok);
      const err = validateValue(type, inp.value);
      if (err){ showError(formWrap, tok, err); inp.setAttribute('aria-invalid','true'); }
      else { clearError(formWrap, tok); inp.removeAttribute('aria-invalid'); }
      return !err;
    }
    function showError(formWrap, tok, msg){
      const box = formWrap.querySelector(`[data-err="${cssEsc(tok)}"]`);
      if (box){ box.hidden = false; box.textContent = msg; }
    }
    function clearError(formWrap, tok){
      const box = formWrap.querySelector(`[data-err="${cssEsc(tok)}"]`);
      if (box){ box.hidden = true; box.textContent=''; }
    }

    function updateProgress(formWrap){
      if (!formWrap) return;
      const inputs = [...formWrap.querySelectorAll('.doc-field [data-tok]')];
      const total = inputs.length;
      const filled = inputs.filter(i => String(i.value||'').trim()).length;
      const bar = formWrap.querySelector('#doc-bar');
      const lbl = formWrap.querySelector('#doc-bar-lbl');
      if (bar) bar.style.width = total ? Math.round(filled/total*100)+'%' : '0%';
      if (lbl) lbl.textContent = `${filled} из ${total}`;
    }

    // собрать данные формы (плоские + петли), с нормализацией дат
    function collect(formWrap, loops){
      const data = {};
      formWrap.querySelectorAll('.doc-field [data-tok]').forEach(inp => {
        const tok = inp.dataset.tok;
        const type = inp.dataset.type || fieldType(tok);
        data[tok] = type === 'date' ? normDate(inp.value) : inp.value;
      });
      (loops||[]).forEach(loop => {
        const rows = [...formWrap.querySelectorAll(`[data-loop-rows="${cssEsc(loop.name)}"] .doc-loop-row`)];
        data[loop.name] = rows.map(r => {
          const o = {};
          r.querySelectorAll('[data-loop-tok]').forEach(inp => { o[inp.dataset.tok] = inp.value; });
          return o;
        }).filter(o => Object.values(o).some(v => String(v||'').trim()));
      });
      return data;
    }

    // валидация всей формы перед генерацией
    function validateAll(formWrap){
      let firstBad = null, count = 0, empties = 0;
      formWrap.querySelectorAll('.doc-field [data-tok]').forEach(inp => {
        const tok = inp.dataset.tok;
        const type = inp.dataset.type || fieldType(tok);
        if (!String(inp.value||'').trim()){ empties++; return; }
        const err = validateValue(type, inp.value);
        if (err){ showError(formWrap, tok, err); inp.setAttribute('aria-invalid','true'); count++; if(!firstBad) firstBad = inp; }
      });
      return { ok: count===0, count, empties, firstBad };
    }

    /* --- генерация .docx --- */
    function doGenerate(formWrap, loops){
      if (!tpl){ ctx.toast('Загрузите .docx-шаблон для экспорта','err'); return; }
      const v = validateAll(formWrap);
      if (!v.ok){ if (v.firstBad) v.firstBad.focus(); ctx.toast(`Исправьте ${v.count} ${plural(v.count,'поле','поля','полей')} с ошибками`,'err'); return; }
      const proceed = () => {
        const data = collect(formWrap, loops);
        try{
          const zip = new PizZip(tpl);
          const doc = new window.docxtemplater(zip, {
            paragraphLoop:true, linebreaks:true,
            delimiters:{ start:'{', end:'}' },
            nullGetter:()=> ''
          });
          doc.render(data);
          const blob = doc.getZip().generate({ type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
          const fname = (tplName.replace(/\.docx$/i,'') || 'документ') + ' — заполнен.docx';
          U.download(fname, blob);
          ctx.toast('Документ сгенерирован ✓','ok');
          pushHistory({ name: tplName, fields: Object.keys(data).length, preset: activePreset, values: data, out: fname });
        }catch(err){ ctx.toast('Ошибка генерации: '+(err.message||err),'err'); }
      };
      if (v.empties){
        U.confirm({ title:'Есть незаполненные поля', message:`Не заполнено ${v.empties} ${plural(v.empties,'поле','поля','полей')}. Сгенерировать всё равно? Пустые поля останутся пустыми.`, ok:'Сгенерировать' })
          .then(ok => { if (ok) proceed(); });
      } else proceed();
    }

    /* --- предпросмотр (модалка): подстановка значений в текстовый каркас --- */
    function buildPreviewHTML(formWrap, loops){
      const data = collect(formWrap, loops);
      const flat = (detected && detected.flat) || [];
      const rows = flat.map(tok => {
        const val = data[tok];
        const filled = String(val||'').trim();
        return `<tr class="${filled?'':'doc-pv-empty'}">
          <td class="mono">{${U.escape(tok)}}</td>
          <td>${filled ? U.escape(val) : '<span class="muted">— не заполнено —</span>'}</td>
        </tr>`;
      }).join('');
      let loopsHTML = '';
      (loops||[]).forEach(loop => {
        const arr = data[loop.name] || [];
        loopsHTML += `<h4 style="margin:14px 0 6px">Секция «${U.escape(loop.name)}» — ${arr.length} ${plural(arr.length,'строка','строки','строк')}</h4>`;
        if (!arr.length){ loopsHTML += `<p class="muted" style="margin:0 0 8px">Нет строк.</p>`; return; }
        loopsHTML += arr.map((o,i)=>`<div class="doc-pv-loop"><b>#${i+1}</b> ${loop.tokens.map(t=>`<span class="mono">${U.escape(t)}</span>: ${U.escape(o[t]||'—')}`).join(' · ')}</div>`).join('');
      });
      return `<div class="doc-preview">
        <table class="tbl"><thead><tr><th>Поле</th><th>Значение в документе</th></tr></thead><tbody>${rows}</tbody></table>
        ${loopsHTML}
      </div>`;
    }

    function doPreview(formWrap, loops){
      U.modal('Предпросмотр подстановки', buildPreviewHTML(formWrap, loops) +
        `<div class="btn-row" style="justify-content:flex-end;margin-top:14px">
           <button class="btn" id="pv-print" type="button">🖨 Печать</button>
           <button class="btn primary" id="pv-gen" type="button" ${tpl?'':'disabled'}>⤓ Сгенерировать .docx</button>
         </div>`).body
        .querySelector('#pv-print').onclick = () => doPrint(formWrap, loops);
      const genBtn = document.querySelector('.modal-body #pv-gen');
      if (genBtn) genBtn.onclick = () => doGenerate(formWrap, loops);
    }

    /* --- печать: открыть чистый лист в новом окне --- */
    function doPrint(formWrap, loops){
      const data = collect(formWrap, loops);
      const flat = (detected && detected.flat) || [];
      const rowsHTML = flat.map(tok => {
        const val = data[tok];
        return `<tr><td class="k">${esc(prettyLabel(tok))}</td><td class="v">${esc(String(val||'—'))}</td></tr>`;
      }).join('');
      let loopsHTML = '';
      (loops||[]).forEach(loop => {
        const arr = data[loop.name] || [];
        if (!arr.length) return;
        loopsHTML += `<h2>${esc(loop.name)}</h2><table><tbody>` +
          arr.map((o,i)=>`<tr><td class="k">#${i+1}</td><td class="v">${loop.tokens.map(t=>esc(o[t]||'—')).join(', ')}</td></tr>`).join('') +
          `</tbody></table>`;
      });
      const title = activePreset ? activePreset : (tplName || 'Документ');
      const html =
        `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>
         <style>
           body{font-family:Arial,"Segoe UI",sans-serif;color:#141925;max-width:720px;margin:32px auto;padding:0 24px}
           h1{font-size:20px;margin:0 0 4px;letter-spacing:-.01em} h2{font-size:15px;margin:20px 0 6px}
           .meta{color:#475067;font-size:13px;margin-bottom:18px}
           table{width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:8px}
           td{padding:7px 8px;border-bottom:1px solid #e8ebf0;vertical-align:top}
           td.k{color:#475067;width:42%} td.v{font-weight:600}
           .foot{color:#8a93a3;font-size:12px;margin-top:24px;border-top:1px solid #e8ebf0;padding-top:10px}
         </style></head><body>
         <h1>${esc(title)}</h1>
         <div class="meta">Сенсор · Документооборот / УЦ — карта значений документа<br>Дата: ${new Date().toLocaleDateString('ru-RU')}${tplName?'<br>Шаблон: '+esc(tplName):''}</div>
         <table><tbody>${rowsHTML||'<tr><td class="v">Поля не заполнены</td></tr>'}</tbody></table>
         ${loopsHTML}
         <div class="foot">Распечатано из приложения «Сенсор Suite». Карта значений для проверки перед формированием .docx.</div>
         </body></html>`;
      const w = window.open('', '_blank');
      if (!w){ ctx.toast('Разрешите всплывающие окна для печати','err'); return; }
      w.document.write(html); w.document.close(); w.focus();
      setTimeout(()=>{ try{ w.print(); }catch(e){} }, 150);
    }

    /* --- демо-заполнение (обезличенные образцы, без реальных ПДн) --- */
    const DEMO = {
      name:'Иванов Иван Иванович', name_f:'Петрова Мария Сергеевна',
      orgFull:'Общество с ограниченной ответственностью «Альфа-Безопасность»',
      orgShort:'ООО «Альфа-Безопасность»',
      inn:'7707083893', ogrn:'1027700132195',
      address:'109012, г. Москва, ул. Никольская, д. 10, оф. 5',
      pos:'Главный инженер', edu:'Высшее, «Пожарная безопасность»',
      work:'ООО «Альфа-Безопасность»', num:'2024/00457', date:'15.03.2025',
      okved:'80.10, 71.20', std:'ISO 9001:2015', course:'Пожарная безопасность'
    };
    function fillDemo(formWrap){
      formWrap.querySelectorAll('.doc-field [data-tok]').forEach(inp => {
        const tok = inp.dataset.tok;
        if (caseFor(tok) && inp.dataset.auto==='1') return; // склоняемые заполнятся авто
        const type = fieldType(tok); const u = tok.toUpperCase();
        let v = '';
        if (type==='name'){ v = /_ISO_EXPERT|EXPERT/.test(u) && !/STUDENT/.test(u) ? DEMO.name : (/STUDENT/.test(u)? DEMO.name : DEMO.name); }
        else if (type==='inn') v = DEMO.inn;
        else if (type==='ogrn') v = DEMO.ogrn;
        else if (type==='date') v = DEMO.date;
        else if (/FULL_NAME/.test(u)) v = DEMO.orgFull;
        else if (/SHORT_NAME/.test(u)) v = DEMO.orgShort;
        else if (/ADDRESS/.test(u)) v = DEMO.address;
        else if (/OKVED/.test(u)) v = DEMO.okved;
        else if (/STANDARDS/.test(u)) v = DEMO.std;
        else if (/EDUCATION/.test(u)) v = DEMO.edu;
        else if (/WORKPLACE/.test(u)) v = DEMO.work;
        else if (/POSITION/.test(u)) v = DEMO.pos;
        else if (/COURSE_NAME/.test(u)) v = DEMO.course;
        else if (/NUMBER|CODE/.test(u)) v = DEMO.num;
        else v = DEMO.num;
        inp.value = v; inp.dispatchEvent(new Event('input', { bubbles:true }));
      });
      ctx.toast('Форма заполнена демо-значениями','info');
    }

    /* --- черновик --- */
    function saveDraft(formWrap, loops){
      if (!detected) return;
      try{
        ctx.store.set(DKEY, {
          flat: detected.flat, loops: detected.loops, counts: detected.counts,
          label: activePreset || tplName || 'Черновик',
          values: collect(formWrap, loops),
          at: new Date().toISOString()
        });
      }catch(e){}
    }

    /* ----------------------------------------------------------------------
       7b. ВКЛАДКА «СПРАВОЧНИК ПОЛЕЙ»
       ---------------------------------------------------------------------- */
    function buildRef(){
      // группировка по пакету
      let html = U.card('Справочник полей УЦ ('+seed.length+')',
        'Поля, которые система знает для 6 пакетов обучения. Нажмите на строку, чтобы скопировать плейсхолдер.',
        `<div class="pill-tabs" id="ref-filter" style="margin-bottom:14px">
           <button class="pill active" data-pf="all">Все <span class="t-count">${seed.length}</span></button>
           ${packages.map(p=>`<button class="pill" data-pf="${U.escape(p.name)}">${U.escape(p.short)} <span class="t-count">${p.tokens.length}</span></button>`).join('')}
         </div>
         <div class="tbl-wrap" style="max-height:440px">
           <table class="tbl"><thead><tr><th>Поле</th><th>Назначение</th><th>Источник</th><th>Пакет</th></tr></thead>
           <tbody id="ref-rows">${refRows(seed)}</tbody></table>
         </div>`);
      // карточки пакетов
      html += U.card('6 пакетов УЦ', 'Состав каждого пакета и его поля.',
        `<div class="grid cols-2" id="ref-packs">${packages.map(p=>`
          <div class="doc-pack">
            <div class="doc-pack-h"><span class="doc-pack-n">${U.escape(p.num)}</span><b>${U.escape(p.short)}</b></div>
            <div class="doc-pack-meta">${p.tokens.length} ${plural(p.tokens.length,'поле','поля','полей')}</div>
            <div class="doc-pack-toks">${p.tokens.slice(0,8).map(t=>`<span class="badge">${U.escape(t)}</span>`).join('')}${p.tokens.length>8?`<span class="muted" style="font-size:11.5px"> +${p.tokens.length-8}</span>`:''}</div>
            <button class="btn ghost sm" data-pack-go="${U.escape(p.name)}" type="button">Открыть в генераторе →</button>
          </div>`).join('')}</div>`);
      return html;
    }
    function refRows(list){
      return list.map(f=>{
        const tok = f.placeholder.replace(/[{}]/g,'').trim();
        return `<tr data-copy="${U.escape(f.placeholder)}" data-pk="${U.escape(f.package||'')}" style="cursor:pointer" title="Скопировать ${U.escape(f.placeholder)}">
          <td class="mono">${U.escape(f.placeholder)}</td>
          <td>${U.escape(prettyLabel(tok))}</td>
          <td><span class="badge">${U.escape(f.source||'—')}</span></td>
          <td><span class="muted" style="font-size:11.5px">${U.escape((f.package||'').replace(/ПАКЕТ\s*\d+:?/i,'').trim())}</span></td>
        </tr>`;
      }).join('');
    }
    function bindRef(panel){
      const rows = panel.querySelector('#ref-rows');
      panel.querySelectorAll('#ref-filter .pill').forEach(b=>{
        b.onclick = ()=>{
          panel.querySelectorAll('#ref-filter .pill').forEach(x=>x.classList.toggle('active', x===b));
          const pf = b.dataset.pf;
          const list = pf==='all' ? seed : seed.filter(f=>f.package===pf);
          rows.innerHTML = refRows(list);
          bindRows();
        };
      });
      function bindRows(){
        rows.querySelectorAll('[data-copy]').forEach(tr=> tr.onclick = ()=> U.copy(tr.dataset.copy, 'Плейсхолдер скопирован ✓'));
      }
      bindRows();
      panel.querySelectorAll('[data-pack-go]').forEach(b=>{
        b.onclick = ()=>{
          const pk = packages.find(p=>p.name===b.dataset.packGo);
          tabs.select('gen');
          setTimeout(()=>{ const bar = root.querySelector('#doc-presets'); if (bar && pk) applyPreset(pk, bar); }, 40);
        };
      });
    }

    /* ----------------------------------------------------------------------
       7c. ВКЛАДКА «ИСТОРИЯ ГЕНЕРАЦИЙ»
       ---------------------------------------------------------------------- */
    function load(){ const a = ctx.store.get(HKEY, []); return Array.isArray(a) ? a : []; }
    function persist(a){ ctx.store.set(HKEY, a); }
    function pushHistory(entry){
      const list = load();
      list.unshift(Object.assign({ id: 'g'+Date.now().toString(36), at: new Date().toISOString() }, entry));
      persist(list.slice(0, 50)); // не раздуваем
      // обновим счётчик таба, если он отрисован
      const cnt = tabs.bar.querySelector('[data-doc-tab="history"] .t-count');
      if (cnt) cnt.textContent = load().length;
    }

    function buildHistory(){
      const wrap = document.createElement('div');
      const list = load();
      const head = document.createElement('div');
      head.className = 'card';
      head.innerHTML =
        `<h3>История генераций <span class="badge">${list.length}</span></h3>
         <p class="hint">Последние сформированные документы (до 50). Хранится локально в браузере. Можно повторно заполнить форму теми же данными.</p>
         <div class="btn-row">
           <button class="btn sm" id="hist-export" type="button" ${list.length?'':'disabled'}>⤓ Экспорт журнала (.json)</button>
           <button class="btn ghost sm" id="hist-clear" type="button" ${list.length?'':'disabled'}>Очистить историю</button>
         </div>`;
      wrap.appendChild(head);

      const body = document.createElement('div');
      body.className = 'card';
      if (!list.length){
        body.innerHTML = U.empty('🕘','Пока ничего не сгенерировано. Сформируйте документ во вкладке «Генератор» — он появится здесь.');
      } else {
        body.innerHTML =
          `<div class="tbl-wrap" style="max-height:460px"><table class="tbl">
             <thead><tr><th>Документ</th><th>Поля</th><th>Когда</th><th></th></tr></thead>
             <tbody>` +
          list.map(h=>`<tr>
            <td><b>${U.escape(h.out||h.name||'документ')}</b>${h.preset?`<br><span class="muted" style="font-size:11.5px">${U.escape(h.preset)}</span>`:(h.name&&h.out!==h.name?`<br><span class="muted" style="font-size:11.5px">из ${U.escape(h.name)}</span>`:'')}</td>
            <td class="mono">${h.fields||0}</td>
            <td><span class="muted" style="font-size:12px">${fmtDate(h.at)}</span></td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn ghost sm" data-hist-reuse="${U.escape(h.id)}" title="Заполнить форму этими данными">↻ повторить</button>
              <button class="btn ghost sm" data-hist-del="${U.escape(h.id)}" title="Удалить запись">✕</button>
            </td>
          </tr>`).join('') +
          `</tbody></table></div>`;
      }
      wrap.appendChild(body);

      // события
      const exp = head.querySelector('#hist-export');
      if (exp) exp.onclick = ()=>{
        const blob = new Blob([JSON.stringify(load(), null, 2)], { type:'application/json' });
        U.download('журнал-генераций.json', blob);
        ctx.toast('Журнал выгружен ✓','ok');
      };
      const clr = head.querySelector('#hist-clear');
      if (clr) clr.onclick = async ()=>{
        const ok = await U.confirm({ title:'Очистить историю?', message:'Все записи журнала будут удалены безвозвратно.', ok:'Очистить', danger:true });
        if (!ok) return;
        persist([]); tabs.select('history'); // перерисуем
        const cnt = tabs.bar.querySelector('[data-doc-tab="history"] .t-count'); if (cnt) cnt.textContent = '0';
      };
      body.querySelectorAll('[data-hist-del]').forEach(b=> b.onclick = ()=>{
        persist(load().filter(x=>x.id!==b.dataset.histDel));
        const cnt = tabs.bar.querySelector('[data-doc-tab="history"] .t-count'); if (cnt) cnt.textContent = load().length;
        tabs.select('history');
      });
      body.querySelectorAll('[data-hist-reuse]').forEach(b=> b.onclick = ()=>{
        const h = load().find(x=>x.id===b.dataset.histReuse);
        if (!h){ return; }
        // восстановим detected из ключей значений
        const vals = h.values || {};
        const loopKeys = Object.keys(vals).filter(k=>Array.isArray(vals[k]));
        const flat = Object.keys(vals).filter(k=>!Array.isArray(vals[k]));
        detected = {
          flat,
          loops: loopKeys.map(k=>({ name:k, tokens: vals[k][0]?Object.keys(vals[k][0]):[] })),
          counts: {}
        };
        activePreset = h.preset || null;
        tabs.select('gen');
        setTimeout(()=>{
          const formWrap = root.querySelector('#doc-form');
          renderForm(formWrap, vals, h.out||h.name||'из истории');
          // загрузим строки петель
          (detected.loops).forEach(loop=>{
            const host = formWrap.querySelector(`[data-loop-rows="${cssEsc(loop.name)}"]`);
            if (!host) return;
            host.innerHTML='';
            (vals[loop.name]||[]).forEach(row=> addLoopRow(host, loop, row));
            if (!host.children.length) addLoopRow(host, loop, {});
          });
          updateProgress(formWrap);
          ctx.toast('Данные подставлены в форму','info');
        }, 50);
      });
      return wrap;
    }

    /* ======================================================================
       8. УТИЛИТЫ
       ====================================================================== */
    function plural(n, one, few, many){
      const a = Math.abs(n) % 100, b = a % 10;
      if (a>10 && a<20) return many;
      if (b>1 && b<5) return few;
      if (b===1) return one;
      return many;
    }
    function fmtDate(iso){
      try{ const d = new Date(iso); return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); }
      catch(e){ return iso||''; }
    }
    function esc(s){ return U.escape(s); }
    // безопасное экранирование для CSS-селекторов [data-tok="..."] (кириллица/спецсимволы)
    function cssEsc(s){
      if (window.CSS && CSS.escape) return CSS.escape(s);
      return String(s).replace(/["\\\]\[]/g, '\\$&');
    }
  }
});

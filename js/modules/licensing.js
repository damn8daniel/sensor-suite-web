/* Модуль «Лицензирование» — замена легаси-«Спарты» (Documents.exe).
   Готовит пакеты документов на лицензию МЧС (монтаж/ТО/ремонт средств ОПБ)
   для ООО и ИП. Реквизиты + валидация ИНН, автозаполнение через DaData,
   генерация из загруженного .docx-шаблона (docxtemplater) или текстовый
   предпросмотр с экспортом. Без глюков старой «Спарты». */
SensorApp.register({
  id: 'licensing', title: 'Лицензирование', dept: 'Лицензирование', order: 20,
  icon: '🛡️', description: 'Пакеты документов на лицензию · ООО / ИП · автозаполнение по ИНН',
  mount(root, ctx){
    const E = ctx.ui.escape;

    /* ---- справочник типов документов (из SEED.sparta, иначе фолбэк) ---- */
    // Реальные типы из легаси-«Спарты» (папка «Мои шаблоны»), обезличенные.
    const FALLBACK = [
      { id:'doverennost',  name:'Доверенность на представление интересов в ГУ МЧС',          forms:['ООО','ИП'] },
      { id:'arenda',       name:'Договор аренды оборудования',                                forms:['ООО','ИП'] },
      { id:'arenda_break', name:'Соглашение о расторжении договора аренды оборудования',      forms:['ООО','ИП'] },
      { id:'td',           name:'Трудовой договор (форма)',                                   forms:['ООО','ИП'] },
      { id:'prikaz_otv',   name:'Приказ о назначении ответственного (ЛВД)',                   forms:['ООО','ИП'] },
      { id:'prikaz_uvol',  name:'Приказ об увольнении',                                       forms:['ООО','ИП'] },
      { id:'info_letter',  name:'Информационное письмо о невозможности проведения проверки',  forms:['ООО','ИП'] },
      { id:'priobschenie', name:'Приобщение документов на проверке',                          forms:['ООО','ИП'] },
      { id:'cheklist',     name:'Чек-лист для сбора пакета документов',                       forms:['ООО','ИП'] }
    ];
    const sparta = ((ctx.data && ctx.data.sparta) || {});
    let docTypes = Array.isArray(sparta) ? sparta
                 : (Array.isArray(sparta.templates) ? sparta.templates
                 : (Array.isArray(sparta.documents) ? sparta.documents : FALLBACK));
    if (!docTypes.length) docTypes = FALLBACK;
    // нормализуем форму элемента
    docTypes = docTypes.map((d,i)=>({
      id: d.id || ('doc'+i),
      name: d.name || d.title || ('Документ '+(i+1)),
      forms: Array.isArray(d.forms) && d.forms.length ? d.forms : ['ООО','ИП']
    }));

    /* ---- реквизиты формы ---- */
    const FIELDS = [
      { key:'name',     label:'Наименование организации', ph:'ООО «Ромашка» / ИП Иванов И.И.' },
      { key:'inn',      label:'ИНН',                      ph:'10 цифр (ООО) или 12 (ИП)', mono:true },
      { key:'ogrn',     label:'ОГРН / ОГРНИП',            ph:'13 или 15 цифр', mono:true },
      { key:'kpp',      label:'КПП',                      ph:'9 цифр (только ООО)', mono:true, oooOnly:true },
      { key:'address',  label:'Юридический адрес',        ph:'г. Москва, ул. Примерная, д. 1' },
      { key:'director', label:'Руководитель / ИП',        ph:'Иванов Иван Иванович' },
      { key:'work',     label:'Вид работ',                ph:'Монтаж, ТО и ремонт средств обеспечения пожарной безопасности' }
    ];

    let state = { form:'ООО', docType: docTypes[0].id, tpl:null, tplName:'', tokens:[] };

    /* ---- разметка ---- */
    root.innerHTML =
      ctx.ui.card('Что готовим',
        'Выберите форму организации и тип документа. Поля «Спарты» переведены в форму с проверкой ИНН.',
        `<div class="field"><label>Форма организации</label>
           <div class="pill-tabs" id="form-tabs">
             <span class="pill ${state.form==='ООО'?'active':''}" data-form="ООО">ООО</span>
             <span class="pill ${state.form==='ИП'?'active':''}" data-form="ИП">ИП</span>
           </div></div>
         ${ctx.ui.field('Тип документа',
           `<select id="doc-type"></select>`)}`) +

      ctx.ui.card('Реквизиты',
        'Заполните вручную или подтяните по ИНН из картотеки контрагентов.',
        `<div class="btn-row" style="margin-bottom:12px">
           <input id="lookup-inn" placeholder="ИНН для поиска" class="mono" style="max-width:200px">
           <button class="btn" id="lookup">🔎 Заполнить из контрагента</button>
           <span id="lookup-note" class="badge" style="display:none"></span>
         </div>
         <div id="req-fields"></div>
         <div id="inn-status" style="margin-top:2px"></div>`) +

      ctx.ui.card('Шаблон (необязательно)',
        'Загрузите .docx-шаблон с полями {ОРГАНИЗАЦИЯ}, {ИНН}… — заполним его. Без шаблона соберём текстовый документ.',
        `<div class="btn-row">
           <label class="btn primary">📎 Загрузить .docx<input id="tpl" type="file" accept=".docx" hidden></label>
           <span id="tplname" class="badge">шаблон не выбран</span>
         </div>`) +

      ctx.ui.card('Генерация',
        '',
        `<div class="btn-row">
           <button class="btn primary" id="gen">⤓ Сгенерировать</button>
           <button class="btn" id="preview">👁 Предпросмотр</button>
           <button class="btn ghost" id="clear">Очистить</button>
         </div>
         <div id="preview-wrap" style="margin-top:14px"></div>`);

    /* ---- селект типов документов ---- */
    const sel = root.querySelector('#doc-type');
    function fillTypes(){
      const list = docTypes.filter(d=>d.forms.indexOf(state.form)>=0);
      sel.innerHTML = list.map(d=>`<option value="${E(d.id)}">${E(d.name)}</option>`).join('');
      if (!list.find(d=>d.id===state.docType)) state.docType = (list[0]&&list[0].id) || '';
      sel.value = state.docType;
    }
    sel.addEventListener('change', ()=>{ state.docType = sel.value; });

    /* ---- табы формы ---- */
    root.querySelector('#form-tabs').addEventListener('click', e=>{
      const p = e.target.closest('.pill'); if(!p) return;
      state.form = p.dataset.form;
      root.querySelectorAll('#form-tabs .pill').forEach(x=>x.classList.toggle('active', x.dataset.form===state.form));
      fillTypes();
      renderFields();
    });

    /* ---- поля реквизитов ---- */
    function renderFields(){
      const w = root.querySelector('#req-fields');
      const vals = collect(false);
      w.innerHTML = FIELDS.filter(f=>!(f.oooOnly && state.form==='ИП')).map(f=>
        ctx.ui.field(f.label,
          `<input data-key="${E(f.key)}" placeholder="${E(f.ph)}" class="${f.mono?'mono':''}" value="${E(vals[f.key]||'')}">`)
      ).join('');
      w.querySelector('[data-key="inn"]').addEventListener('input', validateInn);
      validateInn();
    }

    function collect(/*forValidation*/){
      const o = {};
      root.querySelectorAll('#req-fields [data-key]').forEach(i=>o[i.dataset.key]=i.value.trim());
      return o;
    }

    /* ---- валидация ИНН (10 для ЮЛ, 12 для ФЛ/ИП) с контрольной суммой ---- */
    function innChecksum(inn){
      const d = inn.split('').map(Number);
      const k = (w)=> w.reduce((s,wi,i)=>s+wi*d[i],0)%11%10;
      if (inn.length===10){
        return d[9] === k([2,4,10,3,5,9,4,6,8]);
      }
      if (inn.length===12){
        const n11 = k([7,2,4,10,3,5,9,4,6,8]);
        const n12 = k([3,7,2,4,10,3,5,9,4,6,8]);
        return d[10]===n11 && d[11]===n12;
      }
      return false;
    }
    function validateInn(){
      const inp = root.querySelector('#req-fields [data-key="inn"]');
      const box = root.querySelector('#inn-status');
      if(!inp){ box.innerHTML=''; return true; }
      const inn = inp.value.trim();
      if(!inn){ box.innerHTML=''; return false; }
      const expectLen = state.form==='ООО' ? 10 : 12;
      if(!/^\d+$/.test(inn)){ box.innerHTML = `<span class="badge err">ИНН: только цифры</span>`; return false; }
      if(inn.length!==expectLen){
        box.innerHTML = `<span class="badge err">ИНН ${state.form}: нужно ${expectLen} цифр (введено ${inn.length})</span>`;
        return false;
      }
      if(!innChecksum(inn)){ box.innerHTML = `<span class="badge err">ИНН: не сходится контрольная сумма</span>`; return false; }
      box.innerHTML = `<span class="badge ok">ИНН корректен ✓</span>`;
      return true;
    }

    /* ---- автозаполнение из DaData (мок без ключей) ---- */
    root.querySelector('#lookup').addEventListener('click', async ()=>{
      const btn = root.querySelector('#lookup');
      const note = root.querySelector('#lookup-note');
      const q = (root.querySelector('#lookup-inn').value.trim()) ||
                (root.querySelector('#req-fields [data-key="inn"]')||{}).value || '';
      if(!q){ return ctx.toast('Укажите ИНН для поиска','err'); }
      btn.disabled = true; btn.innerHTML = ctx.ui.spinner + ' Поиск…';
      try{
        const dadata = ctx.integrations.dadata;
        const res = dadata ? await dadata.run('findById', String(q).trim())
                           : { ok:false, data:null, note:'DaData не подключена' };
        const d = res && res.data;
        if(!d){ ctx.toast('Контрагент не найден','err'); }
        else {
          apply(d);
          if(res.mock || !res.ok){
            note.style.display=''; note.className='badge warn';
            note.textContent = res.note || 'демо-данные';
          } else { note.style.display=''; note.className='badge ok'; note.textContent='данные DaData ✓'; }
          ctx.toast('Реквизиты заполнены','ok');
        }
      }catch(err){ ctx.toast('Ошибка пробива: '+(err.message||err),'err'); }
      finally{ btn.disabled=false; btn.innerHTML='🔎 Заполнить из контрагента'; }
    });

    function apply(d){
      // d — нормализованный объект DaData {name,inn,ogrn,kpp,address,manager,status}
      const map = { name:d.name, inn:d.inn, ogrn:d.ogrn, kpp:d.kpp, address:d.address, director:d.manager };
      // авто-переключение формы по длине ИНН
      if(d.inn && d.inn.length===12 && state.form!=='ИП'){ state.form='ИП'; root.querySelectorAll('#form-tabs .pill').forEach(x=>x.classList.toggle('active', x.dataset.form==='ИП')); fillTypes(); renderFields(); }
      else if(d.inn && d.inn.length===10 && state.form!=='ООО'){ state.form='ООО'; root.querySelectorAll('#form-tabs .pill').forEach(x=>x.classList.toggle('active', x.dataset.form==='ООО')); fillTypes(); renderFields(); }
      root.querySelectorAll('#req-fields [data-key]').forEach(i=>{ if(map[i.dataset.key]) i.value = map[i.dataset.key]; });
      validateInn();
    }

    /* ---- загрузка шаблона .docx ---- */
    root.querySelector('#tpl').addEventListener('change', e=>{
      const file = e.target.files[0]; if(!file) return;
      const rd = new FileReader();
      rd.onload = ()=>{
        try{
          state.tpl = rd.result; state.tplName = file.name;
          const zip = new PizZip(state.tpl);
          state.tokens = detect(zip);
          root.querySelector('#tplname').textContent = file.name + ' · ' + state.tokens.length + ' полей';
        }catch(err){ state.tpl=null; ctx.toast('Не удалось прочитать шаблон: '+err.message,'err'); }
      };
      rd.readAsArrayBuffer(file);
    });
    function detect(zip){
      const set = new Set();
      const parts = zip.file(/word\/(document|header\d+|footer\d+)\.xml/);
      parts.forEach(p=>{ const text = p.asText().replace(/<[^>]+>/g,'');
        (text.match(/\{[^{}<>]+\}/g)||[]).forEach(t=>set.add(t.slice(1,-1).trim())); });
      return [...set];
    }

    /* ---- сборка данных для документа ---- */
    function docData(){
      const v = collect();
      const dt = docTypes.find(d=>d.id===state.docType);
      return {
        ОРГАНИЗАЦИЯ: v.name||'', НАИМЕНОВАНИЕ: v.name||'', ФОРМА: state.form,
        ИНН: v.inn||'', ОГРН: v.ogrn||'', ОГРНИП: v.ogrn||'', КПП: v.kpp||'',
        АДРЕС: v.address||'', ЮРАДРЕС: v.address||'', ДИРЕКТОР: v.director||'', РУКОВОДИТЕЛЬ: v.director||'',
        ВИД_РАБОТ: v.work||'', ВИДРАБОТ: v.work||'',
        ТИП_ДОКУМЕНТА: dt?dt.name:'', ДАТА: new Date().toLocaleDateString('ru-RU')
      };
    }

    /* ---- текстовый документ (фолбэк без шаблона) ---- */
    function buildText(){
      const v = collect();
      const dt = docTypes.find(d=>d.id===state.docType);
      const L = [];
      L.push((dt?dt.name:'Документ').toUpperCase());
      L.push('');
      L.push('Форма организации: '+state.form);
      L.push('Наименование: '+(v.name||'—'));
      L.push('ИНН: '+(v.inn||'—'));
      L.push('ОГРН'+(state.form==='ИП'?'ИП':'')+': '+(v.ogrn||'—'));
      if(state.form==='ООО') L.push('КПП: '+(v.kpp||'—'));
      L.push('Юридический адрес: '+(v.address||'—'));
      L.push((state.form==='ИП'?'ИП: ':'Руководитель: ')+(v.director||'—'));
      L.push('Вид работ: '+(v.work||'—'));
      L.push('');
      L.push('Дата: '+new Date().toLocaleDateString('ru-RU'));
      L.push('Подпись: ____________________ /'+(v.director||'')+'/');
      return L.join('\n');
    }

    root.querySelector('#preview').addEventListener('click', ()=>{
      root.querySelector('#preview-wrap').innerHTML =
        `<pre class="mono" style="white-space:pre-wrap;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:14px;max-height:340px;overflow:auto">${E(buildText())}</pre>`;
    });

    root.querySelector('#clear').addEventListener('click', ()=>{
      root.querySelectorAll('#req-fields [data-key]').forEach(i=>i.value='');
      root.querySelector('#lookup-inn').value='';
      root.querySelector('#lookup-note').style.display='none';
      root.querySelector('#preview-wrap').innerHTML='';
      validateInn();
    });

    /* ---- генерация ---- */
    root.querySelector('#gen').addEventListener('click', ()=>{
      const v = collect();
      if(!v.name){ return ctx.toast('Укажите наименование организации','err'); }
      if(!validateInn()){ return ctx.toast('Проверьте ИНН перед генерацией','err'); }
      const dt = docTypes.find(d=>d.id===state.docType);
      const base = ((dt?dt.name:'документ')+' — '+(v.name||state.form)).replace(/[\\/:*?"<>|]+/g,' ').trim();

      if(state.tpl){
        try{
          const zip = new PizZip(state.tpl);
          const doc = new window.docxtemplater(zip,{paragraphLoop:true,linebreaks:true,delimiters:{start:'{',end:'}'},nullGetter:()=>''});
          doc.render(docData());
          const blob = doc.getZip().generate({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
          ctx.ui.download(base+'.docx', blob);
          ctx.toast('Документ из шаблона сгенерирован ✓','ok');
        }catch(err){ ctx.toast('Ошибка генерации шаблона: '+(err.message||err),'err'); }
      } else {
        const text = buildText();
        root.querySelector('#preview-wrap').innerHTML =
          `<pre class="mono" style="white-space:pre-wrap;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:14px;max-height:340px;overflow:auto">${E(text)}</pre>`;
        const blob = new Blob(['﻿'+text], {type:'text/plain;charset=utf-8'});
        ctx.ui.download(base+'.txt', blob);
        ctx.toast('Текстовый документ собран и выгружен ✓','ok');
      }
    });

    /* ---- init ---- */
    fillTypes();
    renderFields();
  }
});

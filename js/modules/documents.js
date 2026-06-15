/* Модуль «Документы» — эталонный: генерация .docx из шаблона с {полями} прямо в браузере */
SensorApp.register({
  id: 'documents', title: 'Документы', dept: 'Документооборот', order: 10,
  icon: '📄', description: 'Генерация документов из шаблонов · 61 поле, 6 пакетов УЦ',
  mount(root, ctx){
    const seed = (ctx.data.placeholders && ctx.data.placeholders.fields) || [];
    let tpl = null, tplName = '';
    root.innerHTML =
      ctx.ui.card('Шаблон документа',
        'Загрузите .docx-шаблон с полями вида {ФИО}, {ОРГАНИЗАЦИЯ}. Приложение само найдёт поля и построит форму.',
        `<div class="btn-row">
           <label class="btn primary">📎 Загрузить шаблон .docx<input id="tpl" type="file" accept=".docx" hidden></label>
           <span id="tplname" class="badge">шаблон не выбран</span>
         </div>`) +
      `<div id="form-wrap"></div>` +
      ctx.ui.card('Справочник полей УЦ ('+seed.length+')',
        'Поля, которые система знает для 6 пакетов обучения (источник данных указан).',
        `<div style="max-height:240px;overflow:auto"><table class="tbl"><thead><tr><th>Поле</th><th>Пакет</th><th>Источник</th></tr></thead><tbody>`+
        seed.map(f=>`<tr><td class="mono">${ctx.ui.escape(f.placeholder)}</td><td>${ctx.ui.escape((f.package||'').replace(/ПАКЕТ\s*\d+:?/i,'').trim())}</td><td>${ctx.ui.escape(f.source)}</td></tr>`).join('')+
        `</tbody></table></div>`);

    const labelFor = tok => {
      const hit = seed.find(f=>f.placeholder==='{'+tok+'}');
      const pretty = tok.replace(/_/g,' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
      return hit ? pretty + (hit.source?` · ${hit.source}`:'') : pretty;
    };

    function detect(zip){
      const set = new Set();
      const parts = zip.file(/word\/(document|header\d+|footer\d+)\.xml/);
      parts.forEach(p=>{ const text = p.asText().replace(/<[^>]+>/g,''); (text.match(/\{[^{}<>]+\}/g)||[]).forEach(t=>set.add(t.slice(1,-1).trim())); });
      return [...set];
    }

    root.querySelector('#tpl').addEventListener('change', e=>{
      const file = e.target.files[0]; if(!file) return;
      tplName = file.name;
      const rd = new FileReader();
      rd.onload = () => {
        try{
          tpl = rd.result;
          const zip = new PizZip(tpl);
          const tokens = detect(zip);
          root.querySelector('#tplname').textContent = file.name + ' · ' + tokens.length + ' полей';
          renderForm(tokens);
        }catch(err){ ctx.toast('Не удалось прочитать шаблон: '+err.message,'err'); }
      };
      rd.readAsArrayBuffer(file);
    });

    function renderForm(tokens){
      const w = root.querySelector('#form-wrap');
      if(!tokens.length){ w.innerHTML = ctx.ui.card('Поля','', ctx.ui.empty('🔍','В шаблоне не найдено полей вида {ПОЛЕ}.')); return; }
      w.innerHTML = ctx.ui.card('Заполните поля', tokens.length+' полей из шаблона',
        tokens.map(t=>ctx.ui.field(labelFor(t),
          `<input data-tok="${ctx.ui.escape(t)}" placeholder="${ctx.ui.escape(t)}">`, '{'+t+'}')).join('') +
        `<div class="btn-row" style="margin-top:8px">
           <button class="btn primary" id="gen">⤓ Сгенерировать .docx</button>
           <button class="btn" id="clear">Очистить</button>
         </div>`);
      w.querySelector('#clear').onclick = ()=>w.querySelectorAll('[data-tok]').forEach(i=>i.value='');
      w.querySelector('#gen').onclick = ()=>generate(w);
    }

    function generate(w){
      if(!tpl) return ctx.toast('Сначала загрузите шаблон','err');
      const data = {}; w.querySelectorAll('[data-tok]').forEach(i=>data[i.dataset.tok]=i.value);
      try{
        const zip = new PizZip(tpl);
        const doc = new window.docxtemplater(zip,{paragraphLoop:true,linebreaks:true,delimiters:{start:'{',end:'}'},nullGetter:()=> ''});
        doc.render(data);
        const blob = doc.getZip().generate({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
        ctx.ui.download((tplName.replace(/\.docx$/i,'')||'документ')+' — заполнен.docx', blob);
        ctx.toast('Документ сгенерирован ✓','ok');
      }catch(err){ ctx.toast('Ошибка генерации: '+(err.message||err),'err'); }
    }
  }
});

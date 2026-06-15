/* Модуль «Проверка специалистов» (P5) — отдельный полноценный движок правил.
   Проверяет, подходит ли специалист под одну из целей:
     • mchs_responsible — ответственный за ПБ под лицензию МЧС (стаж, образование, занятость);
     • mchs_techspecs   — техспециалисты МЧС (нужное число по количеству видов работ);
     • nok              — независимая оценка квалификации (диплом + стаж + экзамен);
     • nrs              — национальный реестр специалистов (диплом + стаж + НОК + документы).

   Поток: выбор цели → форма данных специалиста (тип образования, профпереподготовка,
   стаж, стаж под лицензией МЧС, число видов работ — для техспеца, источник данных:
   ЭТК/электронная трудовая ИЛИ бумажная/рукописная) → «Проверить» → детерминированный
   ДВИЖОК ПРАВИЛ по window.SPEC_RULES → вердикт «ПОДХОДИТ / НЕ ПОДХОДИТ» + построчный
   разбор каждого требования (✓/✗/▲ + ПОЧЕМУ + что нужно). Опционально, если задан
   LLM-эндпоинт (ctx.store.creds('llm')) — добавляем текстовое обоснование; без LLM
   движок полностью детерминирован.

   Нюанс бумажных трудовых: «модель не читает — заполните вручную» + загрузка фото-сканов
   (превью локально, ничего не уходит на сервер).

   Контракт сохранён: id='specialists', dept='Документооборот', order=15.
   Данные правил берём из window.SPEC_RULES; если он пуст — встроенный фолбэк (FALLBACK),
   так что модуль никогда не пустой и не зависит от внешнего файла. Не использует ui.tabs()
   (известный дефект рекурсии при клике) — переключатели сделаны на pill-tabs вручную. */

SensorApp.register({
  id: 'specialists', title: 'Проверка специалистов', dept: 'Документооборот', order: 15,
  icon: '🧑‍🔧',
  description: 'Подходит/не подходит для лицензии МЧС / НОК / НРС + почему',
  keywords: ['специалист','мчс','нок','нрс','лицензия','стаж','образование','профпереподготовка','техспец','ответственный','пб','реестр'],

  mount(root, ctx){
    const U = ctx.ui, esc = U.escape;

    /* ====================================================================
       1. ПРАВИЛА. Источник — window.SPEC_RULES; пустой → встроенный FALLBACK.
       Сливаем по ключам, чтобы частично заданный SPEC_RULES дополнялся.
       ==================================================================== */
    const FALLBACK = {
      mchs_responsible: {
        title: 'Ответственный за ПБ (лицензия МЧС)',
        education_accepted: ['Пожарная безопасность', 'Техносферная безопасность'],
        retraining_min_hours: 250,
        min_years_experience: 5,
        experience_under_license: true,
        one_per_licensee: true,
        notes: 'Профильное образование (ПБ/Техносферная, СПО или высшее) ЛИБО любое СПО/высшее + ' +
               'профпереподготовка ≥250 ч. Стаж по профилю ПБ ≥5 лет; засчитывается опыт под лицензией ' +
               'МЧС / в Госпожнадзоре. Ответственным можно быть только у одного лицензиата.'
      },
      mchs_techspecs: {
        title: 'Технические специалисты (лицензия МЧС)',
        by_scope: [
          { views: '1-2', need: 2 },
          { views: '3-4', need: 3 },
          { views: '5+',  need: 5 }
        ],
        notes: 'Минимальное число техспециалистов на технических должностях по трудовым договорам ' +
               'зависит от числа заявленных видов работ: 1–2 вида → 2 чел., 3–4 → 3 чел., 5+ → 5 чел. ' +
               'Образование техспециалиста — не ниже СПО.'
      },
      nok: {
        title: 'Независимая оценка квалификации (НОК)',
        requires: {
          diploma_specialty: ['Пожарная безопасность', 'Техносферная безопасность', 'Строительство'],
          min_years: 3,
          exam: true
        },
        notes: 'ЦОК проверяет соответствие профстандарту: профильный диплом, минимальный стаж по профилю ' +
               'и сдача экзамена (теория + практика). Результат вносится в реестр сведений о НОК.'
      },
      nrs: {
        title: 'Национальный реестр специалистов (НРС)',
        requires: {
          diploma: 'профильное высшее/СПО',
          min_years: 10,
          nok_passed: true,
          docs: ['диплом', 'трудовая книжка / сведения о стаже', 'СНИЛС', 'удостоверение о повышении квалификации']
        },
        notes: 'Для включения в НРС нужен профильный диплом, стаж по профилю не менее 10 лет, пройденная ' +
               'НОК и полный пакет документов (диплом, подтверждение стажа, СНИЛС, удостоверение о ПК).'
      }
    };

    function mergeRules(){
      const src = (window.SPEC_RULES && typeof window.SPEC_RULES === 'object') ? window.SPEC_RULES : {};
      const out = {};
      Object.keys(FALLBACK).forEach(k => {
        out[k] = (src[k] && typeof src[k] === 'object') ? Object.assign({}, FALLBACK[k], src[k]) : FALLBACK[k];
      });
      // правила сверх известных (если в SPEC_RULES появятся новые цели) — пробрасываем как есть
      Object.keys(src).forEach(k => { if(!out[k]) out[k] = src[k]; });
      return out;
    }
    const RULES = mergeRules();

    /* ====================================================================
       2. СОСТОЯНИЕ (черновик в store; фото-сканы только в памяти сессии).
       ==================================================================== */
    const DKEY = 'specialists_draft';
    const TARGETS = [
      { id:'mchs_responsible', label:'Ответственный за ПБ (МЧС)', icon:'🛡️' },
      { id:'mchs_techspecs',   label:'Техспец МЧС',               icon:'🧰' },
      { id:'nok',              label:'НОК',                        icon:'🎓' },
      { id:'nrs',              label:'НРС',                        icon:'📋' }
    ].filter(t => RULES[t.id]);

    const saved = ctx.store.get(DKEY, {}) || {};
    const state = {
      target: TARGETS.some(t=>t.id===saved.target) ? saved.target : (TARGETS[0] && TARGETS[0].id),
      edu:        saved.edu        || 'fire',      // fire | techno | other
      retrain:    saved.retrain    || 'no',        // no | yes
      retrainH:   saved.retrainH   != null ? saved.retrainH : '',
      years:      saved.years      != null ? saved.years : '',
      underLic:   saved.underLic   || 'no',        // no | yes
      views:      saved.views      != null ? saved.views : '',
      headcount:  saved.headcount  != null ? saved.headcount : '',
      source:     saved.source     || 'etk',       // etk | paper
      nokPassed:  saved.nokPassed  || 'no'         // no | yes  (для НРС)
    };
    let scans = [];      // {name, url} — превью бумажных сканов
    let resultHTML = '';

    function persist(){
      const { ...copy } = state;
      try { ctx.store.set(DKEY, copy); } catch(e){}
    }

    /* ====================================================================
       3. РАЗМЕТКА
       ==================================================================== */
    root.innerHTML = `<div id="sp-target"></div><div id="sp-form"></div><div id="sp-out" style="margin-top:14px"></div>` +
                     `<div id="sp-rules" style="margin-top:14px"></div>`;
    const elTarget = root.querySelector('#sp-target');
    const elForm   = root.querySelector('#sp-form');
    const elOut    = root.querySelector('#sp-out');
    const elRules  = root.querySelector('#sp-rules');

    if(!TARGETS.length){
      elForm.innerHTML = U.empty('🗂️','Правила проверки специалистов не загружены (window.SPEC_RULES пуст и фолбэк отсутствует).');
      return;
    }

    renderTargetSwitcher();
    renderForm();
    renderRules();

    /* ---------- выбор цели проверки ---------- */
    function renderTargetSwitcher(){
      elTarget.innerHTML = U.card('Что проверяем',
        'Выберите цель — форма и движок правил подстроятся под требования.',
        `<div class="pill-tabs" id="sp-targets" role="tablist" style="margin-bottom:0">` +
          TARGETS.map(t=>`<button type="button" class="pill${t.id===state.target?' active':''}" role="tab"
              aria-selected="${t.id===state.target}" data-target="${t.id}">
              <span class="t-ic" aria-hidden="true" style="margin-right:6px">${t.icon}</span>${esc(t.label)}</button>`).join('') +
        `</div>`);
      elTarget.querySelectorAll('[data-target]').forEach(b=>{
        b.onclick = ()=>{
          if(state.target===b.dataset.target) return;
          state.target = b.dataset.target;
          persist();
          elTarget.querySelectorAll('.pill').forEach(p=>{
            const on = p.dataset.target===state.target;
            p.classList.toggle('active', on);
            p.setAttribute('aria-selected', on?'true':'false');
          });
          resultHTML = ''; elOut.innerHTML = '';
          renderForm();
          renderRules();
        };
      });
    }

    /* ---------- форма данных специалиста ---------- */
    function isTechspecs(){ return state.target==='mchs_techspecs'; }

    function renderForm(){
      const t = state.target;
      let html = '';

      if(isTechspecs()){
        // отдельная форма для техспециалистов: число видов работ + фактическое число спецов
        html =
          `<div class="grid cols-2">` +
            U.field('Число заявленных видов работ',
              `<input id="sp-views" type="number" min="0" max="50" step="1" value="${esc(state.views)}" placeholder="напр. 4">`) +
            U.field('Фактически техспециалистов (трудовые договоры)',
              `<input id="sp-headcount" type="number" min="0" max="200" step="1" value="${esc(state.headcount)}" placeholder="напр. 3">`) +
          `</div>` +
          U.field('Образование техспециалистов',
            `<select id="sp-edu">
               <option value="fire"${state.edu==='fire'?' selected':''}>Профильное (ПБ / Техносферная)</option>
               <option value="techno"${state.edu==='techno'?' selected':''}>Иное профессиональное (СПО/высшее)</option>
               <option value="other"${state.edu==='other'?' selected':''}>Без проф. образования</option>
             </select>`);
      } else {
        // общая форма специалиста (ответственный за ПБ / НОК / НРС)
        html =
          `<div class="grid cols-2">` +
            U.field('Тип образования',
              `<select id="sp-edu">
                 <option value="fire"${state.edu==='fire'?' selected':''}>Профильное ПБ</option>
                 <option value="techno"${state.edu==='techno'?' selected':''}>Техносферная безопасность</option>
                 <option value="other"${state.edu==='other'?' selected':''}>Иное</option>
               </select>`) +
            U.field('Профпереподготовка',
              `<select id="sp-retrain">
                 <option value="no"${state.retrain==='no'?' selected':''}>Нет</option>
                 <option value="yes"${state.retrain==='yes'?' selected':''}>Есть</option>
               </select>`) +
          `</div>` +
          `<div class="grid cols-2">` +
            U.field('Часов профпереподготовки', `<input id="sp-retrainH" type="number" min="0" max="2000" step="1" value="${esc(state.retrainH)}" placeholder="напр. 256"${state.retrain==='yes'?'':' disabled'}>`) +
            U.field('Стаж по профилю, лет', `<input id="sp-years" type="number" min="0" max="60" step="1" value="${esc(state.years)}" placeholder="напр. 6">`) +
          `</div>` +
          `<div class="grid cols-2">` +
            U.field('Стаж под лицензией МЧС / в Госпожнадзоре',
              `<select id="sp-underLic">
                 <option value="no"${state.underLic==='no'?' selected':''}>Нет</option>
                 <option value="yes"${state.underLic==='yes'?' selected':''}>Да</option>
               </select>`) +
            (t==='nrs'
              ? U.field('Пройдена НОК',
                  `<select id="sp-nokPassed">
                     <option value="no"${state.nokPassed==='no'?' selected':''}>Нет</option>
                     <option value="yes"${state.nokPassed==='yes'?' selected':''}>Да</option>
                   </select>`)
              : `<div class="field"><label>&nbsp;</label><div class="hint" style="padding-top:6px">${esc(targetHint(t))}</div></div>`) +
          `</div>`;
      }

      // источник данных (для всех целей)
      html +=
        U.field('Источник данных о стаже',
          `<div class="pill-tabs" id="sp-source" role="tablist" style="margin-bottom:0">
             <button type="button" class="pill${state.source==='etk'?' active':''}" role="tab" data-source="etk">ЭТК / электронная трудовая</button>
             <button type="button" class="pill${state.source==='paper'?' active':''}" role="tab" data-source="paper">Бумажная / рукописная</button>
           </div>`,
          'ЭТК читается автоматически. Бумажную/рукописную модель не разбирает — данные вносятся вручную.');

      // блок ручного ввода + загрузка сканов для бумажной трудовой
      html += `<div id="sp-paper" ${state.source==='paper'?'':'hidden'}>` +
        U.card('Бумажная / рукописная трудовая',
          'Модель не читает рукописные и бумажные трудовые — заполните стаж и образование вручную выше. Сканы прикрепляются для архива, локально (никуда не отправляются).',
          `<label class="dropzone" id="sp-dz" tabindex="0" role="button" aria-label="Загрузить фото-сканы трудовой" style="min-height:auto;padding:18px">
             <input id="sp-scan" type="file" accept="image/*" multiple hidden>
             <span class="dz-ic" aria-hidden="true">📷</span>
             <span class="dz-main">Загрузить фото-сканы</span>
             <span class="dz-sub">jpg / png — несколько файлов; превью только в этой сессии</span>
           </label>
           <div id="sp-scan-list" class="grid cols-3" style="gap:8px;margin-top:10px"></div>`) +
        `</div>`;

      // действия
      html += `<div class="card"><div class="btn-row">
                 <button class="btn primary" id="sp-run">Проверить</button>
                 <button class="btn" id="sp-reset">Сбросить</button>
                 <span class="spacer" style="flex:1"></span>
                 ${llmReady() ? `<span class="badge ok dot">LLM-обоснование включено</span>`
                              : `<span class="badge" title="Подключите LLM в Настройках для текстового обоснования">движок детерминированный</span>`}
               </div></div>`;

      elForm.innerHTML = `<div class="card"><h3>Данные специалиста</h3>` + html + `</div>`;
      // (обёрнули один раз; внутренние U.card дают вложенные карточки — это нормально для секций)
      wireForm();
      if(state.source==='paper') paintScans();
      if(resultHTML){ elOut.innerHTML = resultHTML; bindOut(); }
    }

    function targetHint(t){
      if(t==='nok') return 'НОК: профильный диплом + стаж + экзамен в ЦОК.';
      if(t==='mchs_responsible') return 'Ответственный — только у одного лицензиата.';
      return '';
    }

    function wireForm(){
      const bind = (sel, key, isNum) => {
        const el = elForm.querySelector(sel); if(!el) return;
        const h = ()=>{ state[key] = isNum ? el.value : el.value; persist(); };
        el.addEventListener('input', h);
        el.addEventListener('change', h);
      };
      bind('#sp-edu','edu'); bind('#sp-retrain','retrain');
      bind('#sp-retrainH','retrainH',true); bind('#sp-years','years',true);
      bind('#sp-underLic','underLic'); bind('#sp-nokPassed','nokPassed');
      bind('#sp-views','views',true); bind('#sp-headcount','headcount',true);

      // профпереподготовка вкл/выкл поле часов
      const retr = elForm.querySelector('#sp-retrain');
      const retrH = elForm.querySelector('#sp-retrainH');
      if(retr && retrH){
        retr.addEventListener('change', ()=>{ retrH.disabled = retr.value!=='yes'; if(retr.value!=='yes'){ retrH.value=''; state.retrainH=''; persist(); } });
      }

      // переключатель источника
      elForm.querySelectorAll('#sp-source [data-source]').forEach(b=>{
        b.onclick = ()=>{
          state.source = b.dataset.source; persist();
          elForm.querySelectorAll('#sp-source .pill').forEach(p=>p.classList.toggle('active', p.dataset.source===state.source));
          const paper = elForm.querySelector('#sp-paper');
          if(paper) paper.hidden = state.source!=='paper';
          if(state.source==='paper') paintScans();
        };
      });

      // загрузка сканов
      const dz = elForm.querySelector('#sp-dz');
      const inp = elForm.querySelector('#sp-scan');
      if(dz && inp){
        inp.addEventListener('change', e=>addScans(e.target.files));
        ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); dz.classList.add('drag'); }));
        ['dragleave','dragend','drop'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); if(ev!=='drop') dz.classList.remove('drag'); }));
        dz.addEventListener('drop', e=>{ dz.classList.remove('drag'); if(e.dataTransfer && e.dataTransfer.files) addScans(e.dataTransfer.files); });
      }

      elForm.querySelector('#sp-run').onclick = run;
      elForm.querySelector('#sp-reset').onclick = reset;
    }

    function addScans(files){
      [...(files||[])].forEach(f=>{
        if(!/^image\//.test(f.type)) return;
        let url = '';
        try { url = URL.createObjectURL(f); } catch(e){ url = ''; }
        scans.push({ name: f.name || 'скан', url });
      });
      paintScans();
      ctx.toast(scans.length + ' скан' + plural(scans.length,'','а','ов') + ' прикреплено (локально)', 'info');
    }
    function paintScans(){
      const box = elForm.querySelector('#sp-scan-list'); if(!box) return;
      if(!scans.length){ box.innerHTML = `<div class="muted" style="font-size:12px;grid-column:1/-1">Сканы не прикреплены.</div>`; return; }
      box.innerHTML = scans.map((s,i)=>
        `<div class="card" style="padding:6px;position:relative">
           ${s.url ? `<img src="${esc(s.url)}" alt="${esc(s.name)}" style="width:100%;height:90px;object-fit:cover;border-radius:var(--radius-xs);display:block">`
                   : `<div class="empty" style="height:90px;display:grid;place-items:center;font-size:24px">🖼️</div>`}
           <div class="muted" style="font-size:11px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.name)}">${esc(s.name)}</div>
           <button type="button" class="btn ghost sm" data-scan-x="${i}" aria-label="Убрать скан" title="Убрать" style="position:absolute;top:4px;right:4px;padding:1px 7px">×</button>
         </div>`).join('');
      box.querySelectorAll('[data-scan-x]').forEach(b=>b.onclick=()=>{
        const i = +b.dataset.scanX;
        const s = scans[i];
        if(s && s.url){ try{ URL.revokeObjectURL(s.url); }catch(e){} }
        scans.splice(i,1); paintScans();
      });
    }

    function reset(){
      state.edu='fire'; state.retrain='no'; state.retrainH=''; state.years='';
      state.underLic='no'; state.views=''; state.headcount=''; state.source='etk'; state.nokPassed='no';
      scans.forEach(s=>{ if(s.url){ try{ URL.revokeObjectURL(s.url); }catch(e){} } }); scans=[];
      resultHTML=''; persist();
      renderForm(); elOut.innerHTML='';
    }

    /* ====================================================================
       4. ДВИЖОК ПРАВИЛ (детерминированный). Возвращает {pass, lines[], next[], note}.
       line: { ok | warn | fail, text }
       ==================================================================== */
    function num(v){ const n = parseInt(v,10); return isFinite(n) ? n : null; }

    function eduLabel(edu){ return edu==='fire' ? 'Профильное ПБ' : edu==='techno' ? 'Техносферная безопасность' : 'Иное'; }
    function isProfile(edu){ return edu==='fire' || edu==='techno'; }

    function engine(){
      const t = state.target;
      const R = RULES[t] || {};
      if(t==='mchs_techspecs')   return engineTechspecs(R);
      if(t==='mchs_responsible') return engineResponsible(R);
      if(t==='nok')              return engineNok(R);
      if(t==='nrs')              return engineNrs(R);
      return { pass:false, lines:[{fail:true, text:'Неизвестная цель проверки.'}], next:[], note:'' };
    }

    // нормализуем диапазон видов работ к нужному числу спецов
    function techNeed(R, views){
      const rows = Array.isArray(R.by_scope) ? R.by_scope : [];
      for(const row of rows){
        const m = String(row.views).match(/^(\d+)\s*-\s*(\d+)$/);
        if(m){ if(views>=+m[1] && views<=+m[2]) return row.need; continue; }
        const p = String(row.views).match(/^(\d+)\+$/);
        if(p){ if(views>=+p[1]) return row.need; continue; }
        if(String(+row.views)===String(views)) return row.need;
      }
      // если выше всех диапазонов — берём максимум
      const last = rows[rows.length-1];
      return last ? last.need : 0;
    }

    function engineTechspecs(R){
      const lines=[], next=[]; let fail=false, warn=false;
      const views = num(state.views), have = num(state.headcount);
      if(views==null || views<=0){
        lines.push({warn:true, text:'Не указано число видов работ — нужно для расчёта требуемого штата.'});
        warn=true;
      }
      const need = (views!=null && views>0) ? techNeed(R, views) : null;
      if(need!=null){
        lines.push({ok:true, text:`Для ${views} вид${plural(views,'а','ов','ов')} работ требуется не менее ${need} техспециалист${plural(need,'а','ов','ов')} (по трудовым договорам).`});
        if(have==null){
          lines.push({warn:true, text:'Не указано фактическое число техспециалистов.'});
          warn=true; next.push(`Подтвердить наличие ≥${need} техспециалистов с трудовыми договорами.`);
        } else if(have>=need){
          lines.push({ok:true, text:`Фактически ${have} — требование (≥${need}) выполнено.`});
        } else {
          lines.push({fail:true, text:`Фактически ${have} — не хватает ${need-have} техспециалист${plural(need-have,'а','ов','ов')} до минимума (${need}).`});
          fail=true; next.push(`Добрать ${need-have} техспециалист${plural(need-have,'а','ов','ов')} (подбор и оформление берём на себя).`);
        }
      }
      // образование техспеца — не ниже СПО
      if(state.edu==='other'){
        lines.push({fail:true, text:'Образование техспециалистов — без профессионального; требуется не ниже СПО.'});
        fail=true; next.push('Заменить кандидата или оформить СПО/высшее у техспециалиста.');
      } else {
        lines.push({ok:true, text:`Образование «${eduLabel(state.edu)}» — соответствует (не ниже СПО).`});
      }
      sourceLine(lines, next);
      return { pass: !fail, warn, lines, next, note: R.notes||'' };
    }

    function engineResponsible(R){
      const lines=[], next=[]; let fail=false, warn=false;
      const minH = R.retraining_min_hours||250, minY = R.min_years_experience||5;

      // образование + профпереподготовка
      if(isProfile(state.edu)){
        lines.push({ok:true, text:`Образование «${eduLabel(state.edu)}» — профильное, профпереподготовка не требуется.`});
      } else {
        if(state.retrain==='yes'){
          const h = num(state.retrainH);
          if(h==null){
            lines.push({warn:true, text:`Образование иное; профпереподготовка указана, но не указаны часы (нужно ≥${minH} ч).`});
            warn=true; next.push(`Уточнить число часов профпереподготовки (нужно ≥${minH}).`);
          } else if(h>=minH){
            lines.push({ok:true, text:`Иное образование закрыто профпереподготовкой ${h} ч (≥${minH} ч).`});
            next.push('Диплом о профпереподготовке должен быть внесён в ФИС ФРДО до подачи.');
          } else {
            lines.push({fail:true, text:`Профпереподготовка ${h} ч — недостаточно, нужно ≥${minH} ч.`});
            fail=true; next.push(`Пройти профпереподготовку ≥${minH} ч (программа есть в нашем УЦ).`);
          }
        } else {
          lines.push({fail:true, text:`Образование иное и без профпереподготовки. Нужен профиль ПБ/Техносферная либо профпереподготовка ≥${minH} ч.`});
          fail=true; next.push(`Предложить профпереподготовку ≥${minH} ч — закрывает требование к образованию.`);
        }
      }

      // стаж ≥ minY
      const y = num(state.years);
      if(y==null){
        lines.push({warn:true, text:`Не указан стаж по профилю ПБ (нужно ≥${minY} лет).`}); warn=true;
        next.push(`Подтвердить стаж по профилю ПБ ≥${minY} лет.`);
      } else if(y>=minY){
        lines.push({ok:true, text:`Стаж ${y} лет — выполняет требование ≥${minY} лет.`});
      } else {
        lines.push({fail:true, text:`Стаж ${y} лет — недостаточно, нужно ≥${minY} лет по профилю ПБ.`});
        fail=true; next.push(`Рассмотреть кандидата со стажем ≥${minY} лет (подбор с нашей стороны).`);
      }

      // опыт под лицензией МЧС / Госпожнадзор
      if(R.experience_under_license){
        if(state.underLic==='yes'){
          lines.push({ok:true, text:'Есть опыт под лицензией МЧС / в Госпожнадзоре — профильный стаж зачтётся корректно.'});
        } else {
          lines.push({warn:true, text:'Нет подтверждённого опыта под лицензией МЧС / в Госпожнадзоре — стаж по ПБ могут зачесть не полностью.'});
          warn=true; next.push('Подготовить документы, подтверждающие профильный стаж (трудовая, должностные обязанности).');
        }
      }

      // один лицензиат — информативно (нет поля занятости в этой форме)
      if(R.one_per_licensee){
        lines.push({warn:true, text:'Ответственным за ПБ можно быть только у одного лицензиата — проверьте, что специалист не оформлен у другого.'});
      }
      sourceLine(lines, next);
      return { pass: !fail, warn, lines, next, note: R.notes||'' };
    }

    function engineNok(R){
      const lines=[], next=[]; let fail=false, warn=false;
      const req = R.requires || {};
      const accept = req.diploma_specialty || [];
      const minY = req.min_years!=null ? req.min_years : 3;

      // диплом по профилю
      if(isProfile(state.edu)){
        lines.push({ok:true, text:`Диплом «${eduLabel(state.edu)}» соответствует профстандарту${accept.length?` (${accept.join(', ')})`:''}.`});
      } else if(state.retrain==='yes'){
        lines.push({warn:true, text:'Базовый диплом непрофильный, но есть профпереподготовка — соответствие профстандарту уточняется в ЦОК.'});
        warn=true; next.push('Сверить программу профпереподготовки с требованиями профстандарта ЦОК.');
      } else {
        lines.push({fail:true, text:`Диплом непрофильный и без профпереподготовки — не соответствует профстандарту${accept.length?` (нужен ${accept.join(' / ')})`:''}.`});
        fail=true; next.push('Подобрать профстандарт под квалификацию либо пройти профпереподготовку.');
      }

      // стаж
      const y = num(state.years);
      if(y==null){
        lines.push({warn:true, text:`Не указан стаж по профилю (профстандарт обычно требует ≥${minY} лет).`}); warn=true;
      } else if(y>=minY){
        lines.push({ok:true, text:`Стаж ${y} лет — соответствует требованию профстандарта (≥${minY} лет).`});
      } else {
        lines.push({fail:true, text:`Стаж ${y} лет — меньше требуемого по профстандарту (≥${minY} лет).`});
        fail=true; next.push(`Накопить стаж по профилю ≥${minY} лет или подобрать иной профстандарт.`);
      }

      // экзамен
      if(req.exam){
        lines.push({warn:true, text:'Итоговое подтверждение — сдача экзамена в ЦОК (теория + практика). Результат вносится в реестр НОК.'});
        next.push('Сопровождение к экзамену ЦОК — техспециалист подскажет порядок подготовки.');
      }
      sourceLine(lines, next);
      return { pass: !fail, warn, lines, next, note: R.notes||'' };
    }

    function engineNrs(R){
      const lines=[], next=[]; let fail=false, warn=false;
      const req = R.requires || {};
      const minY = req.min_years!=null ? req.min_years : 10;

      // профильный диплом
      if(isProfile(state.edu)){
        lines.push({ok:true, text:`Диплом «${eduLabel(state.edu)}» — профильный${req.diploma?` (требуется ${req.diploma})`:''}.`});
      } else if(state.retrain==='yes'){
        lines.push({warn:true, text:'Базовый диплом непрофильный; профпереподготовка может учитываться, но для НРС предпочтителен профильный диплом.'});
        warn=true;
      } else {
        lines.push({fail:true, text:`Диплом непрофильный — для НРС требуется ${req.diploma||'профильное высшее/СПО'}.`});
        fail=true; next.push('Подтвердить профильный диплом либо подобрать другого специалиста.');
      }

      // стаж ≥ minY
      const y = num(state.years);
      if(y==null){
        lines.push({warn:true, text:`Не указан стаж по профилю (для НРС нужно ≥${minY} лет).`}); warn=true;
      } else if(y>=minY){
        lines.push({ok:true, text:`Стаж ${y} лет — выполняет требование НРС (≥${minY} лет).`});
      } else {
        lines.push({fail:true, text:`Стаж ${y} лет — недостаточно для НРС (нужно ≥${minY} лет).`});
        fail=true; next.push(`Накопить профильный стаж ≥${minY} лет.`);
      }

      // пройдена НОК
      if(req.nok_passed){
        if(state.nokPassed==='yes'){
          lines.push({ok:true, text:'НОК пройдена — обязательное условие для включения в НРС выполнено.'});
        } else {
          lines.push({fail:true, text:'НОК не пройдена — для включения в НРС необходима пройденная независимая оценка квалификации.'});
          fail=true; next.push('Сначала пройти НОК в ЦОК, затем подавать в НРС.');
        }
      }

      // комплект документов
      const docs = req.docs || [];
      if(docs.length){
        lines.push({warn:true, text:'Потребуется пакет документов: ' + docs.join(', ') + '.'});
        next.push('Собрать комплект документов для подачи в НРС: ' + docs.join(', ') + '.');
      }
      sourceLine(lines, next);
      return { pass: !fail, warn, lines, next, note: R.notes||'' };
    }

    // строка про источник данных (общая)
    function sourceLine(lines, next){
      if(state.source==='paper'){
        lines.push({warn:true, text:'Источник — бумажная/рукописная трудовая: модель не читает, данные внесены вручную. Проверьте корректность стажа и образования по сканам.'});
        if(!scans.length) next.push('Прикрепить фото-сканы трудовой для архива (по желанию).');
      } else {
        lines.push({ok:true, text:'Источник — ЭТК / электронная трудовая: данные читаемы автоматически.'});
      }
    }

    /* ====================================================================
       5. ЗАПУСК ПРОВЕРКИ + ВЕРДИКТ
       ==================================================================== */
    function run(){
      const r = engine();
      resultHTML = verdictCard(r);
      elOut.innerHTML = resultHTML;
      bindOut();
      // опциональное LLM-обоснование (не блокирует детерминированный вердикт)
      if(llmReady()) requestLLM(r);
    }

    function verdictCard(r){
      const status = r.pass ? (r.warn ? 'warn' : 'ok') : 'err';
      const head = r.pass ? (r.warn ? 'ПОДХОДИТ (с условиями)' : 'ПОДХОДИТ') : 'НЕ ПОДХОДИТ';
      const badge = status==='ok' ? `<span class="badge ok dot">✓ ${esc(head)}</span>`
                  : status==='warn' ? `<span class="badge warn dot">▲ ${esc(head)}</span>`
                  : `<span class="badge err dot">✕ ${esc(head)}</span>`;
      const tInfo = TARGETS.find(t=>t.id===state.target);
      const subtitle = (tInfo?tInfo.label:'') + ' · разбор по требованиям';

      const linesHtml = r.lines.map(l=>{
        const ok = l.ok, warn = l.warn, c = ok ? 'var(--ok)' : warn ? 'var(--warn)' : 'var(--err)';
        const mk = ok ? '✓' : warn ? '▲' : '✕';
        return `<div style="display:flex;gap:9px;align-items:flex-start;line-height:1.5">
                  <span style="flex:0 0 auto;color:${c};font-weight:700;margin-top:1px">${mk}</span>
                  <span style="flex:1;color:var(--ink-2)">${esc(l.text)}</span>
                </div>`;
      }).join('');

      const nextHtml = (r.next && r.next.length)
        ? `<div style="font-weight:600;margin:14px 0 6px;font-size:13px">Что нужно</div>
           <ul style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.55">${r.next.map(n=>`<li style="margin:3px 0">${esc(n)}</li>`).join('')}</ul>`
        : '';

      const report = verdictText(r, head);

      return U.card('Вердикт: ' + head, subtitle,
        `<div class="sp-report" data-report="${esc(report)}">
           <div style="margin-bottom:12px">${badge}
             <button class="btn ghost sm" data-sp-copy style="margin-left:8px;padding:2px 9px">Скопировать</button>
           </div>
           <div style="font-weight:600;margin-bottom:6px;font-size:13px">Разбор по требованиям</div>
           <div style="display:grid;gap:6px">${linesHtml}</div>
           ${nextHtml}
           ${r.note ? `<p class="hint" style="margin-top:12px">${esc(r.note)}</p>` : ''}
           <div id="sp-llm" style="margin-top:14px"></div>
         </div>`);
    }

    function verdictText(r, head){
      const tInfo = TARGETS.find(t=>t.id===state.target);
      const L = [];
      L.push('Проверка специалиста — ' + (tInfo?tInfo.label:state.target));
      L.push('Вердикт: ' + head);
      L.push('');
      L.push('Разбор:');
      r.lines.forEach(l=>{ const mk = l.ok?'[+]':l.warn?'[~]':'[-]'; L.push('  '+mk+' '+l.text); });
      if(r.next && r.next.length){ L.push(''); L.push('Что нужно:'); r.next.forEach(n=>L.push('  • '+n)); }
      if(r.note){ L.push(''); L.push('Примечание: '+r.note); }
      return L.join('\n');
    }

    function bindOut(){
      const cp = elOut.querySelector('[data-sp-copy]');
      if(cp) cp.onclick = ()=>{ const b = elOut.querySelector('.sp-report'); if(b) U.copy(b.dataset.report||'', 'Вердикт скопирован ✓'); };
    }

    /* ====================================================================
       6. ОПЦИОНАЛЬНОЕ LLM-ОБОСНОВАНИЕ (текст поверх детерминированного вердикта)
       ==================================================================== */
    function llmConfig(){
      const llm = ctx.store.creds('llm') || {};
      const key = (llm.apiKey || llm.key || '').trim();
      const defEndpoint = ctx.env==='desktop' ? 'http://localhost:1234/v1' : '';
      const endpoint = (llm.endpoint||'').trim() || defEndpoint;
      const model = (llm.model||'').trim();
      const ready = !!key || (ctx.env==='desktop' && !!endpoint);
      return { key, endpoint, model, ready };
    }
    function llmReady(){ return llmConfig().ready; }

    async function requestLLM(r){
      const box = elOut.querySelector('#sp-llm'); if(!box) return;
      box.innerHTML = `<div class="muted" style="font-size:12px">${U.spinner} Готовлю текстовое обоснование…</div>`;
      try{
        const txt = await callLLM(r, llmConfig());
        box.innerHTML = `<div style="font-weight:600;margin-bottom:6px;font-size:13px">Обоснование (LLM)</div>
          <div class="ai-answer" style="white-space:pre-wrap;line-height:1.6;color:var(--ink-2)">${esc(txt)}</div>`;
      }catch(e){
        box.innerHTML = `<p class="hint">LLM-обоснование недоступно: ${esc(e.message||String(e))}. Детерминированный вердикт выше остаётся в силе.</p>`;
      }
    }

    const LLM_SYSTEM =
      'Ты — эксперт по лицензированию МЧС и квалификации специалистов компании Sensor. ' +
      'Тебе дают результат детерминированной проверки специалиста (вердикт + построчный разбор требований). ' +
      'Кратко на русском поясни вердикт простыми словами для менеджера: чем обусловлен итог и что предложить клиенту. ' +
      'Не меняй вердикт и не выдумывай требований сверх приведённых.';

    async function callLLM(r, cfg){
      const tInfo = TARGETS.find(t=>t.id===state.target);
      const url = cfg.endpoint.replace(/\/+$/,'') + '/chat/completions';
      const headers = { 'Content-Type':'application/json' };
      if(cfg.key) headers['Authorization'] = 'Bearer ' + cfg.key;
      const userMsg = 'ЦЕЛЬ: ' + (tInfo?tInfo.label:state.target) + '\n\n' + verdictText(r, r.pass?(r.warn?'ПОДХОДИТ (с условиями)':'ПОДХОДИТ'):'НЕ ПОДХОДИТ') +
        '\n\nПоясни этот вердикт менеджеру кратко (3–6 предложений).';
      const payload = { model: cfg.model || 'local-model', temperature: 0.3, max_tokens: 500,
        messages: [ { role:'system', content: LLM_SYSTEM }, { role:'user', content: userMsg } ] };
      const ac = (typeof AbortController!=='undefined') ? new AbortController() : null;
      const tid = ac ? setTimeout(()=>ac.abort(), 45000) : null;
      let res;
      try { res = await fetch(url, { method:'POST', headers, body: JSON.stringify(payload), signal: ac?ac.signal:undefined }); }
      catch(e){ if(e&&e.name==='AbortError') throw new Error('таймаут (45 с)'); throw new Error('сеть недоступна ('+(e&&e.message||e)+')'); }
      finally { if(tid) clearTimeout(tid); }
      if(!res.ok){ let d=''; try{ const j=await res.json(); d=(j.error&&j.error.message)||''; }catch(_){} throw new Error('HTTP '+res.status+(d?' · '+d:'')); }
      const data = await res.json();
      const txt = data && data.choices && data.choices[0] && ((data.choices[0].message && data.choices[0].message.content) || data.choices[0].text);
      if(!txt) throw new Error('пустой ответ модели');
      return String(txt).trim();
    }

    /* ====================================================================
       7. ШПАРГАЛКА ПРАВИЛ (под выбранную цель)
       ==================================================================== */
    function renderRules(){
      const t = state.target, R = RULES[t] || {};
      const tInfo = TARGETS.find(x=>x.id===t);
      let body = '';
      if(t==='mchs_techspecs'){
        const rows = (R.by_scope||[]).map(s=>`<tr><td>${esc(s.views)} вид${plural(parseInt(s.views,10)||0,'','а','ов')}</td><td class="mono">${esc(s.need)} чел.</td></tr>`).join('');
        body = `<table class="tbl dense"><thead><tr><th>Видов работ</th><th>Минимум техспециалистов</th></tr></thead><tbody>${rows}</tbody></table>`;
      } else if(t==='mchs_responsible'){
        body = `<ul style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.6">
          <li>Образование: ${esc((R.education_accepted||[]).join(' / '))} (СПО/высшее) либо иное + профпереподготовка ≥${esc(R.retraining_min_hours||250)} ч.</li>
          <li>Стаж по профилю ПБ — ≥${esc(R.min_years_experience||5)} лет${R.experience_under_license?'; засчитывается опыт под лицензией МЧС / в Госпожнадзоре':''}.</li>
          ${R.one_per_licensee?'<li>Ответственным можно быть только у одного лицензиата.</li>':''}
        </ul>`;
      } else if(t==='nok' || t==='nrs'){
        const req = R.requires||{};
        const li = [];
        if(req.diploma_specialty) li.push('Диплом по профилю: '+req.diploma_specialty.join(' / ')+'.');
        if(req.diploma) li.push('Диплом: '+req.diploma+'.');
        if(req.min_years!=null) li.push('Стаж по профилю — ≥'+req.min_years+' лет.');
        if(req.nok_passed) li.push('Обязательна пройденная НОК.');
        if(req.exam) li.push('Сдача экзамена в ЦОК (теория + практика).');
        if(req.docs) li.push('Документы: '+req.docs.join(', ')+'.');
        body = `<ul style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.6">${li.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
      }
      elRules.innerHTML = U.card('Правила квалификации — ' + (tInfo?tInfo.label:''),
        R.notes || 'Опорные требования к специалисту по выбранной цели.', body);
    }

    /* ---------- утилиты ---------- */
    function plural(n, one, few, many){
      const n10=n%10, n100=n%100;
      if(n10===1 && n100!==11) return one;
      if(n10>=2 && n10<=4 && !(n100>=12 && n100<=14)) return few;
      return many;
    }

    // очистка object-url'ов при размонтировании
    this.unmount = function(){ scans.forEach(s=>{ if(s.url){ try{ URL.revokeObjectURL(s.url); }catch(e){} } }); };
  }
});

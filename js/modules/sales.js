/* Модуль «Продажи» — интерактивные скрипты по шагам (прогресс с чек-боксами),
   живой поиск по банку возражений с подсветкой, 21 приём дожима, AI-ассистент
   (OpenAI-совместимый эндпоинт из ctx.store.creds('llm'); desktop-дефолт
   http://localhost:1234/v1; мок из банка знаний при отсутствии ключей) и
   проверка специалиста (Блок 7) с подробным вердиктом и правилами МЧС/НОК.

   Контракт сохранён: id='sales', dept='Продажи', order=40.
   Данные читаются из ctx.data (js/data/content.js): scripts / objections / products.
   Совместимость форматов: понимаем и .stages[{name,say,checks}], и старый
   .steps[{n,name,body}]; и objections={bank:[{cat,responses}],dojim}, и старый
   массив [{group,items}] + отдельный closers[]. Встроенный фолбэк — на случай
   автономного запуска модуля без content.js. */

/* ---------- встроенный фолбэк сид-данных (не затирает реальные) ---------- */
(function(){
  window.SEED = window.SEED || {};

  if(!window.SEED.scripts){
    window.SEED.scripts = {
      mchs: {
        id:'mchs', title:'Лицензия МЧС',
        subtitle:'Монтаж / ТО / ремонт систем пожарной безопасности',
        intro:[
          'Не перебиваем, говорим позитивно (клиент должен «слышать улыбку»).',
          'Держим инициативу, не скатываемся в «вопрос-ответ».',
          'Грамотная речь: «извините» (не «извиняюсь»), «срЕдства» (не «средствА»).'
        ],
        stages:[
          { name:'1. Представиться', say:'Уточняем, как обращаться, и должность — чтобы понять, ЛПР или нет.',
            checks:['Узнал, как обращаться к клиенту','Уточнил должность (ЛПР / ЛВР)'] },
          { name:'2. Программирование', say:'«Я задам пару вопросов, чтобы предложение подходило под вашу ситуацию, хорошо?»',
            checks:['Получил согласие на вопросы','Задал рамку диалога'] },
          { name:'3. Выявление потребности', say:'Для чего нужна лицензия? Чем занимаетесь? До какого срока? Помимо монтажа — проектирование (допродажа АТТПР)?',
            checks:['Понял цель получения лицензии','Уточнил срок','Спросил про смежные направления','Выявил ЛПР/ЛВР','Уточнил: организация или ИП, штат, регион'] },
          { name:'4. Примеры работы в регионе', say:'«Постоянно работаем по вашему региону, знаем особенности». Офис — м. Румянцево.',
            checks:['Привёл пример работы в регионе','Упомянул офис (м. Румянцево)'] },
          { name:'5. Помещение', say:'Юр.адрес — только нежилое с ремонтом (>10 м²). Для п.10 — промзона, ≥20 м².',
            checks:['Уточнил тип помещения','Проверил площадь','Подтвердил доступ на момент проверки'] },
          { name:'6. Виды работ (продаём 1–9)', say:'«По цене разницы нет, а деятельность шире». «Под тендер нужны все виды».',
            checks:['Предложил полный пакет 1–9','Объяснил риск «доплаты дважды»','Привязал к тендерам'] },
          { name:'7. Специалисты', say:'4 спеца на техдолжности (СПО/высшее). Ответственный за ПБ: профильное образование, стаж ≥5 лет.',
            checks:['Уточнил наличие техспециалистов','Проверил ответственного за ПБ','Предложил повышение квалификации'] },
          { name:'8. Презентация', say:'Работаем по договору, предмет — лицензия (не юруслуги). Выездная проверка, приедет наш специалист.',
            checks:['Объяснил предмет договора','Рассказал про выездную проверку'] },
          { name:'9. Сроки', say:'До 15 рабочих дней. «Запускаем завтра → к … числу получите».',
            checks:['Назвал срок (до 15 раб. дней)','Привязал к конкретной дате'] },
          { name:'10–13. Предзакрытие и стоимость', say:'«Остались вопросы?» Резюме ситуации. «… ₽ + госпошлина 7500 ₽».',
            checks:['Снял оставшиеся вопросы','Сделал резюме','Озвучил стоимость + госпошлину 7500 ₽'] },
          { name:'14–15. Закрытие и возражения', say:'«Когда готовы начать?» Техника: Присоединение → Вопрос → Аргументация → Закрытие. НЕ «над чем подумать?».',
            checks:['Задал закрывающий вопрос','Отработал возражение по технике','Не использовал «над чем подумать?»'] },
          { name:'Завершение', say:'«Жду карточку компании и документы». При «подумаю» — назначил касание (дату предложил сам).',
            checks:['Запросил карточку и документы','Назначил следующее касание'] }
        ]
      },
      attpr: {
        id:'attpr', title:'Аттестация проектировщика (АТТПР)',
        subtitle:'Аттестация проектировщика МЧС',
        intro:[
          'Не перебиваем клиента, говорим позитивно (слышно улыбку при приветствии).',
          'Сами управляем диалогом, держим инициативу.',
          'Грамотная речь: без уменьшительно-ласкательных; «извините», «срЕдства».'
        ],
        stages:[
          { name:'1. Представиться', say:'Уточнить, как обращаться, и должность (понять, ЛПР или нет).',
            checks:['Узнал, как обращаться','Уточнил должность (ЛПР?)'] },
          { name:'2. Программирование', say:'«Я задам пару вопросов, сформируем предложение под вас, дальше договоримся, хорошо?»',
            checks:['Получил согласие на вопросы','Озвучил рамку диалога'] },
          { name:'3. Квалификация — потребность и боли', say:'Кого аттестуем? Для чего? Почему сейчас? Как срочно? Сами пробовали сдать тест?',
            checks:['Кого аттестуем — себя или сотрудника','Выявил ЛПР','Понял цель и срочность','Спросил про самостоятельную сдачу'] },
          { name:'4. Квалификация специалиста', say:'Образование не ниже СПО (или профиль ПБ). Регион прописки определяет ГУ МЧС.',
            checks:['Уточнил образование (не ниже СПО)','Уточнил регион прописки'] },
          { name:'6. Примеры работы в регионе', say:'«По вашему региону постоянно работаем». Офис: м. Румянцево; экзамен можно сдать у нас.',
            checks:['Привёл пример работы в регионе','Предложил сдачу экзамена в офисе'] },
          { name:'7. Как проходит работа', say:'Договор, предмет — внесение в реестр МЧС. Профпереподготовка (если нужно) → аттестация.',
            checks:['Объяснил предмет договора','Рассказал про профпереподготовку','Объяснил сопровождение на экзамене'] },
          { name:'Выгода', say:'Аттестация → право выполнять проектные работы и зарабатывать. Привязать к боли клиента.',
            checks:['Связал аттестацию с заработком','Привязал к конкретной боли / контракту'] },
          { name:'8. Сроки', say:'До 10 рабочих дней. «Запускаем завтра → к … числу аттестация будет пройдена».',
            checks:['Назвал срок (до 10 раб. дней)','Привязал к конкретной дате'] },
          { name:'9. Стоимость + предзакрытие', say:'«Как вам предложение?» «Стоимость … ₽. Вам удобнее у нас в офисе или у себя?»',
            checks:['Снял вопросы','Озвучил стоимость','Задал альтернативный вопрос'] },
          { name:'10. Закрытие / возражения', say:'«Готовы начать?» «Дорого»: юрлицам — разбивка на 2; физлицам — рассрочка. Техника 4 шагов.',
            checks:['Задал закрывающий вопрос','Отработал «Дорого» по сегменту','Применил технику 4 шагов'] },
          { name:'Завершение контакта', say:'«Жду карточку компании и документы на специалиста». При «подумаю» — назначил касание.',
            checks:['Запросил карточку и документы','Назначил следующее касание'] }
        ]
      }
    };
  }

  if(!window.SEED.objections){
    window.SEED.objections = {
      technique:'Присоединение → Вопрос на раскрытие → Аргументация → Закрывающий вопрос',
      source:'Банк возражений.md (онбординг Sensor)',
      bank:[
        { cat:'Дорого', responses:[
          'Предлагаю сравнить не только цену.',
          'Цена — единственное, что останавливает?',
          'Если бы было дорого — у нас бы не брали 8 лет / не было бы тысяч клиентов.',
          'Это не у нас дорого — вы сравниваете с другим уровнем качества и сервиса.' ] },
        { cat:'Нет бюджета / нет денег', responses:[
          'С нашим продуктом деньги появятся.',
          'Проработаем заранее, появятся деньги — всё уже готово.',
          'Это не нехватка денег, а вопрос приоритетов.' ] },
        { cat:'Решает директор', responses:[
          'Если с директором договоримся — вы согласны?',
          'Решает он, но работать и отвечать вам, спросит с вас.',
          'По каким критериям он выбирает? Сделаем предложение, от которого не откажется.' ] },
        { cat:'Пока нет заказов', responses:[
          'Появятся заказы — у вас уже будет лицензия/аттестация.',
          'С лицензией/аттестацией заказы будут всегда.' ] },
        { cat:'Отправляйте всё на почту', responses:[
          '10 минут на просмотр? Давайте я за эти 10 минут всё расскажу.',
          'Письмо не ответит на вопросы, а я отвечу.',
          '«На почту» обычно говорят, чтобы отделаться. Какие сомнения остались?' ] },
        { cat:'Я сам вам перезвоню', responses:[
          'Когда так говорят — значит не заинтересовались. Позвольте заинтересую…',
          'В нашей компании менеджер перезванивает первым. Когда удобно?' ] },
        { cat:'Я подумаю', responses:[
          'Подумаю — вижу сомнения, давайте развею; есть супер-бонус при решении сейчас.',
          'Самое интересное ещё не обсуждали. Что могло бы заинтересовать?' ] },
        { cat:'Конкуренты и текущие поставщики', responses:[
          '«Все одинаково» — одинаковы только названия услуг, содержание разное.',
          '«Работаем с другими» — для вашего уровня нормально иметь несколько поставщиков, давайте сравним.',
          '«Был негативный опыт» — что произошло? Возможно, исполнители были недобросовестные.' ] }
      ],
      dojim:[
        'Заканчиваются специалисты.','Заканчивается оборудование.','Инспектор уходит в отпуск.',
        'Стоимость повышается со следующего месяца/недели.','Звонок из документооборота: всё готово, осталась платёжка.',
        'Звонок от «контроля качества»: почему затягивается сделка.','Готовые документы другой компании из региона — подаём вместе.',
        'Скоро выходит приказ МЧС — не успеем, ждать месяц.','Оплата сейчас, в договор пункт про специалиста.',
        'Не хватает до плана / аванса / зарплаты.','Вопрос в цене → УПК/ISO дополнительно (бонусы).',
        'Менеджер уходит в отпуск — передадут другому.','Думает между нами и конкурентами → судебные практики конкурентов.',
        'Сформирована группа на обучение, следующая через 2 недели.','Обучение идёт подряд, нормативные сроки.',
        'СРО: заседание комитета завтра, следующее через 2 недели.','СРО: оплата сегодня → месяц членских / страховка в подарок.',
        'По МЧС новый безопасник в регионе — будет тщательно проверять.','Конкуренты клиента уже запускаются — успеть, чтобы не упустить контракты.',
        'Сезонность — оплатить сейчас, чтобы успеть к тендерному сезону.','Аванс по счёту — забронировать готовку, зафиксировать цену.'
      ]
    };
  }
})();

SensorApp.register({
  id: 'sales', title: 'Продажи', dept: 'Продажи', order: 40,
  icon: '💬', description: 'Скрипты по шагам, банк возражений, 21 приём дожима, AI-ассистент, проверка специалиста (B7)',
  keywords: ['продажи','скрипт','возражения','дожим','ассистент','llm','специалист','b7','мчс','аттпр','нок'],
  // Быстрые действия палитры: запоминаем вкладку в store И шлём событие — модуль уже
  // смонтирован к моменту run() (палитра дёргает run через setTimeout после навигации),
  // поэтому слушатель внутри mount переключит вкладку немедленно.
  actions: [
    { id:'scripts',    title:'Скрипты продаж по шагам',   hint:'Чек-листы МЧС / АТТПР с прогрессом', keywords:['скрипт','чек-лист','этапы'],
      run:(ctx)=>salesGoTab(ctx,'scripts') },
    { id:'objections', title:'Банк возражений',           hint:'Поиск ответов на возражения',       keywords:['возражение','дорого','директор','почта'],
      run:(ctx)=>salesGoTab(ctx,'objections') },
    { id:'ai',         title:'AI-ассистент продавца',      hint:'Подсказка ответа по ситуации',       keywords:['ai','ассистент','llm','подсказка'],
      run:(ctx)=>salesGoTab(ctx,'ai') },
    { id:'b7',         title:'Проверка специалиста (B7)',   hint:'Проходит ли спец под МЧС / АТТПР',    keywords:['специалист','b7','стаж','образование','нок'],
      run:(ctx)=>salesGoTab(ctx,'b7') },
    { id:'qc',         title:'Контроль звонков',            hint:'Оценка звонка по рубрике (LLM или мок)', keywords:['звонок','контроль','оценка','транскрипт','скоринг','качество','рубрика'],
      run:(ctx)=>salesGoTab(ctx,'qc') }
  ],
  mount(root, ctx){
    const U = ctx.ui, esc = U.escape;
    const D = ctx.data || {};

    /* ---------- нормализация форматов данных (content.js ↔ старый/фолбэк) ---------- */
    const scripts = normScripts(D.scripts || {});
    const OBJ = normObjections(D.objections, D.closers);
    const bank = OBJ.bank;                 // [{cat, responses[]}]
    const dojim = OBJ.dojim;               // [string]
    const technique = OBJ.technique || 'Присоединение → Вопрос на раскрытие → Аргументация → Закрывающий вопрос';
    const products = (D.products && D.products.cards) || [];

    function normScripts(s){
      const out = {};
      Object.keys(s||{}).forEach(k=>{
        const v = s[k] || {};
        let stages = [];
        if(Array.isArray(v.stages)){
          stages = v.stages.map(st=>({
            name: st.name || '',
            say:  st.say || (Array.isArray(st.body)?st.body.join(' '):(st.body||'')),
            checks: Array.isArray(st.checks) ? st.checks
                  : (Array.isArray(st.body) ? st.body.slice() : [])
          }));
        } else if(Array.isArray(v.steps)){            // старый формат {n,name,body[]}
          stages = v.steps.map(st=>({
            name: (st.n!=null? st.n+'. ':'') + (st.name||''),
            say:  Array.isArray(st.body) ? st.body[0] : (st.body||''),
            checks: Array.isArray(st.body) ? st.body.slice() : []
          }));
        }
        out[k] = {
          id: v.id || k,
          title: v.title || k,
          subtitle: v.subtitle || v.sub || '',
          source: v.source || '',
          intro: Array.isArray(v.intro) ? v.intro : [],
          stages
        };
      });
      return out;
    }
    function normObjections(o, closers){
      // вариант 1: объект {technique, source, bank:[{cat,responses}], dojim:[]}
      if(o && !Array.isArray(o) && Array.isArray(o.bank)){
        return {
          technique: o.technique, source: o.source,
          bank: o.bank.map(g=>({ cat:g.cat||g.group||'Прочее', responses:(g.responses||g.items||[]).slice() })),
          dojim: Array.isArray(o.dojim) ? o.dojim.slice() : (Array.isArray(closers)?closers.slice():[])
        };
      }
      // вариант 2: массив [{group,items}] + отдельный closers[]
      if(Array.isArray(o)){
        return {
          bank: o.map(g=>({ cat:g.group||g.cat||'Прочее', responses:(g.items||g.responses||[]).slice() })),
          dojim: Array.isArray(closers) ? closers.slice() : []
        };
      }
      return { bank:[], dojim: Array.isArray(closers)?closers.slice():[] };
    }

    /* ---------- иконки вкладок (инлайн svg, 18×18, currentColor) ---------- */
    const IC = {
      scripts:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
      objections:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
      ai:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.8L18.6 9l-4.7 1.9L12 16l-1.9-5.1L5.4 9l4.7-1.2z"/><path d="M19 14l.9 2.3L22 17l-2.1.8L19 20l-.9-2.2L16 17l2.1-.7z"/></svg>',
      b7:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
      qc:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>'
    };

    const TABS = [
      { id:'scripts',    label:'Скрипты',     ic:IC.scripts },
      { id:'objections', label:'Возражения',  ic:IC.objections },
      { id:'ai',         label:'AI-ассистент',ic:IC.ai },
      { id:'b7',         label:'Проверка специалиста', ic:IC.b7 },
      { id:'qc',         label:'Контроль звонков', ic:IC.qc }
    ];
    let active = ctx.store.get('sales_tab','scripts');
    if(!TABS.some(t=>t.id===active)) active = 'scripts';

    root.innerHTML =
      `<div class="pill-tabs" id="sales-tabs" role="tablist" aria-label="Разделы продаж">` +
        TABS.map(t=>`<button type="button" class="pill${t.id===active?' active':''}" role="tab" aria-selected="${t.id===active}" data-tab="${t.id}"><span class="t-ic" style="display:inline-flex;margin-right:6px;vertical-align:-3px">${t.ic}</span>${esc(t.label)}</button>`).join('') +
      `</div><div id="sales-body"></div>`;

    const body = root.querySelector('#sales-body');
    root.querySelector('#sales-tabs').addEventListener('click', e=>{
      const p = e.target.closest('.pill'); if(!p) return;
      go(p.dataset.tab);
    });

    function go(tab){
      if(!TABS.some(t=>t.id===tab)) return;
      active = tab;
      ctx.store.set('sales_tab', active);
      root.querySelectorAll('#sales-tabs .pill').forEach(x=>{
        const on = x.dataset.tab===active;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', on?'true':'false');
      });
      render();
    }

    // переключение вкладки из командной палитры (action диспатчит событие)
    function onTabEvent(e){ if(e && e.detail) go(e.detail); }
    window.addEventListener('sales:tab', onTabEvent);
    this.unmount = function(){ window.removeEventListener('sales:tab', onTabEvent); };

    function render(){
      if(active==='scripts')    return renderScripts();
      if(active==='objections') return renderObjections();
      if(active==='ai')         return renderAI();
      if(active==='b7')         return renderB7();
      if(active==='qc')         return renderQC();
    }

    /* =====================================================================
       Вкладка «Скрипты» — интерактивный чек-лист с прогрессом
       ===================================================================== */
    let scriptKey = scripts.mchs ? 'mchs' : Object.keys(scripts)[0];

    function progKey(k){ return 'sales_prog_'+k; }
    function loadProg(k){ return ctx.store.get(progKey(k), {}) || {}; }
    function saveProg(k, obj){ ctx.store.set(progKey(k), obj); }
    function cellId(si, ci){ return si+'.'+ci; }

    function scriptStats(k){
      const sc = scripts[k]; if(!sc) return {done:0,total:0,pct:0,stagesDone:0,stagesTotal:0,nextSi:-1};
      const prog = loadProg(k);
      let done=0,total=0,stagesDone=0,stagesTotal=0,nextSi=-1;
      sc.stages.forEach((st,si)=>{
        const stTotal = st.checks.length;
        if(!stTotal) return;
        stagesTotal++;
        let stDone=0;
        st.checks.forEach((_,ci)=>{ total++; if(prog[cellId(si,ci)]){ done++; stDone++; } });
        if(stDone===stTotal) stagesDone++;
        else if(nextSi<0) nextSi = si; // первый незакрытый этап
      });
      return { done, total, pct: total? Math.round(done/total*100):0, stagesDone, stagesTotal, nextSi };
    }

    function renderScripts(){
      const keys = Object.keys(scripts);
      if(!keys.length){ body.innerHTML = U.empty('🗒️','Скрипты не загружены (window.SEED.scripts пуст).'); return; }
      if(!scripts[scriptKey]) scriptKey = keys[0];
      const sc = scripts[scriptKey];
      const st = scriptStats(scriptKey);

      const switcher = keys.map(k=>{
        const s = scriptStats(k);
        const label = (scripts[k].title||k).split('(')[0].trim();
        return `<button class="pill${k===scriptKey?' active':''}" data-sk="${esc(k)}">${esc(label)}${s.total?` <span class="t-count" style="font-variant-numeric:tabular-nums;font-size:11.5px;margin-left:2px">${s.done}/${s.total}</span>`:''}</button>`;
      }).join('');

      const introHtml = sc.intro.length
        ? `<div class="card" style="padding:13px 16px;background:var(--panel-2);border-style:dashed">
             <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;font-weight:600;font-size:13px">
               <span aria-hidden="true">🎧</span><span>Тон и манера разговора</span>
             </div>
             <ul style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.55">${
               sc.intro.map(t=>`<li style="margin:3px 0">${esc(t)}</li>`).join('')
             }</ul>
           </div>` : '';

      const stagesHtml = sc.stages.map((stage, si)=>renderStageCard(stage, si)).join('');

      body.innerHTML =
        U.card(sc.title || 'Скрипт',
          (sc.subtitle||'') + (sc.source?` · ${sc.source}`:''),
          `<div class="pill-tabs" style="margin-bottom:14px">${switcher}</div>` +
          progBlock(st) +
          `<div class="btn-row" style="margin:2px 0 14px">
             <button class="btn sm primary" id="sc-next">${st.nextSi>=0 ? (st.done? '↘ К следующему этапу' : '↘ Начать с этапа 1') : '✓ Все этапы закрыты'}</button>
             <button class="btn sm" id="sc-expand">Развернуть всё</button>
             <button class="btn sm" id="sc-collapse">Свернуть всё</button>
             <button class="btn ghost sm" id="sc-export" title="Скопировать чек-лист с отметками для отчёта">Экспорт ✓</button>
             <button class="btn ghost sm" id="sc-reset" style="margin-left:auto;color:var(--err-d)">Сбросить прогресс</button>
           </div>` +
          introHtml +
          `<div class="grid" id="sc-stages" style="gap:10px;margin-top:${introHtml?'10px':'0'}">${stagesHtml}</div>`);

      // переключение скрипта
      body.querySelectorAll('[data-sk]').forEach(b=>b.onclick=()=>{ scriptKey=b.dataset.sk; renderScripts(); });

      // чек-боксы
      body.querySelectorAll('input[type="checkbox"][data-cell]').forEach(cb=>{
        cb.onchange = ()=>{
          const prog = loadProg(scriptKey);
          if(cb.checked) prog[cb.dataset.cell] = 1; else delete prog[cb.dataset.cell];
          saveProg(scriptKey, prog);
          updateProgressUI();
        };
      });

      // развернуть/свернуть
      body.querySelectorAll('.stage-head').forEach(h=>{
        h.onclick = (e)=>{ if(e.target.closest('button')) return; toggleStage(h.closest('.stage')); };
        h.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleStage(h.closest('.stage')); } };
      });
      body.querySelector('#sc-expand').onclick = ()=>body.querySelectorAll('.stage').forEach(s=>setStage(s,true));
      body.querySelector('#sc-collapse').onclick = ()=>body.querySelectorAll('.stage').forEach(s=>setStage(s,false));
      body.querySelector('#sc-reset').onclick = async ()=>{
        const ok = await U.confirm({ title:'Сбросить прогресс', message:'Снять все отметки по скрипту «'+(sc.title||scriptKey)+'»?', ok:'Сбросить', danger:true });
        if(!ok) return;
        saveProg(scriptKey, {});
        renderScripts();
        ctx.toast('Прогресс сброшен','info');
      };

      // перейти к первому незакрытому этапу: развернуть, прокрутить, подсветить
      body.querySelector('#sc-next').onclick = ()=>{
        const s = scriptStats(scriptKey);
        if(s.nextSi<0){ ctx.toast('Все этапы скрипта закрыты ✓','ok'); return; }
        focusStage(s.nextSi);
      };

      // экспорт чек-листа с отметками — для отчёта/CRM
      body.querySelector('#sc-export').onclick = ()=>{
        U.copy(exportChecklist(scriptKey), 'Чек-лист скопирован ✓');
      };

      // копирование реплики
      body.querySelectorAll('[data-say]').forEach(b=>b.onclick=()=>U.copy(b.dataset.say, 'Реплика скопирована ✓'));
    }

    // статус этапа: 'done' все отметки сняты-выполнены, 'active' часть, 'todo' пусто
    function stageState(prog, stage, si){
      const total = stage.checks.length;
      const done = stage.checks.reduce((a,_,ci)=> a + (prog[cellId(si,ci)]?1:0), 0);
      const st = total===0 ? 'todo' : (done===total ? 'done' : (done>0 ? 'active' : 'todo'));
      return { total, done, state:st };
    }
    // цветной маркер слева от заголовка этапа
    function stageDot(state){
      const c = state==='done' ? 'var(--ok)' : (state==='active' ? 'var(--accent)' : 'var(--line-3)');
      const fill = state==='todo' ? 'transparent' : c;
      const mark = state==='done' ? '✓' : '';
      return `<span class="stage-dot" aria-hidden="true" style="flex:0 0 auto;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;
        border:2px solid ${c};background:${fill};color:#fff;font-size:10px;font-weight:800;line-height:1;transition:background var(--t) var(--ease),border-color var(--t) var(--ease)">${mark}</span>`;
    }

    function renderStageCard(stage, si){
      const prog = loadProg(scriptKey);
      const { total, done, state } = stageState(prog, stage, si);
      const complete = state==='done';
      const sayCount = stage.say ? 1 : 0;
      const checksHtml = stage.checks.map((c,ci)=>{
        const id = 'cb_'+scriptKey+'_'+si+'_'+ci;
        const on = !!prog[cellId(si,ci)];
        return `<label class="sc-check" for="${id}" style="display:flex;gap:9px;align-items:flex-start;padding:7px 8px;border-radius:var(--radius-xs);cursor:pointer;transition:background var(--t-fast) var(--ease)">
                  <input id="${id}" type="checkbox" data-cell="${cellId(si,ci)}" ${on?'checked':''} style="margin-top:2px;flex:0 0 auto">
                  <span style="color:var(--ink-2);line-height:1.5${on?';text-decoration:line-through;opacity:.6':''}">${esc(c)}</span>
                </label>`;
      }).join('');
      // акцент-полоса слева через box-shadow inset (без новых css-классов)
      const edge = complete ? 'var(--ok)' : (state==='active' ? 'var(--accent)' : 'transparent');
      return `<div class="card stage" data-si="${si}" data-state="${state}" style="padding:0;overflow:hidden;box-shadow:inset 3px 0 0 ${edge},var(--shadow-xs);transition:box-shadow var(--t) var(--ease),border-color var(--t) var(--ease)">
                <div class="stage-head" role="button" tabindex="0" aria-expanded="false"
                     title="${total?('Отметок: '+done+' из '+total):'Без чек-листа'}${sayCount?' · есть реплика':''}"
                     style="display:flex;align-items:center;gap:11px;padding:12px 15px;cursor:pointer;-webkit-user-select:none;user-select:none">
                  ${stageDot(state)}
                  <strong style="flex:1;font-size:13.5px;line-height:1.35">${esc(stage.name)}</strong>
                  <span class="badge${complete?' ok':(state==='active'?' info':'')}" style="flex:0 0 auto;font-variant-numeric:tabular-nums">${total?done+' / '+total:'—'}</span>
                  <span class="stage-caret muted" aria-hidden="true" style="transition:transform var(--t) var(--ease);flex:0 0 auto;font-size:12px">▸</span>
                </div>
                <div class="stage-body" style="display:none;padding:0 15px 13px">
                  ${stage.say ? `<div style="display:flex;gap:8px;align-items:flex-start;background:var(--accent-soft);border-radius:var(--radius-s);padding:9px 11px;margin-bottom:10px">
                      <span aria-hidden="true" style="flex:0 0 auto">💬</span>
                      <div style="flex:1;color:var(--accent-dd);line-height:1.5">${esc(stage.say)}</div>
                      <button class="btn ghost sm" data-say="${esc(stage.say)}" title="Скопировать реплику" aria-label="Скопировать реплику" style="flex:0 0 auto;padding:3px 7px">копировать</button>
                    </div>` : ''}
                  ${total ? `<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:2px 0 4px">Что отметить</div>${checksHtml}` : ''}
                </div>
              </div>`;
    }

    // развернуть этап si, прокрутить к нему и кратко подсветить
    function focusStage(si){
      const card = body.querySelector('.stage[data-si="'+si+'"]');
      if(!card) return;
      setStage(card, true);
      if(card.scrollIntoView) card.scrollIntoView({ block:'center', behavior:'smooth' });
      card.style.transition = 'box-shadow var(--t) var(--ease)';
      const prev = card.style.boxShadow;
      card.style.boxShadow = 'var(--ring-strong),var(--shadow-s)';
      setTimeout(()=>{ card.style.boxShadow = prev; }, 900);
    }

    // текстовый экспорт чек-листа с отметками (для CRM/отчёта)
    function exportChecklist(k){
      const sc = scripts[k]; if(!sc) return '';
      const prog = loadProg(k);
      const s = scriptStats(k);
      const L = [];
      L.push('Скрипт: ' + (sc.title||k) + (sc.subtitle?(' — '+sc.subtitle):''));
      L.push('Прогресс: ' + s.done + ' / ' + s.total + ' отметок · ' + s.pct + '% · этапов закрыто ' + s.stagesDone + ' из ' + s.stagesTotal);
      L.push('');
      sc.stages.forEach((stage,si)=>{
        const stt = stageState(prog, stage, si);
        const mk = stt.state==='done' ? '[x]' : (stt.state==='active' ? '[~]' : '[ ]');
        L.push(mk + ' ' + stage.name + (stt.total?(' ('+stt.done+'/'+stt.total+')'):''));
        stage.checks.forEach((c,ci)=>{
          L.push('    ' + (prog[cellId(si,ci)]?'✓':'·') + ' ' + c);
        });
      });
      return L.join('\n');
    }

    function progSubline(st){
      if(!st.total) return 'В этом скрипте нет чек-листа';
      if(st.pct===100) return 'Все ' + st.stagesTotal + ' этап' + plural(st.stagesTotal,'','а','ов') + ' закрыты — скрипт пройден полностью';
      const stagesPart = 'Этапов закрыто: ' + st.stagesDone + ' из ' + st.stagesTotal;
      const sc = scripts[scriptKey];
      const nextName = (st.nextSi>=0 && sc && sc.stages[st.nextSi]) ? sc.stages[st.nextSi].name : '';
      return stagesPart + (nextName ? (' · далее — «' + nextName + '»') : '');
    }
    function progBlock(st){
      const accent = st.pct===100 ? 'var(--ok)' : 'var(--accent)';
      return `<div id="sc-progress" style="margin-bottom:14px">
                <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:7px">
                  <span class="muted" style="font-size:12px;line-height:1.4" id="sc-subline">${esc(progSubline(st))}</span>
                  <strong id="sc-pct" style="font-variant-numeric:tabular-nums;font-size:15px;letter-spacing:-.01em;white-space:nowrap;color:${st.pct===100?'var(--ok-d)':'var(--ink)'}">${st.done} / ${st.total} · ${st.pct}%</strong>
                </div>
                <div class="bar"><span id="sc-bar" style="width:${st.pct}%;background:${accent}"></span></div>
              </div>`;
    }
    function updateProgressUI(){
      const st = scriptStats(scriptKey);
      const pct = body.querySelector('#sc-pct'), bar = body.querySelector('#sc-bar');
      if(pct){ pct.textContent = `${st.done} / ${st.total} · ${st.pct}%`; pct.style.color = st.pct===100?'var(--ok-d)':'var(--ink)'; }
      if(bar){ bar.style.width = st.pct+'%'; bar.style.background = st.pct===100?'var(--ok)':'var(--accent)'; }
      const sub = body.querySelector('#sc-subline');
      if(sub) sub.textContent = progSubline(st);
      // текст кнопки «к следующему этапу» в зависимости от прогресса
      const nextBtn = body.querySelector('#sc-next');
      if(nextBtn){
        nextBtn.textContent = st.nextSi>=0 ? (st.done? '↘ К следующему этапу' : '↘ Начать с этапа 1') : '✓ Все этапы закрыты';
        nextBtn.classList.toggle('primary', st.nextSi>=0);
      }
      // обновить бейджи/маркеры/edge на каждой карточке этапа + зачёркивание строк
      const prog = loadProg(scriptKey);
      body.querySelectorAll('.stage').forEach(card=>{
        const si = +card.dataset.si; const stage = scripts[scriptKey].stages[si];
        const { total, done, state } = stageState(prog, stage, si);
        const complete = state==='done';
        card.dataset.state = state;
        // edge-полоса слева
        const edge = complete ? 'var(--ok)' : (state==='active' ? 'var(--accent)' : 'transparent');
        card.style.boxShadow = 'inset 3px 0 0 '+edge+',var(--shadow-xs)';
        // цветной маркер
        const dot = card.querySelector('.stage-dot');
        if(dot){
          const c = complete ? 'var(--ok)' : (state==='active' ? 'var(--accent)' : 'var(--line-3)');
          dot.style.borderColor = c;
          dot.style.background = state==='todo' ? 'transparent' : c;
          dot.textContent = complete ? '✓' : '';
        }
        const badge = card.querySelector('.badge');
        if(badge){
          badge.classList.toggle('ok', complete);
          badge.classList.toggle('info', state==='active');
          badge.textContent = (total?done+' / '+total:'—');
        }
        card.querySelectorAll('.sc-check').forEach(lbl=>{
          const cb = lbl.querySelector('input'); const span = lbl.querySelector('span');
          if(span){ span.style.textDecoration = cb.checked?'line-through':''; span.style.opacity = cb.checked?'.6':''; }
        });
      });
      // обновить счётчики на переключателе скриптов
      body.querySelectorAll('[data-sk]').forEach(b=>{
        const s = scriptStats(b.dataset.sk); const c = b.querySelector('.t-count');
        if(c) c.textContent = s.done+'/'+s.total;
      });
    }
    function setStage(card, open){
      const bodyEl = card.querySelector('.stage-body');
      const caret = card.querySelector('.stage-caret');
      const head = card.querySelector('.stage-head');
      bodyEl.style.display = open?'block':'none';
      if(caret) caret.style.transform = open?'rotate(90deg)':'';
      if(head) head.setAttribute('aria-expanded', open?'true':'false');
    }
    function toggleStage(card){ setStage(card, card.querySelector('.stage-body').style.display==='none'); }

    /* =====================================================================
       Вкладка «Возражения» — живой поиск с подсветкой + 21 приём дожима
       ===================================================================== */
    function renderObjections(){
      const total = bank.reduce((a,g)=>a+g.responses.length,0);
      body.innerHTML =
        U.card('Банк возражений',
          'Техника: ' + technique + '. Не спрашиваем «над чём подумать?» · техника «Искренность».',
          `<div class="field" style="margin-bottom:10px">
             <div style="position:relative">
               <input id="obj-q" placeholder="Поиск по возражению или ответу… (напр. «дорого», «директор», «почта»)" autocomplete="off" spellcheck="false" style="padding-right:34px">
               <button id="obj-x" type="button" aria-label="Очистить" title="Очистить" style="display:none;position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;padding:2px 6px">×</button>
             </div>
           </div>
           <div id="obj-chips" class="pill-tabs" style="margin-bottom:4px"></div>
           <div id="obj-count" class="muted" style="font-size:12px;margin:2px 0 8px">${total} готовых ответов в ${bank.length} категориях</div>
           <div id="obj-list"></div>`) +
        U.card('Как подтолкнуть к оплате — ' + dojim.length + ' приём' + plural(dojim.length,'','а','ов') + ' дожима',
          'Применять аккуратно и правдиво, под конкретную ситуацию клиента. Клик — скопировать формулировку.',
          `<div id="dojim-list" style="display:grid;gap:6px"></div>`);

      const listEl = body.querySelector('#obj-list');
      const chipsEl = body.querySelector('#obj-chips');
      const countEl = body.querySelector('#obj-count');
      const q = body.querySelector('#obj-q');
      const x = body.querySelector('#obj-x');
      let catFilter = null;

      // чипы-категории
      chipsEl.innerHTML =
        `<button type="button" class="pill active" data-cat="">Все</button>` +
        bank.map((g,i)=>`<button type="button" class="pill" data-cat="${i}">${esc(g.cat)}</button>`).join('');
      chipsEl.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{
        catFilter = b.dataset.cat==='' ? null : +b.dataset.cat;
        chipsEl.querySelectorAll('.pill').forEach(p=>p.classList.toggle('active', p===b));
        paint();
      });

      const paint = ()=>{
        const term = (q.value||'').trim();
        const lc = term.toLowerCase();
        x.style.display = term ? '' : 'none';
        let groups = bank.map((g,i)=>({i,g})).filter(o=> catFilter===null || o.i===catFilter);
        let shownResp = 0;
        groups = groups.map(({i,g})=>{
          const catHit = g.cat.toLowerCase().includes(lc);
          const items = lc
            ? g.responses.filter(r=> r.toLowerCase().includes(lc) || catHit)
            : g.responses;
          shownResp += items.length;
          return { cat:g.cat, items, catHit };
        }).filter(g=>g.items.length);

        countEl.textContent = term
          ? `Найдено ${shownResp} ответ${plural(shownResp,'','а','ов')} в ${groups.length} категори${plural(groups.length,'и','ях','ях')}`
          : `${bank.reduce((a,g)=>a+g.responses.length,0)} готовых ответов в ${bank.length} категориях`;

        if(!groups.length){
          listEl.innerHTML = U.empty('🔍','Ничего не найдено по «'+esc(term)+'».',
            `<button class="btn sm" id="obj-clear2">Сбросить поиск</button>`);
          const c2 = listEl.querySelector('#obj-clear2'); if(c2) c2.onclick = ()=>{ q.value=''; catFilter=null; chipsEl.querySelectorAll('.pill').forEach((p,idx)=>p.classList.toggle('active',idx===0)); paint(); };
          return;
        }
        listEl.innerHTML = groups.map(g=>
          `<div style="margin:14px 0 5px"><span class="badge err">${highlight(g.cat, lc)}</span></div>
           <div style="display:grid;gap:5px">${
             g.items.map(it=>
               `<div class="obj-row" style="display:flex;gap:9px;align-items:flex-start;padding:6px 9px;border:1px solid var(--line);border-radius:var(--radius-xs);transition:border-color var(--t-fast) var(--ease),background var(--t-fast) var(--ease)">
                  <span style="flex:0 0 auto;color:var(--accent);margin-top:1px">•</span>
                  <span style="flex:1;color:var(--ink-2);line-height:1.5">${highlight(it, lc)}</span>
                  <button class="btn ghost sm" data-copy="${esc(it)}" title="Скопировать" aria-label="Скопировать ответ" style="flex:0 0 auto;padding:3px 7px">copy</button>
                </div>`).join('')
           }</div>`).join('');
        listEl.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>U.copy(b.dataset.copy,'Ответ скопирован ✓'));
      };

      const deb = U.debounce(paint, 90);
      q.addEventListener('input', deb);
      x.onclick = ()=>{ q.value=''; deb.cancel(); paint(); q.focus(); };
      paint();

      // дожим
      const dl = body.querySelector('#dojim-list');
      dl.innerHTML = dojim.map((c,i)=>
        `<div class="obj-row" data-copy="${esc(c)}" role="button" tabindex="0" title="Скопировать" style="display:flex;gap:10px;align-items:flex-start;padding:8px 11px;border:1px solid var(--line);border-radius:var(--radius-xs);cursor:pointer;transition:border-color var(--t-fast) var(--ease),background var(--t-fast) var(--ease)">
           <span class="mono" style="flex:0 0 26px;color:var(--accent);font-weight:650;text-align:right">${i+1}.</span>
           <span style="flex:1;color:var(--ink-2);line-height:1.5">${esc(c)}</span>
         </div>`).join('') || U.empty('🗂️','Приёмы дожима не загружены.');
      dl.querySelectorAll('[data-copy]').forEach(b=>{
        b.onclick = ()=>U.copy(b.dataset.copy,'Приём скопирован ✓');
        b.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); U.copy(b.dataset.copy,'Приём скопирован ✓'); } };
      });
    }

    function highlight(text, lc){
      if(!lc) return esc(text);
      const i = text.toLowerCase().indexOf(lc);
      if(i<0) return esc(text);
      return esc(text.slice(0,i)) +
        `<mark style="background:var(--accent-soft-2);color:var(--accent-dd);border-radius:3px;padding:0 1px">` +
        esc(text.slice(i,i+lc.length)) + `</mark>` + esc(text.slice(i+lc.length));
    }
    function plural(n, one, few, many){
      const n10=n%10, n100=n%100;
      if(n10===1 && n100!==11) return one;
      if(n10>=2 && n10<=4 && !(n100>=12 && n100<=14)) return few;
      return many;
    }

    /* =====================================================================
       Вкладка «AI-ассистент» — OpenAI-совместимый эндпоинт + мок из банка
       ===================================================================== */
    function llmConfig(){
      const llm = ctx.store.creds('llm') || {};
      const key = (llm.apiKey || llm.key || '').trim();        // settings.js пишет apiKey
      const defEndpoint = ctx.env==='desktop' ? 'http://localhost:1234/v1' : '';
      const endpoint = (llm.endpoint||'').trim() || defEndpoint;
      const model = (llm.model||'').trim();
      // доступно: есть ключ ИЛИ desktop с локальным эндпоинтом (LM Studio и т.п.)
      const ready = !!key || (ctx.env==='desktop' && !!endpoint);
      return { key, endpoint, model, ready };
    }

    const PRESETS = [
      'Клиент: «Дорого, у конкурентов дешевле» — что ответить по лицензии МЧС?',
      'Клиент: «Решение принимает директор» — как продвинуть сделку?',
      'Клиент: «Отправьте всё на почту» — удержать в разговоре.',
      'Как подвести к оплате АТТПР сегодня (приём дожима)?'
    ];

    /* =====================================================================
       RAG-ретривал по window.RAG_INDEX.chunks
       Стратегия:
        (а) если задан LLM-эндпоинт с эмбеддингами (llm.embEndpoint или
            /v1/embeddings от базового endpoint) — эмбеддинг запроса → косинус
            по int8-эмбеддингам чанков (деквантуем emb*meta.quant.scale).
        (б) иначе — лексический BM25 по text чанков (реализован ниже на JS).
       Топ-K (4–6) чанков → если есть LLM /chat — генерим ответ СТРОГО по
       найденным фрагментам с указанием источников; иначе — показываем сами
       фрагменты («из материалов: …»). Всегда есть блок «Источники».
       Если индекс пуст — крайний фолбэк на mockAnswer() (банк возражений).
       ===================================================================== */
    const TOP_K = 5;

    function ragIndex(){
      const R = window.RAG_INDEX;
      if(R && Array.isArray(R.chunks) && R.chunks.length) return R;
      return null;
    }
    function ragScale(R){
      const q = R && R.meta && R.meta.quant;
      return (q && isFinite(q.scale) && q.scale>0) ? q.scale : 1;
    }

    // конфиг эмбеддингов: embEndpoint из кредов или вывод из базового endpoint
    function embConfig(){
      const llm = ctx.store.creds('llm') || {};
      const key = (llm.apiKey || llm.key || '').trim();
      const explicit = (llm.embEndpoint || llm.embeddingEndpoint || '').trim();
      const base = (llm.endpoint||'').trim() || (ctx.env==='desktop' ? 'http://localhost:1234/v1' : '');
      let url = explicit;
      if(!url && base){
        const b = base.replace(/\/+$/,'');
        url = /\/embeddings$/.test(b) ? b : b + '/embeddings';
      }
      const model = (llm.embModel || llm.embeddingModel || '').trim();
      const R = ragIndex();
      // эмбеддинг-режим доступен, только если есть и индекс, и куда слать запрос
      const ready = !!(R && url && (key || ctx.env==='desktop'));
      return { url, key, model, ready };
    }

    // --- математика косинуса по int8-эмбеддингам (нормированы → cos = dot) ---
    function dotInt8(emb, scale, qvec){
      // emb — int8-массив чанка; qvec — НОРМИРОВАННЫЙ float-вектор запроса.
      let s = 0; const n = Math.min(emb.length, qvec.length);
      for(let i=0;i<n;i++) s += emb[i]*scale*qvec[i];
      return s;
    }
    function normalizeVec(v){
      let n = 0; for(let i=0;i<v.length;i++) n += v[i]*v[i];
      n = Math.sqrt(n) || 1;
      const out = new Array(v.length);
      for(let i=0;i<v.length;i++) out[i] = v[i]/n;
      return out;
    }

    // запрос эмбеддинга к OpenAI-совместимому /embeddings
    async function embedQuery(text, ec){
      const headers = { 'Content-Type':'application/json' };
      if(ec.key) headers['Authorization'] = 'Bearer ' + ec.key;
      const payload = { input: text };
      if(ec.model) payload.model = ec.model;
      const ac = (typeof AbortController!=='undefined') ? new AbortController() : null;
      const tid = ac ? setTimeout(()=>ac.abort(), 30000) : null;
      let res;
      try {
        res = await fetch(ec.url, { method:'POST', headers, body: JSON.stringify(payload), signal: ac?ac.signal:undefined });
      } catch(e){
        if(e && e.name==='AbortError') throw new Error('таймаут эмбеддинга (30 с)');
        throw new Error('эмбеддинг-эндпоинт недоступен ('+(e&&e.message||e)+')');
      } finally { if(tid) clearTimeout(tid); }
      if(!res.ok){
        let detail=''; try{ const j=await res.json(); detail=(j.error&&j.error.message)||''; }catch(_){}
        throw new Error('HTTP '+res.status+(detail?' · '+detail:''));
      }
      const data = await res.json();
      const v = data && data.data && data.data[0] && data.data[0].embedding;
      if(!Array.isArray(v) || !v.length) throw new Error('пустой эмбеддинг от модели');
      return v.map(Number);
    }

    // эмбеддинг-ретривал: топ-K чанков по косинусу
    async function retrieveByEmbedding(question, ec){
      const R = ragIndex();
      const scale = ragScale(R);
      const raw = await embedQuery(question, ec);
      const dim = (R.meta && R.meta.dim) || raw.length;
      if(raw.length !== dim) throw new Error('размерность эмбеддинга '+raw.length+' ≠ индекс '+dim);
      const q = normalizeVec(raw);
      return R.chunks
        .map(c=>({ chunk:c, score: dotInt8(c.emb||[], scale, q) }))
        .sort((a,b)=>b.score-a.score)
        .slice(0, TOP_K);
    }

    // --- BM25 / лексический ретривал по text чанков (без ключей) ---
    function ragTokenize(s){
      return String(s||'').toLowerCase().match(/[a-zа-яё0-9]+/gi) || [];
    }
    // лёгкий стеммер: режем русские/латинские окончания для устойчивости поиска
    function ragStem(w){
      if(w.length<=4) return w;
      return w.replace(/(ами|ями|ого|его|ому|ему|ыми|ими|ует|уют|ать|ять|ишь|ете|ёте|ия|ие|ый|ой|ей|ом|ем|ам|ям|ах|ях|ов|ев|ми|ть|ся|и|ы|а|я|о|е|у|ю|й|ь|s|es|ed|ing)$/i, '') || w;
    }
    let _bm25 = null;
    function buildBM25(){
      if(_bm25) return _bm25;
      const R = ragIndex();
      const docs = R.chunks.map(c=>{
        const toks = ragTokenize((c.title?c.title+' ':'')+c.text).map(ragStem);
        const tf = Object.create(null);
        toks.forEach(t=>{ tf[t]=(tf[t]||0)+1; });
        return { tf, len: toks.length };
      });
      const N = docs.length;
      const df = Object.create(null);
      docs.forEach(d=>{ Object.keys(d.tf).forEach(t=>{ df[t]=(df[t]||0)+1; }); });
      const avgdl = docs.reduce((a,d)=>a+d.len,0)/(N||1) || 1;
      const idf = Object.create(null);
      Object.keys(df).forEach(t=>{ idf[t] = Math.log(1 + (N - df[t] + 0.5)/(df[t] + 0.5)); });
      _bm25 = { docs, idf, avgdl, k1:1.5, b:0.75 };
      return _bm25;
    }
    function retrieveByBM25(question){
      const R = ragIndex();
      const m = buildBM25();
      const qTerms = ragTokenize(question).map(ragStem).filter(w=>w.length>=2);
      const uniq = [...new Set(qTerms)];
      const scored = m.docs.map((d,i)=>{
        let s = 0;
        uniq.forEach(t=>{
          const f = d.tf[t]; if(!f) return;
          const idf = m.idf[t] || 0;
          s += idf * (f*(m.k1+1)) / (f + m.k1*(1 - m.b + m.b*d.len/m.avgdl));
        });
        return { chunk: R.chunks[i], score: s };
      });
      return scored.filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0, TOP_K);
    }

    // строка контекста для LLM из найденных чанков (с нумерацией источников)
    function ragContext(hits){
      return hits.map((h,i)=>{
        const c = h.chunk;
        const src = [c.source, c.title].filter(Boolean).join(' · ') || ('фрагмент '+(i+1));
        return '['+(i+1)+'] '+src+'\n'+String(c.text||'').trim();
      }).join('\n\n');
    }
    // компактный заголовок источника
    function ragSourceLabel(c, i){
      return esc([c.source, c.title].filter(Boolean).join(' · ') || ('фрагмент '+(i+1)));
    }

    // блок «Источники» (всегда показываем под ответом)
    function sourcesHTML(hits){
      if(!hits || !hits.length) return '';
      const items = hits.map((h,i)=>{
        const c = h.chunk;
        const sc = isFinite(h.score) ? h.score : null;
        return `<li style="margin:4px 0;line-height:1.5">
                  <span class="mono" style="color:var(--accent);font-weight:650;margin-right:4px">[${i+1}]</span>
                  <span style="color:var(--ink-2)">${ragSourceLabel(c,i)}</span>
                  ${sc!=null?`<span class="muted" style="font-size:11px;margin-left:6px;font-variant-numeric:tabular-nums">${sc.toFixed(3)}</span>`:''}
                </li>`;
      }).join('');
      return `<div style="margin-top:14px">
                <div style="font-weight:600;margin-bottom:6px;font-size:13px">Источники</div>
                <ul style="margin:0;padding-left:4px;list-style:none">${items}</ul>
              </div>`;
    }

    // фрагменты как ответ, когда нет /chat («из материалов: …»)
    function fragmentsAnswerHTML(hits){
      const blocks = hits.map((h,i)=>{
        const c = h.chunk;
        const txt = String(c.text||'').trim();
        const short = txt.length>700 ? txt.slice(0,700).trim()+'…' : txt;
        return `<div style="margin-bottom:12px;padding:10px 13px;border:1px solid var(--line);border-radius:var(--radius-s);background:var(--panel-2)">
                  <div class="muted" style="font-size:11.5px;margin-bottom:5px">
                    <span class="mono" style="color:var(--accent);font-weight:650">[${i+1}]</span> ${ragSourceLabel(c,i)}
                  </div>
                  <div style="white-space:pre-wrap;line-height:1.55;color:var(--ink-2)">${esc(short)}</div>
                </div>`;
      }).join('');
      return `<div class="ai-answer-frag">
                <p style="margin:0 0 10px;color:var(--ink-2)">Из обучающих материалов Sensor по вашему запросу:</p>
                ${blocks}
              </div>`;
    }

    function renderAI(){
      const cfg = llmConfig();
      const R = ragIndex();
      const ec = embConfig();
      const retrievalMode = ec.ready ? 'embeddings' : (R ? 'bm25' : 'none');
      const idxBadge = R
        ? `<span class="badge ${retrievalMode==='embeddings'?'ok':'info'} dot">RAG · ${R.chunks.length} фрагмент${plural(R.chunks.length,'','а','ов')} · ${retrievalMode==='embeddings'?'эмбеддинги':'BM25'}</span>`
        : `<span class="badge warn dot">индекс пуст — мок из банка знаний</span>`;
      const chatBadge = cfg.ready
        ? `<span class="badge ok dot">ответ генерит LLM${cfg.model?' · '+esc(cfg.model):''}</span>`
        : `<span class="badge" title="Подключите LLM в Настройках для генерации связного ответа">ответ = найденные фрагменты</span>`;

      body.innerHTML =
        U.card('AI-ассистент продавца (RAG)',
          'Опишите ситуацию или возражение — ассистент найдёт релевантные фрагменты в обучающих материалах Sensor (конспект продуктов, чек-листы, банк возражений) и' +
          (cfg.ready?' сформулирует ответ строго по ним с указанием источников.':' покажет их как ответ с указанием источников. Подключите LLM в Настройках для связного ответа.'),
          `<div class="btn-row" style="margin-bottom:12px;flex-wrap:wrap">${idxBadge}${chatBadge}
             ${(!cfg.ready) ? `<button class="btn ghost sm" id="ai-cfg" style="margin-left:auto">Настроить LLM →</button>`:''}
           </div>` +
          U.field('Вопрос / реплика клиента',
            `<textarea id="ai-q" rows="4" placeholder="Напр.: Клиент говорит «дорого, у конкурентов дешевле» — что ответить по лицензии МЧС?"></textarea>`) +
          `<div class="pill-tabs" id="ai-presets" style="margin:2px 0 10px">${
             PRESETS.map((p,i)=>`<button type="button" class="pill" data-preset="${i}">${esc(p.length>42?p.slice(0,40)+'…':p)}</button>`).join('')
           }</div>` +
          `<div class="btn-row">
             <button class="btn primary" id="ai-ask">✦ Спросить ассистента</button>
             <button class="btn" id="ai-clear">Очистить</button>
           </div>
           <div id="ai-out" style="margin-top:14px"></div>`);

      const qEl = body.querySelector('#ai-q');
      const out = body.querySelector('#ai-out');
      const cfgBtn = body.querySelector('#ai-cfg');
      if(cfgBtn) cfgBtn.onclick = ()=>ctx.go && ctx.go('settings');
      body.querySelector('#ai-clear').onclick = ()=>{ qEl.value=''; out.innerHTML=''; qEl.focus(); };
      body.querySelector('#ai-ask').onclick = ()=>ask();
      body.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{ qEl.value = PRESETS[+b.dataset.preset]; qEl.focus(); });
      qEl.addEventListener('keydown', e=>{ if((e.metaKey||e.ctrlKey) && e.key==='Enter'){ e.preventDefault(); ask(); } });

      async function ask(){
        const question = (qEl.value||'').trim();
        if(!question){ ctx.toast('Введите вопрос','err'); qEl.focus(); return; }
        const btn = body.querySelector('#ai-ask');
        btn.disabled = true; btn.innerHTML = U.spinner + ' Ищу…';
        out.innerHTML = U.card('Ответ ассистента', 'ретривал по материалам…', U.skeleton({lines:4}));

        // крайний фолбэк: индекс пуст → старый мок из банка знаний
        if(!ragIndex()){
          out.innerHTML = answerCard('Ответ ассистента', 'мок · банк возражений и продуктов Sensor (индекс знаний пуст)', mockAnswer(question));
          btn.disabled = false; btn.innerHTML = '✦ Спросить ассистента';
          return;
        }

        try{
          // 1. ретривал: эмбеддинги (если настроены) → иначе BM25
          let hits, retrievalNote;
          if(ec.ready){
            try{
              hits = await retrieveByEmbedding(question, ec);
              retrievalNote = 'ретривал по эмбеддингам';
            }catch(embErr){
              hits = retrieveByBM25(question);
              retrievalNote = 'BM25 (эмбеддинг недоступен: '+(embErr.message||String(embErr))+')';
              ctx.toast('Эмбеддинг-эндпоинт недоступен — лексический поиск','err');
            }
          } else {
            hits = retrieveByBM25(question);
            retrievalNote = 'лексический BM25';
          }

          // ничего не нашли в индексе → крайний фолбэк на банк знаний
          if(!hits || !hits.length){
            out.innerHTML = answerCard('Ответ ассистента',
              'в индексе нет релевантных фрагментов · '+retrievalNote+' — показан мок из банка знаний', mockAnswer(question));
            btn.disabled = false; btn.innerHTML = '✦ Спросить ассистента';
            return;
          }

          // 2. ответ: LLM /chat по найденным фрагментам, иначе сами фрагменты
          if(cfg.ready){
            btn.innerHTML = U.spinner + ' Формулирую…';
            try{
              const answer = await callLLMRag(question, hits, cfg);
              out.innerHTML = answerCard('Ответ ассистента',
                'LLM по найденным фрагментам' + (cfg.model?' · '+cfg.model:'') + ' · ' + retrievalNote,
                answer) + sourcesHTML(hits);
            }catch(chatErr){
              // LLM не ответил → показываем фрагменты как ответ
              out.innerHTML = U.card('Ответ ассистента (фрагменты)',
                'LLM недоступен: '+esc(chatErr.message||String(chatErr))+' · показаны найденные фрагменты · '+esc(retrievalNote),
                fragmentsAnswerHTML(hits) +
                `<div class="btn-row" style="margin-top:12px"><button class="btn sm" data-ai-copy>Скопировать</button></div>`)
                + sourcesHTML(hits);
              ctx.toast('LLM не ответил — показаны фрагменты','err');
            }
          } else {
            out.innerHTML = U.card('Ответ ассистента (из материалов)', retrievalNote,
              fragmentsAnswerHTML(hits) +
              `<div class="btn-row" style="margin-top:12px"><button class="btn sm" data-ai-copy>Скопировать</button></div>`)
              + sourcesHTML(hits);
          }
        }catch(err){
          // непредвиденная ошибка ретривала → крайний мок
          out.innerHTML = answerCard('Ответ ассистента (запасной)',
            'ошибка ретривала: '+esc(err.message||String(err))+' · показан мок', mockAnswer(question));
          ctx.toast('Ошибка ретривала — показан мок','err');
        }finally{
          btn.disabled = false; btn.innerHTML = '✦ Спросить ассистента';
        }
      }
    }

    function answerCard(title, source, text){
      return U.card(title, source,
        `<div class="ai-answer" style="white-space:pre-wrap;line-height:1.6;color:var(--ink-2)">${esc(text)}</div>
         <div class="btn-row" style="margin-top:12px">
           <button class="btn sm" data-ai-copy>Скопировать ответ</button>
         </div>`);
    }
    // делегированный обработчик копирования ответа (один на смонтированный body)
    body.addEventListener('click', e=>{
      const c = e.target.closest && e.target.closest('[data-ai-copy]');
      if(!c) return;
      const block = c.closest('.card'); const txt = block && block.querySelector('.ai-answer, .ai-answer-frag');
      if(txt) U.copy(txt.textContent, 'Ответ скопирован ✓');
    });

    /* RAG-генерация: ответ СТРОГО по найденным фрагментам, со ссылками [n]. */
    const RAG_SYSTEM_PROMPT =
      'Ты — наставник отдела продаж компании Sensor (Сенсор Лицензирование): B2B-помощь в получении лицензии МЧС ' +
      '(монтаж/ТО/ремонт систем пожарной безопасности) и аттестации проектировщика (АТТПР). ' +
      'Отвечай на русском, кратко и по делу, ТОЛЬКО на основе приведённых ниже фрагментов материалов (КОНТЕКСТ). ' +
      'Не придумывай факты, которых нет в КОНТЕКСТЕ. Если в КОНТЕКСТЕ нет ответа — честно скажи об этом и предложи, что уточнить. ' +
      'Ссылайся на источники номерами в квадратных скобках [1], [2] сразу после утверждения. ' +
      'Где уместно — давай речевую формулировку для звонка и применяй технику отработки возражений: ' +
      'Присоединение → Вопрос на раскрытие → Аргументация → Закрывающий вопрос. Никогда не спрашивай «над чем подумать».';

    async function callLLMRag(question, hits, cfg){
      const url = cfg.endpoint.replace(/\/+$/,'') + '/chat/completions';
      const headers = { 'Content-Type':'application/json' };
      if(cfg.key) headers['Authorization'] = 'Bearer ' + cfg.key;
      const userMsg =
        'КОНТЕКСТ (фрагменты материалов Sensor, нумерованы):\n' + ragContext(hits) +
        '\n\nВОПРОС МЕНЕДЖЕРА:\n' + question +
        '\n\nОтветь строго по КОНТЕКСТУ выше, со ссылками [n] на использованные фрагменты.';
      const payload = {
        model: cfg.model || 'local-model',
        temperature: 0.3,
        max_tokens: 700,
        messages: [
          { role:'system', content: RAG_SYSTEM_PROMPT },
          { role:'user',   content: userMsg }
        ]
      };
      const ac = (typeof AbortController!=='undefined') ? new AbortController() : null;
      const tid = ac ? setTimeout(()=>ac.abort(), 45000) : null;
      let res;
      try {
        res = await fetch(url, { method:'POST', headers, body: JSON.stringify(payload), signal: ac?ac.signal:undefined });
      } catch(e){
        if(e && e.name==='AbortError') throw new Error('таймаут запроса (45 с)');
        throw new Error('сеть недоступна ('+(e&&e.message||e)+')');
      } finally { if(tid) clearTimeout(tid); }
      if(!res.ok){
        let detail=''; try{ const j=await res.json(); detail = (j.error&&j.error.message)||''; }catch(_){}
        throw new Error('HTTP '+res.status+(detail?' · '+detail:''));
      }
      const data = await res.json();
      const txt = data && data.choices && data.choices[0] && (
        (data.choices[0].message && data.choices[0].message.content) || data.choices[0].text);
      if(!txt) throw new Error('пустой ответ модели');
      return String(txt).trim();
    }

    const SYSTEM_PROMPT =
      'Ты — опытный наставник отдела продаж компании Sensor (Сенсор Лицензирование), B2B-помощь в получении ' +
      'лицензии МЧС (монтаж/ТО/ремонт систем пожарной безопасности) и аттестации проектировщика (АТТПР). ' +
      'Отвечай кратко, по делу, на русском. Используй технику отработки возражений: ' +
      'Присоединение → Вопрос на раскрытие → Аргументация → Закрывающий вопрос. ' +
      'Никогда не спрашивай «над чем подумать». Предлагай конкретные речевые формулировки и при уместности — приём дожима. ' +
      'Опирайся на предоставленный контекст (банк возражений, продукты).';

    async function callLLM(question, cfg){
      const url = cfg.endpoint.replace(/\/+$/,'') + '/chat/completions';
      const headers = { 'Content-Type':'application/json' };
      if(cfg.key) headers['Authorization'] = 'Bearer ' + cfg.key;
      const payload = {
        model: cfg.model || 'local-model',
        temperature: 0.4,
        max_tokens: 700,
        messages: [
          { role:'system', content: SYSTEM_PROMPT + '\n\n' + knowledgeContext() },
          { role:'user',   content: question }
        ]
      };
      // таймаут, чтобы зависший локальный сервер не подвешивал UI
      const ac = (typeof AbortController!=='undefined') ? new AbortController() : null;
      const tid = ac ? setTimeout(()=>ac.abort(), 45000) : null;
      let res;
      try {
        res = await fetch(url, { method:'POST', headers, body: JSON.stringify(payload), signal: ac?ac.signal:undefined });
      } catch(e){
        if(e && e.name==='AbortError') throw new Error('таймаут запроса (45 с)');
        throw new Error('сеть недоступна ('+(e&&e.message||e)+')');
      } finally { if(tid) clearTimeout(tid); }
      if(!res.ok){
        let detail=''; try{ const j=await res.json(); detail = (j.error&&j.error.message)||''; }catch(_){}
        throw new Error('HTTP '+res.status+(detail?' · '+detail:''));
      }
      const data = await res.json();
      const txt = data && data.choices && data.choices[0] && (
        (data.choices[0].message && data.choices[0].message.content) || data.choices[0].text);
      if(!txt) throw new Error('пустой ответ модели');
      return String(txt).trim();
    }

    function knowledgeContext(){
      const parts = [];
      parts.push('Техника: ' + technique + '.');
      if(bank.length){
        parts.push('Банк возражений: ' + bank.map(g=>g.cat+' → '+g.responses.slice(0,2).join(' / ')).join('; '));
      }
      if(dojim.length){
        parts.push('Приёмы дожима: ' + dojim.slice(0,8).join('; '));
      }
      if(products.length){
        parts.push('Продукты: ' + products.map(p=>p.title+' — '+(p.summary||'').slice(0,120)).join(' | '));
      }
      return parts.join('\n').slice(0,2400);
    }

    /* Мок-ответ без LLM: собираем релевантную группу возражений + продукт + приём дожима. */
    function mockAnswer(question){
      const q = (question||'').toLowerCase();
      const words = q.split(/[^a-zа-яё0-9]+/i).filter(w=>w.length>=3);
      let best=null, bestScore=0;
      bank.forEach(g=>{
        const hay = (g.cat+' '+g.responses.join(' ')).toLowerCase();
        let score=0; words.forEach(w=>{ if(hay.includes(w)) score++; });
        const catHead = (g.cat||'').toLowerCase().split(/[ /]/)[0];
        if(catHead && q.includes(catHead)) score+=2; // непустой токен: q.includes('') иначе всегда true
        if(score>bestScore){ bestScore=score; best=g; }
      });
      // определяем продукт по упоминанию
      let prod = null;
      if(/аттест|проектиров|аттпр/.test(q)) prod = products.find(p=>/attpr|аттест/i.test(p.id+p.title));
      else if(/лиценз|монтаж|мчс/.test(q)) prod = products.find(p=>/mchs|лиценз|мчс/i.test(p.id+p.title));

      const L = [];
      L.push('(LLM не настроен — ответ собран из банка возражений и карточек продуктов Sensor.)');
      L.push('');
      L.push('Каркас по технике: ' + technique + '.');
      L.push('');
      if(best && bestScore>0){
        L.push('Похоже на возражение «'+best.cat+'». Готовые формулировки:');
        best.responses.forEach(it=>L.push('  • '+it));
      } else {
        L.push('Дословного совпадения в банке нет. Базовый каркас:');
        L.push('  • Присоединение: «Понимаю, вопрос важный…»');
        L.push('  • Вопрос на раскрытие: «Что именно останавливает / с чем сравниваете?»');
        L.push('  • Аргументация: предмет договора — результат (лицензия/аттестация), сроки 10–15 раб. дней, гарантии в договоре.');
        L.push('  • Закрывающий вопрос: «Когда готовы начать работу?»');
      }
      if(prod){
        L.push('');
        L.push('Аргументы по продукту «'+prod.title+'»:');
        (prod.advantages||[]).slice(0,3).forEach(a=>L.push('  + '+a));
        if(prod.term) L.push('  ⏱ Срок: '+prod.term.split('.')[0]);
      }
      if(dojim.length){
        L.push('');
        const idx = (Math.abs(hashStr(q)) % dojim.length);
        L.push('Приём дожима к месту: ' + dojim[idx]);
      }
      return L.join('\n');
    }
    function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){ h=(h*31 + s.charCodeAt(i))|0; } return h; }

    /* =====================================================================
       Вкладка «Проверка специалиста (Блок 7)» — вердикт + правила МЧС/НОК
       ===================================================================== */
    function renderB7(){
      body.innerHTML =
        U.card('Проверка специалиста (Блок 7)',
          'Проверяем, проходит ли специалист как ответственный за ПБ под лицензию МЧС, как проектировщик под аттестацию (АТТПР) или под НОК (независимую оценку квалификации). Данные обезличены — ничего не сохраняется.',
          `<div class="grid cols-2">` +
            U.field('Вид допуска',
              `<select id="b7-kind">
                 <option value="mchs">Лицензия МЧС — ответственный за ПБ (стаж ≥5 лет)</option>
                 <option value="attpr">АТТПР — проектировщик (аттестация МЧС)</option>
                 <option value="nok">НОК — независимая оценка квалификации</option>
               </select>`) +
            U.field('Образование',
              `<select id="b7-edu">
                 <option value="school">Школа / без проф. образования</option>
                 <option value="spo">Среднее профессиональное (СПО)</option>
                 <option value="higher">Высшее</option>
               </select>`) +
          `</div>` +
          `<div class="grid cols-2">` +
            U.field('Профильность образования',
              `<select id="b7-prof">
                 <option value="fire">Пожарная / Техносферная безопасность</option>
                 <option value="retrain">Непрофильное + профпереподготовка (≥250 ч)</option>
                 <option value="none">Непрофильное, без переподготовки</option>
               </select>`) +
            U.field('Стаж по профилю, лет', `<input id="b7-exp" type="number" min="0" max="60" step="1" value="0">`) +
          `</div>` +
          `<div class="grid cols-2">` +
            U.field('Опыт под лицензией МЧС / в Госпожнадзоре',
              `<select id="b7-mchsexp"><option value="no">Нет</option><option value="yes">Да</option></select>`) +
            U.field('Оформлен ответственным у другого лицензиата',
              `<select id="b7-busy"><option value="no">Нет</option><option value="yes">Да</option></select>`) +
          `</div>` +
          `<div class="btn-row" style="margin-top:6px">
             <button class="btn primary" id="b7-run">Проверить</button>
             <button class="btn" id="b7-reset">Сбросить</button>
           </div>
           <div id="b7-out" style="margin-top:14px"></div>`) +
        rulesCard();

      const out = body.querySelector('#b7-out');
      const run = ()=>{
        const v = verify(
          body.querySelector('#b7-kind').value,
          body.querySelector('#b7-edu').value,
          body.querySelector('#b7-prof').value,
          Math.max(0, parseInt(body.querySelector('#b7-exp').value,10) || 0),
          body.querySelector('#b7-mchsexp').value === 'yes',
          body.querySelector('#b7-busy').value === 'yes'
        );
        out.innerHTML = verdictCard(v);
      };
      body.querySelector('#b7-run').onclick = run;
      body.querySelector('#b7-reset').onclick = ()=>{
        body.querySelector('#b7-edu').value='school';
        body.querySelector('#b7-prof').value='fire';
        body.querySelector('#b7-exp').value='0';
        body.querySelector('#b7-mchsexp').value='no';
        body.querySelector('#b7-busy').value='no';
        out.innerHTML='';
      };
      // авто-пересчёт при изменении (если уже был результат)
      body.querySelectorAll('#b7-kind,#b7-edu,#b7-prof,#b7-exp,#b7-mchsexp,#b7-busy').forEach(el=>{
        el.addEventListener('change', ()=>{ if(out.innerHTML.trim()) run(); });
      });
    }

    function verdictCard(v){
      const cls = v.status; // 'ok'|'warn'|'err'
      const head = v.status==='ok' ? 'Подходит'
                 : v.status==='warn' ? 'Подходит с условием'
                 : 'Не подходит';
      const badge = v.status==='ok' ? `<span class="badge ok dot">✓ ${esc(head)}</span>`
                  : v.status==='warn' ? `<span class="badge warn dot">▲ ${esc(head)}</span>`
                  : `<span class="badge err dot">✕ ${esc(head)}</span>`;
      return U.card('Вердикт: ' + head, v.subtitle,
        `<div style="margin-bottom:12px">${badge}</div>` +
        `<div style="font-weight:600;margin-bottom:6px;font-size:13px">Разбор по требованиям</div>` +
        `<div style="display:grid;gap:6px">${
          v.reasons.map(r=>{
            const c = r.ok ? 'var(--ok)' : (r.warn?'var(--warn)':'var(--err)');
            const mk = r.ok ? '✓' : (r.warn?'▲':'✕');
            return `<div style="display:flex;gap:9px;align-items:flex-start;line-height:1.5">
                      <span style="flex:0 0 auto;color:${c};font-weight:700;margin-top:1px">${mk}</span>
                      <span style="flex:1;color:var(--ink-2)">${esc(r.text)}</span>
                    </div>`;
          }).join('')
        }</div>` +
        (v.next && v.next.length ? `<div style="font-weight:600;margin:14px 0 6px;font-size:13px">Что предложить клиенту</div>
          <ul style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.55">${v.next.map(n=>`<li style="margin:3px 0">${esc(n)}</li>`).join('')}</ul>` : '') +
        (v.note ? `<p class="hint" style="margin-top:12px">${esc(v.note)}</p>` : ''));
    }

    function rulesCard(){
      return U.card('Правила квалификации (шпаргалка)',
        'Опорные требования к специалисту для лицензии МЧС, аттестации проектировщика и НОК.',
        `<div class="grid cols-2" style="gap:12px">
           <div>
             <div style="font-weight:600;margin-bottom:5px">Лицензия МЧС — ответственный за ПБ</div>
             <ul style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.55">
               <li>Образование: «Пожарная безопасность» / «Техносферная безопасность» (СПО или высшее) либо любое СПО/высшее + профпереподготовка ≥250 ч.</li>
               <li>Стаж по профилю ПБ — <strong>≥5 лет</strong>; засчитывается опыт под лицензией МЧС / в Госпожнадзоре.</li>
               <li>Оформлен ответственным <strong>только у одного</strong> лицензиата (без совместительства на этой роли).</li>
               <li>Техспециалисты: 2 чел (1–2 вида), 3 чел (3–4 вида), 5+ чел (5+ видов) — трудовые договоры.</li>
             </ul>
           </div>
           <div>
             <div style="font-weight:600;margin-bottom:5px">АТТПР — проектировщик (МЧС)</div>
             <ul style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.55">
               <li>Образование не ниже СПО; при непрофильном — профпереподготовка → диплом в ФИС ФРДО.</li>
               <li>Жёсткого ценза по стажу нет — экзамен проверяет знания (40 вопросов, ~45 мин).</li>
               <li>Сдаёт в ГУ МЧС по центру федерального округа — по прописке проектировщика.</li>
               <li>Аттестат действует 5 лет; пересдача при отказе — через 2 мес (планируют 6 мес).</li>
             </ul>
             <div style="font-weight:600;margin:10px 0 5px">НОК (независимая оценка квалификации)</div>
             <ul style="margin:0;padding-left:18px;color:var(--ink-2);line-height:1.55">
               <li>Проводит центр оценки квалификации (ЦОК) по профстандарту; экзамен — теория + практика.</li>
               <li>Требования к допуску — по профстандарту (образование + опыт); итог вносится в реестр НОК.</li>
             </ul>
           </div>
         </div>`);
    }

    /* Подробный движок вердикта. status: 'ok' | 'warn' | 'err'. */
    function verify(kind, edu, prof, exp, mchsExp, busy){
      const reasons = [];
      const next = [];
      let hardFail = false, soft = false;

      // 1. Базовое образование
      if(edu==='school'){
        reasons.push({ok:false, text:'Образование — только школа. Нужно не ниже СПО (среднее профессиональное) или высшее.'});
        hardFail = true;
        next.push('Получить СПО/высшее или подобрать другого специалиста — подбор берём на себя.');
      } else {
        reasons.push({ok:true, text:'Образование '+(edu==='higher'?'высшее':'СПО')+' — соответствует минимальному уровню.'});
      }

      // 2. Профильность
      if(prof==='fire'){
        reasons.push({ok:true, text:'Профиль «Пожарная / Техносферная безопасность» — профпереподготовка не требуется.'});
      } else if(prof==='retrain'){
        if(edu==='school'){
          reasons.push({ok:false, text:'Профпереподготовка засчитывается только поверх СПО/высшего — базового образования нет.'});
          hardFail = true;
        } else {
          reasons.push({ok:true, text:'Непрофильное образование закрыто профпереподготовкой ≥250 ч (программу даёт наш УЦ).'});
          next.push('Заложить срок на профпереподготовку (диплом вносится в ФИС ФРДО) до подачи.');
        }
      } else { // none
        reasons.push({ok:false, text:'Образование непрофильное и без профпереподготовки. Нужен профиль ПБ либо профпереподготовка ≥250 ч.'});
        if(edu==='school'){ hardFail = true; }
        else { soft = true; next.push('Предложить профпереподготовку ≥250 ч в нашем УЦ — закрывает требование к профилю.'); }
      }

      if(kind==='mchs'){
        // 3. Стаж ≥5 лет
        if(exp>=5){
          reasons.push({ok:true, text:'Стаж '+exp+' лет — выполняет требование ≥5 лет для ответственного за ПБ.'});
        } else {
          reasons.push({ok:false, text:'Стаж '+exp+' лет — недостаточно, нужно ≥5 лет по профилю ПБ.'});
          hardFail = true;
          next.push('Рассмотреть другого кандидата со стажем ≥5 лет — подбор специалиста с нашей стороны.');
        }
        // 4. Опыт под лицензией МЧС / Госпожнадзор
        if(mchsExp){
          reasons.push({ok:true, text:'Есть опыт под лицензией МЧС / в Госпожнадзоре — стаж по ПБ зачтётся корректно.'});
        } else {
          reasons.push({warn:true, text:'Нет подтверждённого опыта под лицензией МЧС / в Госпожнадзоре — стаж по ПБ могут зачесть не полностью.'});
          soft = true;
          next.push('Подготовить документы, подтверждающие профильный стаж (трудовая, должностные обязанности).');
        }
        // 5. Занятость у другого лицензиата
        if(busy){
          reasons.push({ok:false, text:'Уже оформлен ответственным за ПБ у другого лицензиата — на эту роль нельзя одновременно у двух.'});
          hardFail = true;
          next.push('Уволить/перевести с роли у прежнего лицензиата либо подобрать другого ответственного.');
        } else {
          reasons.push({ok:true, text:'Не занят ответственным за ПБ у другого лицензиата — роль свободна.'});
        }
      } else if(kind==='attpr'){
        if(exp>=1){
          reasons.push({ok:true, text:'Опыт по профилю '+exp+' лет — для аттестации жёсткого ценза нет, важнее профильная подготовка.'});
        } else {
          reasons.push({ok:true, text:'Стаж по профилю не критичен для АТТПР — экзамен проверяет знания, а не выслугу.'});
        }
        next.push('Сопровождение на экзамене: техспециалист свяжется перед подачей и подскажет, как вести себя.');
      } else { // nok
        if(exp>=1){
          reasons.push({ok:true, text:'Опыт по профилю '+exp+' лет учитывается ЦОК при допуске к экзамену по профстандарту.'});
        } else {
          reasons.push({warn:true, text:'Стаж по профилю не указан — допуск к НОК определяется требованиями конкретного профстандарта.'});
          soft = true;
        }
        next.push('Подобрать профстандарт под квалификацию специалиста; экзамен — теория + практика в ЦОК.');
      }

      const status = hardFail ? 'err' : (soft ? 'warn' : 'ok');
      const subtitle = kind==='mchs' ? 'Ответственный за ПБ под лицензию МЧС'
                     : kind==='attpr' ? 'Проектировщик под аттестацию (АТТПР)'
                     : 'Специалист под НОК (независимая оценка квалификации)';
      const note = kind==='mchs'
          ? 'Ответственный за ПБ может быть оформлен только у одного юрлица/ИП. Профстаж считается по записям трудовой книжки/договоров по профилю ПБ.'
          : kind==='attpr'
          ? 'Аттестацию принимает ГУ МЧС по центру федерального округа по прописке проектировщика. При непрофильном образовании — сначала профпереподготовка, затем аттестация. Аттестат действует 5 лет.'
          : 'НОК проводит аккредитованный центр оценки квалификации (ЦОК). Допуск и содержание экзамена определяет профстандарт; результат вносится в реестр сведений о проведении НОК.';

      return { status, subtitle, reasons, next, note };
    }

    /* =====================================================================
       Вкладка «Контроль звонков» — скоринг транскрипта по рубрике
       Поток: вставить транскрипт ИЛИ выбрать пример из window.CALL_EXAMPLES →
       «Оценить звонок» → если задан LLM-эндпоинт (ctx.store.creds('llm')) —
       отправляем транскрипт + рубрику и получаем оценку по этапам; иначе
       эвристический мок-скоринг по ключевым признакам checks. Работает и без
       ключей, и при отсутствии глобальных данных (мини-фолбэк ниже).
       ===================================================================== */

    // рубрика: реальная из window.CALL_RUBRIC, иначе компактный фолбэк
    function qcRubric(){
      const R = window.CALL_RUBRIC;
      if(R && Array.isArray(R.stages) && R.stages.length) return R;
      return {
        stages: [
          { id:'contact', name:'Установление контакта', weight:20, checks:[
            { id:'c_greet', text:'Поздоровался и представился (имя + компания)', hint:'Позитивный тон, «улыбка» в голосе.' },
            { id:'c_name',  text:'Узнал, как обращаться к клиенту', hint:'Зафиксировал имя.' } ] },
          { id:'qual', name:'Выявление потребности', weight:25, checks:[
            { id:'q_goal', text:'Выяснил цель обращения', hint:'Для чего нужна лицензия/аттестация.' },
            { id:'q_term', text:'Уточнил срочность / сроки', hint:'К какому сроку нужен результат.' } ] },
          { id:'present', name:'Презентация и стоимость', weight:30, checks:[
            { id:'p_price', text:'Чётко озвучил стоимость', hint:'Без «вилок».' },
            { id:'p_term',  text:'Назвал срок и привязал к дате', hint:'«К … числу будет готово».' } ] },
          { id:'close', name:'Закрытие и возражения', weight:25, checks:[
            { id:'cl_q',   text:'Задал закрывающий вопрос', hint:'«Когда готовы начать?»' },
            { id:'cl_obj', text:'Отработал возражение по технике', hint:'Присоединение → вопрос → аргумент → закрытие.' } ] }
        ],
        scale: { verdicts:[
          { id:'fail', label:'Слабый звонок', min:0, color:'err' },
          { id:'ok', label:'Рабочий звонок', min:50, color:'warn' },
          { id:'strong', label:'Сильный звонок', min:70, color:'info' },
          { id:'ref', label:'Эталонный звонок', min:88, color:'ok' } ] },
        tips:{}
      };
    }

    // примеры: реальные из window.CALL_EXAMPLES, иначе один встроенный
    function qcExamples(){
      const E = window.CALL_EXAMPLES;
      if(Array.isArray(E) && E.length) return E;
      return [{
        id:'demo', product:'МЧС', manager:'Демо', date:'—',
        note:'Встроенный образец (реальные звонки не загружены)',
        transcript:'Добрый день! Меня зовут Андрей, компания Сенсор Лицензирование. Подскажите, как могу к вам обращаться? '+
          'Иван, я задам пару вопросов, сформируем предложение под вас, хорошо? Для чего планируете лицензию МЧС? '+
          'Понял, чтобы участвовать в тендерах. К какому сроку нужен результат? Хорошо, до 15 рабочих дней — запустим завтра, '+
          'к 20-му числу всё будет готово. Стоимость помощи составит … рублей плюс госпошлина 7500 рублей при подаче. '+
          'Когда готовы начать работу? Если «дорого» — понимаю, давайте сравним не только цену: с кем сравниваете? '+
          'Жду карточку компании и документы, завтра наберу в первой половине дня.'
      }];
    }

    // нормализация весов: если Σweight ≠ 100, считаем балл от суммы весов
    function qcWeightSum(R){ return R.stages.reduce((a,st)=>a+(+st.weight||0),0) || R.stages.length; }

    function qcVerdict(R, score){
      const list = (R.scale && R.scale.verdicts) || [];
      let best = null;
      list.forEach(v=>{ if(score>= (v.min||0)){ if(!best || (v.min||0)>=(best.min||0)) best=v; } });
      return best || { label:'—', color:'' };
    }

    let qcLastInput = ctx.store.get('sales_qc_text','') || '';
    let qcSelExample = '';

    function renderQC(){
      const R = qcRubric();
      const examples = qcExamples();
      const cfg = llmConfig();
      const modeBadge = cfg.ready
        ? `<span class="badge ok dot">LLM подключён${cfg.model?' · '+esc(cfg.model):''} — оценка моделью</span>`
        : `<span class="badge warn dot">нет ключей — эвристический мок-скоринг</span>`;

      const exOpts = ['<option value="">— выбрать пример звонка —</option>']
        .concat(examples.map((e,i)=>{
          const lbl = [e.product, e.manager, e.date].filter(Boolean).join(' · ') + (e.note?(' — '+e.note):'');
          return `<option value="${i}">${esc(lbl.length>72?lbl.slice(0,70)+'…':lbl)}</option>`;
        })).join('');

      body.innerHTML =
        U.card('Контроль звонков',
          'Вставьте транскрипт звонка или выберите образец, затем оцените его по рубрике этапов воронки. '+
          (cfg.ready?'Оценку выставит подключённая модель.':'Без ключей работает эвристический скоринг по ключевым признакам. ')+
          'Ничего не сохраняется на сервере.',
          `<div class="btn-row" style="margin-bottom:12px">${modeBadge}
             <span class="badge" title="Рубрика контроля качества">${esc(R.stages.length)} этап${plural(R.stages.length,'','а','ов')} · вес Σ${qcWeightSum(R)}</span>
             ${!cfg.ready ? `<button class="btn ghost sm" id="qc-cfg" style="margin-left:auto">Настроить LLM →</button>`:''}
           </div>` +
          U.field('Образец звонка (необязательно)',
            `<select id="qc-example">${exOpts}</select>`) +
          U.field('Транскрипт звонка',
            `<textarea id="qc-text" rows="9" placeholder="Вставьте текст транскрипта звонка сюда…">${esc(qcLastInput)}</textarea>`) +
          `<div class="btn-row">
             <button class="btn primary" id="qc-run">✦ Оценить звонок</button>
             <button class="btn" id="qc-clear">Очистить</button>
           </div>
           <div id="qc-out" style="margin-top:14px"></div>`);

      const sel = body.querySelector('#qc-example');
      const ta = body.querySelector('#qc-text');
      const out = body.querySelector('#qc-out');
      const cfgBtn = body.querySelector('#qc-cfg');
      if(cfgBtn) cfgBtn.onclick = ()=>ctx.go && ctx.go('settings');
      if(qcSelExample) sel.value = qcSelExample;

      sel.onchange = ()=>{
        qcSelExample = sel.value;
        if(sel.value==='') return;
        const ex = examples[+sel.value];
        if(ex && ex.transcript){ ta.value = ex.transcript; qcLastInput = ex.transcript; ctx.store.set('sales_qc_text', qcLastInput); }
      };
      ta.addEventListener('input', ()=>{ qcLastInput = ta.value; ctx.store.set('sales_qc_text', qcLastInput); });
      body.querySelector('#qc-clear').onclick = ()=>{ ta.value=''; qcLastInput=''; qcSelExample=''; sel.value=''; ctx.store.set('sales_qc_text',''); out.innerHTML=''; ta.focus(); };
      body.querySelector('#qc-run').onclick = ()=>scoreCall();

      async function scoreCall(){
        const text = (ta.value||'').trim();
        if(text.length<20){ ctx.toast('Вставьте транскрипт звонка (минимум пара фраз)','err'); ta.focus(); return; }
        const btn = body.querySelector('#qc-run');
        btn.disabled = true; btn.innerHTML = U.spinner + ' Оцениваю…';
        out.innerHTML = U.card('Оценка звонка', cfg.ready?'обращение к LLM…':'эвристический скоринг…', U.skeleton({lines:5}));
        try{
          let result, source;
          if(cfg.ready){
            try{
              result = await scoreViaLLM(text, R, cfg);
              source = 'LLM' + (cfg.model?' · '+cfg.model:'');
            }catch(err){
              result = scoreHeuristic(text, R);
              source = 'мок (LLM недоступен: '+(err.message||String(err))+')';
              ctx.toast('LLM не ответил — показан эвристический скоринг','err');
            }
          } else {
            result = scoreHeuristic(text, R);
            source = 'эвристический скоринг по ключевым признакам';
          }
          out.innerHTML = qcResultHTML(R, result, source);
          bindQCResult(out, R, text);
        }catch(err){
          out.innerHTML = U.card('Ошибка оценки', '', `<p class="hint">${esc(err.message||String(err))}</p>`);
        }finally{
          btn.disabled = false; btn.innerHTML = '✦ Оценить звонок';
        }
      }
    }

    function bindQCResult(out, R, text){
      const cp = out.querySelector('[data-qc-copy]');
      if(cp) cp.onclick = ()=>{ const block = out.querySelector('.qc-report'); if(block) U.copy(block.dataset.report||'', 'Отчёт по звонку скопирован ✓'); };
      // подсветка проблемных мест — раскрыть/свернуть
      const hl = out.querySelector('#qc-hl-toggle');
      const box = out.querySelector('#qc-hl-box');
      if(hl && box) hl.onclick = ()=>{ const open = box.style.display==='none'; box.style.display = open?'block':'none'; hl.textContent = open?'Скрыть проблемные места':'Показать проблемные места'; };
    }

    /* ---------- эвристический скоринг: ищем признаки checks в тексте ---------- */
    // Карта ключевых слов по id чек-пункта рубрики. Если id незнаком — fallback на слова из самого текста признака.
    const QC_SIGNALS = {
      contact_greet:['здравств','добрый день','добрый вечер','меня зовут','компания','сенсор','представ'],
      contact_name:['как могу','как обращат','как к вам','подскажите, как','ваше имя','как вас зовут'],
      contact_initiative:['давайте','предлагаю','смотрите','я расскажу','сейчас объясню'],
      contact_speech:['извините','хорошо','конечно','понимаю'],
      prog_frame:['задам пару вопросов','несколько вопросов','сформируем предложение','дальше расскажу','как заключить'],
      prog_consent:['хорошо?','согласны','договорились','удобно?'],
      qual_goal:['для чего','для каких','зачем','цель','планируете','чем занимаетесь','тендер'],
      qual_why_now:['почему сейчас','появились','объект','контракт','встал вопрос'],
      qual_term:['к какому сроку','когда нужно','срочно','до какого','успеть','к числу'],
      qual_profile:['организация','ип ','штат','регион','сколько сотрудник','образование','прописк'],
      qual_self_try:['пробовали сами','сами получить','сами сдать','почему обратились','решение об отказе'],
      qual_upsell:['проектирован','профпереподготовк','полный пакет','оборудовани','аттпр','смежн'],
      dm_role:['должность','кем работаете','ваша роль','руководитель','директор'],
      dm_decision:['принимаете реш','решение приним','правильно понимаю, реш','кто решает'],
      dm_strategy:['выйти на','критерии выбора','собрать кп','коммерческое предложение'],
      pres_region:['по вашему региону','работаем по','румянцево','офис','постоянно работаем'],
      pres_subject:['предмет договора','полученная лицензия','внесение в реестр','не юруслуги','не консультац'],
      pres_process:['как проходит','анализ','подача','выездная проверка','сопровожден','этап'],
      pres_benefit:['право работать','зарабатыв','выгод','чтобы вы могли','позволит'],
      pres_value:['по цене разницы нет','платить дважды','отстройк','качество','полный пакет'],
      tp_term:['рабочих дней','до 15','до 10','до 20','к числу','к … числу','запускаем завтра','будет готово'],
      tp_presum:['остались вопросы','всё ли понятно','как вам предложение','резюм'],
      tp_price:['стоимость','рублей','составит','цена','сумма'],
      tp_extra:['госпошлин','7500','удобнее','в офисе или','альтернатив'],
      close_question:['когда готовы начать','начинаем','что скажете','готовы заключ','когда стартуем'],
      close_next:['жду карточку','документы','наберу','перезвоню','в какой половине','следующ'],
      close_no_think:[], // обратный признак — см. ниже
      obj_join:['понимаю','согласен, что','да, действительно','вопрос важный'],
      obj_open:['почему','с кем сравнив','что именно','что останавлив','с чем сравнив'],
      obj_argument:['дорого','зато','потому что','наша компания','гарант','в договоре'],
      obj_close_q:['согласны?','начинаем?','оформляем?','верно?','что скажете?'],
      obj_sincerity:['не первый год','когда так отвечают','обычно есть причина','честно говоря'],
      obj_dojim:['заканчива','повышается','последн','группа на обучение','сезон','успеть','бронир','инспектор']
    };
    const QC_FORBIDDEN = ['над чем подумать','над чем думать','подумайте и перезвоните','перезвоните, если'];

    // признаки из текста чек-пункта (fallback для незнакомых рубрик)
    function qcCheckWords(check){
      const sig = QC_SIGNALS[check.id];
      if(sig) return sig;
      const src = ((check.text||'')+' '+(check.hint||'')).toLowerCase();
      return src.split(/[^a-zа-яё0-9]+/i).filter(w=>w.length>=5).slice(0,8);
    }

    function scoreHeuristic(text, R){
      const low = ' ' + text.toLowerCase() + ' ';
      const wsum = qcWeightSum(R);
      const stages = R.stages.map(st=>{
        const checks = (st.checks||[]).map(c=>{
          let hit;
          if(c.id==='close_no_think' || c.id==='c_noThink'){
            // обратный признак: хорошо, если запрещённой фразы НЕТ
            hit = !QC_FORBIDDEN.some(f=>low.includes(f));
          } else {
            const words = qcCheckWords(c);
            hit = words.length ? words.some(w=>low.includes(w)) : false;
          }
          return { id:c.id, text:c.text, ok:hit };
        });
        const total = checks.length || 1;
        const done = checks.filter(c=>c.ok).length;
        const ratio = done/total;
        const weight = +st.weight || (100/R.stages.length);
        const points = Math.round(ratio*weight*10)/10;
        const good = checks.filter(c=>c.ok).map(c=>c.text);
        const miss = checks.filter(c=>!c.ok).map(c=>c.text);
        return {
          id:st.id, name:st.name, weight, done, total, ratio,
          points, max:Math.round(weight*10)/10,
          comment: ratio===1 ? 'Этап отработан полностью.'
                 : ratio>=0.6 ? 'Этап в целом пройден, есть пробелы.'
                 : ratio>0 ? 'Этап пройден поверхностно.'
                 : 'Этап не отработан — ключевые признаки не прозвучали.',
          good, miss, checks
        };
      });
      const rawScore = stages.reduce((a,s)=>a+s.points,0);
      // нормируем к 100, если сумма весов не равна 100
      const score = Math.round((wsum===100 ? rawScore : rawScore/wsum*100));
      // проблемные места — фразы из текста рядом с запрещёнными формулировками
      const flags = [];
      QC_FORBIDDEN.forEach(f=>{ if(low.includes(f)) flags.push('Запрещённая формулировка в звонке: «'+f+'».'); });
      stages.filter(s=>s.ratio<0.5).forEach(s=>flags.push('Слабый этап «'+s.name+'»: '+(s.miss.slice(0,2).join('; ')||'нет ключевых признаков')+'.'));
      return { score, stages, flags, mock:true };
    }

    /* ---------- оценка через LLM (OpenAI-совместимый JSON-ответ) ---------- */
    function qcRubricContext(R){
      return R.stages.map(st=>{
        const checks = (st.checks||[]).map(c=>'    - '+c.text).join('\n');
        return '• ['+st.id+'] '+st.name+' (вес '+(st.weight||'')+'):\n'+checks;
      }).join('\n');
    }
    const QC_SYSTEM =
      'Ты — руководитель отдела контроля качества продаж компании Sensor (лицензия МЧС, аттестация проектировщика АТТПР). '+
      'Оцени транскрипт телефонного звонка менеджера по предоставленной рубрике этапов воронки. '+
      'Для каждого этапа выстави балл от 0 до его веса (доля выполненных признаков × вес), укажи, что сделано хорошо и что упущено, дай короткий комментарий. '+
      'Верни СТРОГО JSON без пояснений вокруг, по схеме: '+
      '{"stages":[{"id":"contact","points":6.4,"comment":"...","good":["..."],"miss":["..."]}],"flags":["проблемное место 1"]}. '+
      'id этапов бери из рубрики. Отвечай на русском.';

    async function scoreViaLLM(text, R, cfg){
      const url = cfg.endpoint.replace(/\/+$/,'') + '/chat/completions';
      const headers = { 'Content-Type':'application/json' };
      if(cfg.key) headers['Authorization'] = 'Bearer ' + cfg.key;
      const userMsg = 'РУБРИКА:\n' + qcRubricContext(R) +
        '\n\nТРАНСКРИПТ ЗВОНКА:\n' + text.slice(0,8000) +
        '\n\nВерни только JSON по схеме из системного промпта.';
      const payload = {
        model: cfg.model || 'local-model',
        temperature: 0.2,
        max_tokens: 1200,
        messages: [ { role:'system', content: QC_SYSTEM }, { role:'user', content: userMsg } ]
      };
      const ac = (typeof AbortController!=='undefined') ? new AbortController() : null;
      const tid = ac ? setTimeout(()=>ac.abort(), 60000) : null;
      let res;
      try {
        res = await fetch(url, { method:'POST', headers, body: JSON.stringify(payload), signal: ac?ac.signal:undefined });
      } catch(e){
        if(e && e.name==='AbortError') throw new Error('таймаут запроса (60 с)');
        throw new Error('сеть недоступна ('+(e&&e.message||e)+')');
      } finally { if(tid) clearTimeout(tid); }
      if(!res.ok){
        let detail=''; try{ const j=await res.json(); detail=(j.error&&j.error.message)||''; }catch(_){}
        throw new Error('HTTP '+res.status+(detail?' · '+detail:''));
      }
      const data = await res.json();
      const txt = data && data.choices && data.choices[0] && (
        (data.choices[0].message && data.choices[0].message.content) || data.choices[0].text);
      if(!txt) throw new Error('пустой ответ модели');
      const parsed = qcParseJSON(String(txt));
      if(!parsed || !Array.isArray(parsed.stages)) throw new Error('модель вернула не-JSON');
      return qcNormalizeLLM(parsed, R);
    }

    // вытащить JSON из ответа (модель может обрамить ```json … ``` или текстом)
    function qcParseJSON(s){
      let str = s.trim().replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```\s*$/,'');
      try { return JSON.parse(str); } catch(_){}
      const a = str.indexOf('{'), b = str.lastIndexOf('}');
      if(a>=0 && b>a){ try { return JSON.parse(str.slice(a,b+1)); } catch(_){} }
      return null;
    }

    // привести ответ LLM к нашей структуре + общий взвешенный балл
    function qcNormalizeLLM(parsed, R){
      const wsum = qcWeightSum(R);
      const byId = {}; (parsed.stages||[]).forEach(s=>{ if(s && s.id!=null) byId[s.id]=s; });
      const stages = R.stages.map(st=>{
        const weight = +st.weight || (100/R.stages.length);
        const max = Math.round(weight*10)/10;
        const got = byId[st.id] || {};
        let points = Number(got.points);
        if(!isFinite(points)) points = 0;
        points = Math.max(0, Math.min(weight, points));
        points = Math.round(points*10)/10;
        const ratio = weight ? points/weight : 0;
        const good = Array.isArray(got.good) ? got.good.map(String) : [];
        const miss = Array.isArray(got.miss) ? got.miss.map(String) : [];
        return {
          id:st.id, name:st.name, weight, points, max, ratio,
          done:good.length, total:(st.checks||[]).length||1,
          comment: String(got.comment||'').trim() || (ratio>=0.6?'Этап в целом пройден.':'Этап с пробелами.'),
          good, miss
        };
      });
      const rawScore = stages.reduce((a,s)=>a+s.points,0);
      const score = Math.round((wsum===100 ? rawScore : rawScore/wsum*100));
      const flags = Array.isArray(parsed.flags) ? parsed.flags.map(String) : [];
      return { score, stages, flags, mock:false };
    }

    /* ---------- рендер результата оценки ---------- */
    function qcResultHTML(R, result, source){
      const v = qcVerdict(R, result.score);
      const ringColor = v.color==='ok'?'var(--ok)':v.color==='info'?'var(--accent)':v.color==='warn'?'var(--warn)':'var(--err)';

      const cards = result.stages.map(s=>{
        const pct = s.weight ? Math.round(s.ratio*100) : 0;
        const tone = s.ratio>=0.9?'ok':s.ratio>=0.6?'info':s.ratio>0?'warn':'err';
        const edge = s.ratio>=0.9?'var(--ok)':s.ratio>=0.6?'var(--accent)':s.ratio>0?'var(--warn)':'var(--err)';
        const goodHtml = s.good && s.good.length
          ? `<div style="margin-top:8px"><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;color:var(--ok-d)">Что хорошо</div>
               <ul style="margin:0;padding-left:17px;color:var(--ink-2);line-height:1.5">${s.good.slice(0,5).map(g=>`<li>${esc(g)}</li>`).join('')}</ul></div>` : '';
        const missHtml = s.miss && s.miss.length
          ? `<div style="margin-top:8px"><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;color:var(--err-d)">Что упущено</div>
               <ul style="margin:0;padding-left:17px;color:var(--ink-2);line-height:1.5">${s.miss.slice(0,5).map(m=>`<li>${esc(m)}</li>`).join('')}</ul></div>` : '';
        return `<div class="card" style="padding:13px 15px;box-shadow:inset 3px 0 0 ${edge},var(--shadow-xs)">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
                    <strong style="flex:1;font-size:13.5px">${esc(s.name)}</strong>
                    <span class="badge ${tone}" style="font-variant-numeric:tabular-nums">${s.points} / ${s.max}</span>
                  </div>
                  <div class="bar" style="margin-bottom:6px"><span style="width:${pct}%;background:${edge}"></span></div>
                  <div style="color:var(--ink-2);line-height:1.5;font-size:12.5px">${esc(s.comment)}</div>
                  ${goodHtml}${missHtml}
                </div>`;
      }).join('');

      const flags = (result.flags||[]).filter(Boolean);
      const flagsBox = flags.length
        ? `<div style="margin-top:14px">
             <button class="btn ghost sm" id="qc-hl-toggle">Скрыть проблемные места</button>
             <div id="qc-hl-box" style="margin-top:8px;display:block">
               ${flags.map(f=>`<div style="display:flex;gap:9px;align-items:flex-start;padding:7px 10px;border:1px solid var(--err);border-radius:var(--radius-xs);margin-bottom:6px;background:var(--err-soft,transparent)">
                   <span style="flex:0 0 auto;color:var(--err);font-weight:700;margin-top:1px">⚑</span>
                   <span style="flex:1;color:var(--ink-2);line-height:1.5">${esc(f)}</span>
                 </div>`).join('')}
             </div>
           </div>` : '';

      const report = qcReportText(R, result, v);

      return U.card('Оценка звонка', source,
        `<div class="qc-report" data-report="${esc(report)}">
           <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;flex-wrap:wrap">
             <div style="flex:0 0 auto;width:78px;height:78px;border-radius:50%;display:grid;place-items:center;
                  border:5px solid ${ringColor};font-variant-numeric:tabular-nums">
               <span style="font-size:23px;font-weight:800;line-height:1;color:${ringColor}">${result.score}</span>
             </div>
             <div style="flex:1;min-width:160px">
               <div style="font-size:16px;font-weight:700;margin-bottom:3px;color:${ringColor}">${esc(v.label)}</div>
               <div class="muted" style="font-size:12.5px;line-height:1.4">Общий взвешенный балл из 100 по ${result.stages.length} этап${plural(result.stages.length,'у','ам','ам')}.</div>
             </div>
             <button class="btn sm" data-qc-copy style="flex:0 0 auto">Скопировать отчёт</button>
           </div>
           <div style="font-weight:600;margin-bottom:8px;font-size:13px">Разбор по этапам</div>
           <div class="grid" style="gap:10px">${cards}</div>
           ${flagsBox}
         </div>`);
    }

    function qcReportText(R, result, v){
      const L = [];
      L.push('Оценка звонка — '+v.label+' · '+result.score+' / 100'+(result.mock?' (эвристический скоринг)':' (оценка LLM)'));
      L.push('');
      result.stages.forEach(s=>{
        L.push('• '+s.name+': '+s.points+' / '+s.max);
        if(s.comment) L.push('    '+s.comment);
        (s.good||[]).slice(0,5).forEach(g=>L.push('    + '+g));
        (s.miss||[]).slice(0,5).forEach(m=>L.push('    − '+m));
      });
      if((result.flags||[]).length){
        L.push('');
        L.push('Проблемные места:');
        result.flags.forEach(f=>L.push('  ⚑ '+f));
      }
      return L.join('\n');
    }

    render();
  }
});

/* Мост для actions командной палитры: палитра сначала переходит на #/sales,
   затем (через setTimeout) вызывает run(). К этому моменту модуль уже смонтирован
   и слушает событие 'sales:tab', поэтому переключение происходит сразу. Параллельно
   пишем выбор в store, чтобы он сохранился и при последующих заходах. */
function salesGoTab(ctx, tab){
  try { ctx && ctx.store && ctx.store.set('sales_tab', tab); } catch(e){}
  try { window.dispatchEvent(new CustomEvent('sales:tab', { detail: tab })); } catch(e){}
}

/* ===== Ядро: реестр модулей/интеграций, роутер, контекст, командная палитра ===== */
window.SensorApp = (function () {
  const modules = [];
  const integrations = [];
  const commands = [];          // глобальные быстрые действия (палитра)
  let current = null;

  const env = (navigator.userAgent.indexOf('Electron') >= 0) ? 'desktop' : 'web';
  const CFG = window.SUITE_CONFIG || {};
  const ROLES = window.SUITE_ROLES || { defaultRole:'manager', order:['manager'], labels:{}, modules:{ manager:null } };

  function register(m){ if(!m||!m.id) return; modules.push(m); }
  function registerIntegration(i){ if(!i||!i.id) return; integrations.push(i); }
  // registerCommand({id,title,hint?,icon?,group?,keywords?,run(ctx)}) — добавить действие в палитру
  function registerCommand(c){ if(!c||!c.id||typeof c.run!=='function') return; commands.push(c); }

  /* ---------- роли (режимы доступа) ---------- */
  function getRole(){
    const r = SensorStore.get('role', null);
    if (r && ROLES.modules && (r in ROLES.modules)) return r;
    return ROLES.defaultRole || 'manager';
  }
  function setRole(r){
    if (!r || !ROLES.modules || !(r in ROLES.modules)) return;
    SensorStore.set('role', r);
    rebuildNav();           // мгновенно перестроить навигацию под новую роль
    // если текущий модуль роли больше не доступен — мягко перейти на первый доступный
    const cur = current && current.id;
    if (cur && !moduleById(cur)) { navigate(firstId()); }
    else route();           // перерисовать активный пункт/палитру под новый набор
    // [role:change] аддитивное document-событие (как 'theme:change' в setTheme):
    // позволяет внешним модулям (Настройки) живо синхронизировать подсветку роли,
    // даже когда смена пришла извне их экрана (например из тура онбординга).
    document.dispatchEvent(new CustomEvent('role:change', { detail:{ role: r } }));
  }
  // белый список модулей для роли ('settings' всегда добавляется), либо null = все
  function roleAllowedIds(){
    const list = ROLES.modules ? ROLES.modules[getRole()] : null;
    if (!Array.isArray(list)) return null; // null = роль не ограничивает
    const set = new Set(list);
    set.add('settings');
    return set;
  }

  /* ---------- какие модули включены в этой сборке ---------- */
  // приоритет фильтра сборки: ?dept=a,b   >   SUITE_CONFIG.enabledModules   >   все.
  // Итог — ПЕРЕСЕЧЕНИЕ фильтра сборки и фильтра роли (оба опциональны).
  function buildAllowedIds(){
    let list = null;
    try {
      const q = new URLSearchParams(location.search).get('dept');
      if (q) list = q.split(',').map(s=>s.trim()).filter(Boolean);
    } catch(e){}
    if (!list && Array.isArray(CFG.enabledModules)) list = CFG.enabledModules.slice();
    if (!list) return null; // null = все
    const set = new Set(list);
    set.add('settings'); // системные модули доступны всегда
    return set;
  }
  function allowedIds(){
    const build = buildAllowedIds();
    const role  = roleAllowedIds();
    if (!build && !role) return null;          // ни сборка, ни роль не ограничивают
    if (!build) return role;
    if (!role)  return build;
    // пересечение: модуль виден, если разрешён И сборкой, И ролью
    const set = new Set([...build].filter(id => role.has(id)));
    set.add('settings');
    return set;
  }
  function visibleModules(){
    const allow = allowedIds();
    const list = allow ? modules.filter(m=>allow.has(m.id)) : modules.slice();
    return list.length ? list : modules.slice(); // защита от пустого фильтра
  }
  function firstId(){
    const v = visibleModules().filter(m=>m.id!=='settings').sort((a,b)=>(a.order||99)-(b.order||99));
    return (v[0] && v[0].id) || (visibleModules()[0] && visibleModules()[0].id) || 'documents';
  }

  // обёртка интеграции: подставляет креды из store, фолбэк на mock
  function makeIntegration(def){
    return {
      id: def.id, title: def.title, webCapable: def.webCapable, fields: def.fields || [],
      configured(){ return SensorStore.hasCreds(def.id); },
      async run(method, params){
        const creds = SensorStore.creds(def.id);
        const noKeys = !SensorStore.hasCreds(def.id);
        const blockedInWeb = (def.webCapable === false && env === 'web');
        if (noKeys || blockedInWeb){
          const data = def.mock ? def.mock(method, params) : null;
          return { ok:false, mock:true, reason: blockedInWeb ? 'web-blocked' : 'no-keys',
                   note: blockedInWeb ? `${def.title}: доступно только в десктоп-версии (CORS). Показаны демо-данные.`
                                      : `${def.title}: нет ключей (Настройки). Показаны демо-данные.`,
                   data };
        }
        try { const data = await def.call(method, params, creds); return { ok:true, mock:false, data }; }
        catch(e){ return { ok:false, mock:false, error:String(e&&e.message||e),
                           data: def.mock?def.mock(method,params):null }; }
      },
      async test(){ const creds = SensorStore.creds(def.id);
        if(!SensorStore.hasCreds(def.id)) return {ok:false, detail:'нет ключей'};
        try { return await def.test(creds); } catch(e){ return {ok:false, detail:String(e&&e.message||e)}; } }
    };
  }

  function ctx(){
    const wrapped = {};
    integrations.forEach(d => wrapped[d.id] = makeIntegration(d));
    return { store: SensorStore, toast: SensorUI.toast, ui: SensorUI, env,
             integrations: wrapped, integrationDefs: integrations, data: window.SEED || {},
             go: navigate, app: SensorApp };
  }

  // сколько интеграций сейчас отдают демо-данные (нет ключей или web-blocked)
  function demoIntegrations(){
    return integrations.filter(def=>{
      const noKeys = !SensorStore.hasCreds(def.id);
      const blockedInWeb = (def.webCapable === false && env === 'web');
      return noKeys || blockedInWeb;
    });
  }

  function buildNav(){
    const nav = document.getElementById('nav');
    const groups = {};
    visibleModules().filter(m=>m.id!=='settings').forEach(m=>{ (groups[m.dept||'Прочее'] ||= []).push(m); });
    let html = '';
    Object.keys(groups).forEach(dept=>{
      html += `<div class="nav-group"><h6>${SensorUI.escape(dept)}</h6>`;
      groups[dept].sort((a,b)=>(a.order||99)-(b.order||99)).forEach(m=>{
        html += `<div class="nav-item" data-id="${m.id}" title="${SensorUI.escape(m.description||m.title)}"><span class="ic">${m.icon||'•'}</span><span>${SensorUI.escape(m.title)}</span></div>`;
      });
      html += `</div>`;
    });
    nav.innerHTML = html;
    nav.querySelectorAll('.nav-item').forEach(it=>it.onclick=()=>navigate(it.dataset.id));
  }

  /* ---------- навигация и память маршрута ---------- */
  function navigate(id){ location.hash = '#/' + id; }

  function moduleById(id){ return visibleModules().find(x=>x.id===id); }

  function route(){
    const raw = location.hash.replace(/^#\//,'');
    const id = raw || SensorStore.get('lastRoute', '') || firstId();
    let m = moduleById(id) || moduleById(SensorStore.get('lastRoute','')) || moduleById(firstId());
    if(!m){ m = visibleModules()[0]; }
    if(!m) return;
    if (raw !== m.id){ location.hash = '#/'+m.id; return; } // нормализуем
    SensorStore.set('lastRoute', m.id);

    const view = document.getElementById('view');
    if (current && current.unmount) { try{ current.unmount(view); }catch(e){} }
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.id===m.id));
    document.getElementById('page-title').textContent = m.title;
    document.getElementById('page-sub').textContent = m.description || '';
    updateBreadcrumb(m);
    view.innerHTML = '';
    view.scrollTop = 0;
    current = m;
    try { m.mount(view, ctx()); } catch(e){ view.innerHTML = SensorUI.empty('⚠️','Ошибка модуля: '+SensorUI.escape(e.message)); console.error(e); }
    // a11y: иерархия заголовков h1(топбар) → h2(модуль) → h3(карточки) без скачка
    // уровней. h2 скрыт визуально, нужен только для скринридеров (axe: heading-order).
    if (!view.querySelector('h2.sr-only[data-mod-heading]')) {
      const h2 = document.createElement('h2');
      h2.className = 'sr-only';
      h2.setAttribute('data-mod-heading', '');
      h2.textContent = m.title;
      view.insertBefore(h2, view.firstChild);
    }
  }

  function updateBreadcrumb(m){
    const bc = document.getElementById('breadcrumb');
    if(!bc) return;
    const dept = m.dept || 'Прочее';
    bc.innerHTML = (m.id==='settings')
      ? `<span class="bc-seg">Система</span><span class="bc-sep">/</span><span class="bc-seg cur">${SensorUI.escape(m.title)}</span>`
      : `<span class="bc-seg">${SensorUI.escape(dept)}</span><span class="bc-sep">/</span><span class="bc-seg cur">${SensorUI.escape(m.title)}</span>`;
  }

  /* ---------- индикатор «демо-данные» ---------- */
  function updateDemoBadge(){
    const wrap = document.getElementById('demo-indicator');
    if(!wrap) return;
    const demo = demoIntegrations();
    if(!demo.length){ wrap.style.display='none'; wrap.innerHTML=''; return; }
    wrap.style.display='';
    wrap.title = 'Демо-данные у интеграций: ' + demo.map(d=>d.title).join(', ') + '. Введите ключи в Настройках.';
    wrap.innerHTML = `<span class="demo-dot"></span>демо-данные · ${demo.length}`;
    wrap.onclick = ()=>navigate('settings');
  }

  /* ---------- фаззи-поиск ---------- */
  // лёгкий subsequence-матч с весами: подряд > начало слова > позиция
  function fuzzy(query, text){
    query = (query||'').toLowerCase().trim();
    text = (text||'').toLowerCase();
    if(!query) return { score: 0, hit: true };
    let qi=0, score=0, run=0, prevIdx=-2;
    for(let i=0;i<text.length && qi<query.length;i++){
      if(text[i]===query[qi]){
        let s = 1;
        if(i===prevIdx+1){ run++; s += run*2; } else run=0;
        if(i===0 || /[\s/·.,()\-]/.test(text[i-1])) s += 3; // начало слова
        score += s; prevIdx=i; qi++;
      }
    }
    if(qi<query.length){
      // запасной вариант: подстрока (для кириллицы/опечаток порядка)
      const idx = text.indexOf(query);
      if(idx>=0) return { score: 6 + (idx===0?4:0), hit:true };
      return { score: 0, hit:false };
    }
    score += Math.max(0, 12 - text.length*0.05); // короткие совпадения чуть выше
    return { score, hit:true };
  }

  // полный набор записей палитры: модули + их быстрые действия + глобальные команды
  function paletteEntries(){
    const out = [];
    visibleModules().forEach(m=>{
      out.push({
        kind:'module', id:m.id, title:m.title, group:m.dept||'Прочее',
        hint:m.description||'', icon:m.icon||'•',
        keywords:[m.id, m.dept, m.description, (m.keywords||[]).join(' ')].filter(Boolean).join(' '),
        run:()=>navigate(m.id)
      });
      // модуль может объявить свои действия: actions:[{id,title,hint?,run(ctx)}]
      (m.actions||[]).forEach(a=>{
        if(!a||!a.title) return;
        out.push({
          kind:'action', id:m.id+':'+(a.id||a.title), title:a.title, group:m.title,
          hint:a.hint||'', icon:a.icon||'⚡',
          keywords:[m.title, a.title, a.hint, (a.keywords||[]).join(' ')].filter(Boolean).join(' '),
          run:()=>{ navigate(m.id); if(typeof a.run==='function'){ setTimeout(()=>{ try{a.run(ctx());}catch(e){console.error(e);} },60); } }
        });
      });
    });
    commands.forEach(c=>{
      out.push({
        kind:'action', id:'cmd:'+c.id, title:c.title, group:c.group||'Действия',
        hint:c.hint||'', icon:c.icon||'⚡',
        keywords:[c.title, c.hint, (c.keywords||[]).join(' ')].filter(Boolean).join(' '),
        run:()=>{ try{c.run(ctx());}catch(e){console.error(e);} }
      });
    });
    return out;
  }

  /* ---------- командная палитра ---------- */
  let palette = null;
  function openPalette(){
    if(palette) return;
    const entries = paletteEntries();
    const bg = document.createElement('div');
    bg.className = 'cmdk-bg';
    bg.innerHTML =
      `<div class="cmdk" role="dialog" aria-modal="true" aria-label="Командная палитра">
         <div class="cmdk-head">
           <span class="cmdk-ic" aria-hidden="true">⌕</span>
           <input class="cmdk-input" type="text" placeholder="Перейти к модулю или действию…" autocomplete="off" spellcheck="false" aria-label="Поиск по модулям и действиям"/>
           <span class="kbd cmdk-esc">esc</span>
         </div>
         <div class="cmdk-list" role="listbox"></div>
         <div class="cmdk-foot"><span><span class="kbd">↑</span><span class="kbd">↓</span> навигация</span><span><span class="kbd">↵</span> открыть</span><span class="cmdk-count"></span></div>
       </div>`;
    document.body.appendChild(bg);
    requestAnimationFrame(()=>bg.classList.add('show'));
    const input = bg.querySelector('.cmdk-input');
    const list = bg.querySelector('.cmdk-list');
    const count = bg.querySelector('.cmdk-count');
    let results = [], sel = 0;

    function render(){
      const q = input.value;
      results = entries
        .map(e=>{ const a=fuzzy(q, e.title), b=fuzzy(q, e.keywords); const hit=a.hit||b.hit;
                  return { e, score: Math.max(a.score, b.score*0.7), hit }; })
        .filter(r=>r.hit)
        .sort((x,y)=> y.score-x.score || x.e.title.localeCompare(y.e.title,'ru'))
        .slice(0, 40)
        .map(r=>r.e);
      if(sel>=results.length) sel = Math.max(0, results.length-1);
      if(!results.length){
        list.innerHTML = `<div class="cmdk-empty">${SensorUI.escape('Ничего не найдено по запросу «'+q+'»')}</div>`;
        count.textContent=''; return;
      }
      // группировка с сохранением порядка по релевантности
      const seen = new Set(); const order = []; const byGroup = {};
      results.forEach(e=>{ if(!byGroup[e.group]){ byGroup[e.group]=[]; order.push(e.group); } byGroup[e.group].push(e); });
      let html=''; let flat=[];
      order.forEach(g=>{
        html += `<div class="cmdk-group">${SensorUI.escape(g)}</div>`;
        byGroup[g].forEach(e=>{
          const i = flat.length; flat.push(e);
          html += `<div class="cmdk-item${i===sel?' active':''}" data-i="${i}" role="option" aria-selected="${i===sel}">
                     <span class="cmdk-item-ic">${e.icon}</span>
                     <span class="cmdk-item-main"><span class="cmdk-item-title">${SensorUI.escape(e.title)}</span>${e.hint?`<span class="cmdk-item-hint">${SensorUI.escape(e.hint)}</span>`:''}</span>
                     <span class="cmdk-item-kind">${e.kind==='module'?'модуль':'действие'}</span>
                   </div>`;
        });
      });
      list.innerHTML = html;
      results = flat;
      count.textContent = results.length + (q?'':' пунктов');
      list.querySelectorAll('.cmdk-item').forEach(it=>{
        it.onmousemove = ()=>{ const i=+it.dataset.i; if(i!==sel){ sel=i; paintSel(); } };
        it.onclick = ()=>choose();
      });
      scrollToSel();
    }
    function paintSel(){
      list.querySelectorAll('.cmdk-item').forEach(it=>{
        const on = +it.dataset.i===sel; it.classList.toggle('active', on); it.setAttribute('aria-selected', on);
      });
    }
    function scrollToSel(){
      const el = list.querySelector('.cmdk-item.active'); if(el && el.scrollIntoView) el.scrollIntoView({block:'nearest'});
    }
    function move(d){ if(!results.length) return; sel=(sel+d+results.length)%results.length; paintSel(); scrollToSel(); }
    function choose(){ const e=results[sel]; if(!e) return; close(); e.run(); }

    input.addEventListener('input', ()=>{ sel=0; render(); });
    input.addEventListener('keydown', e=>{
      if(e.key==='ArrowDown'){ e.preventDefault(); move(1); }
      else if(e.key==='ArrowUp'){ e.preventDefault(); move(-1); }
      else if(e.key==='Enter'){ e.preventDefault(); choose(); }
      else if(e.key==='Escape'){ e.preventDefault(); close(); }
    });
    bg.addEventListener('mousedown', e=>{ if(e.target===bg) close(); });
    function close(){
      if(!palette) return; palette=null;
      bg.classList.remove('show');
      setTimeout(()=>bg.remove(),140);
    }
    palette = { close };
    render();
    input.focus();
  }
  function togglePalette(){ palette ? palette.close() : openPalette(); }

  /* ---------- шпаргалка горячих клавиш («?») ---------- */
  let shortcutsOpen = false;
  function openShortcuts(){
    if (shortcutsOpen) return;
    const kbd = s => `<span class="kbd">${SensorUI.escape(s)}</span>`;
    const themeName = { light:'светлая', dark:'тёмная', auto:'системная' }[themePref()] || 'светлая';
    const rows = [
      { keys: ['⌘ K','Ctrl K'],   label: 'Командная палитра — переход к модулю или действию' },
      { keys: ['/'],              label: 'Открыть поиск (командную палитру)' },
      { keys: ['↑','↓'],          label: 'Навигация по списку в палитре' },
      { keys: ['↵'],              label: 'Открыть выбранный пункт палитры' },
      { keys: ['?'],              label: 'Эта шпаргалка горячих клавиш' },
      { keys: ['Esc'],            label: 'Закрыть палитру, модальное окно или эту шпаргалку' }
    ];
    const list = rows.map(r =>
      `<div class="ks-row"><div class="ks-keys">${r.keys.map(kbd).join('<span class="ks-or">или</span>')}</div>`+
      `<div class="ks-label">${SensorUI.escape(r.label)}</div></div>`).join('');
    // переключение темы и навигация по модулям описаны отдельным блоком (без жёсткой клавиши)
    const navList = visibleModules().filter(m=>m.id!=='settings')
      .map(m=>SensorUI.escape(m.title)).join(' · ');
    const extra =
      `<div class="ks-note">
         <p><strong>Тема.</strong> Тумблер «◐ Тема» в левой панели переключает светлую/тёмную. Режим (светлая / тёмная / системная, сейчас — ${SensorUI.escape(themeName)}) задаётся в Настройках → Оформление.</p>
         <p><strong>Навигация.</strong> Слева — модули, доступные текущему режиму. Откройте палитру (${kbd('⌘ K')}) и начните печатать название модуля${navList?`: ${navList}.`:'.'}</p>
       </div>`;
    const m = SensorUI.modal('Горячие клавиши',
      `<div class="ks-list">${list}</div>${extra}`);
    shortcutsOpen = true;
    m.el.addEventListener('modal:close', ()=>{ shortcutsOpen = false; });
  }

  /* ---------- приветственный тур (онбординг) ----------
     Серия шагов в переиспользуемой модалке (SensorUI.modal): «Назад/Далее/
     Пропустить/Готово» + индикатор шага. Шаг «Режим» позволяет выбрать роль
     прямо в туре. «Пропустить»/«Готово»/Esc/клик по фону → ставим store-флаг
     'onboarded' (больше не показывать).

     ГЕЙТ ПЕРВОГО ПОКАЗА (чтобы не валить тесты):
       — не показываем в jsdom (UA содержит 'jsdom' — smoke/modules и т.п.);
       — не показываем под автоматизацией (navigator.webdriver — Playwright e2e/a11y/perf);
       — не показываем, если localStorage недоступен/непишущий;
       — уважаем SUITE_CONFIG.disableOnboarding и ?onboarding=off (выкл) / ?onboarding=on (форс).
     В реальном браузере при первом запуске (нет флага 'onboarded') тур всплывает. */
  const OB = (typeof window!=='undefined' && window.SUITE_ONBOARDING) || null;
  let tour = null;

  function onboardingUrlFlag(){
    try { return new URLSearchParams(location.search).get('onboarding'); } catch(e){ return null; }
  }
  function localStorageWritable(){
    try {
      const k = '__ob_probe__';
      window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k);
      return true;
    } catch(e){ return false; }
  }
  function isAutomation(){
    try {
      if (navigator.webdriver) return true;                          // Playwright/WebDriver
      if (/\bjsdom\b/i.test(navigator.userAgent || '')) return true; // jsdom (smoke/modules)
    } catch(e){}
    return false;
  }
  function onboardingDone(){ return !!SensorStore.get((OB&&OB.storeKey)||'onboarded', false); }
  function markOnboarded(){ SensorStore.set((OB&&OB.storeKey)||'onboarded', true); }

  // решение об авто-показе при старте
  function shouldAutoShowOnboarding(){
    if (!OB || !Array.isArray(OB.steps) || !OB.steps.length) return false;
    const url = onboardingUrlFlag();
    if (url === 'on')  return true;                 // явный форс (демо/скриншоты)
    if (url === 'off') return false;                // явное выключение
    if (CFG.disableOnboarding) return false;        // выключено в сборке
    if (isAutomation()) return false;               // не мешаем тестам
    if (!localStorageWritable()) return false;      // негде запомнить «больше не показывать»
    return !onboardingDone();
  }

  // мини-ctx с данными для контента шагов (тексты подстраиваются под сборку/режим)
  function onboardingData(){
    const esc = SensorUI.escape;
    const role = getRole();
    const byDept = {};
    visibleModules().filter(m=>m.id!=='settings')
      .sort((a,b)=>(a.order||99)-(b.order||99))
      .forEach(m=>{ (byDept[m.dept||'Прочее'] ||= []).push(m); });
    return {
      esc, env,
      role,
      roleLabels: (ROLES.labels)||{},
      roleOrder: Array.isArray(ROLES.order)&&ROLES.order.length ? ROLES.order : Object.keys(ROLES.modules||{manager:null}),
      modulesByDept: byDept,
      integrations: integrations.slice()
    };
  }

  // встроить живой сегмент-контрол ролей в шаг «Режим» (если слот присутствует)
  function mountTourRoleControl(body){
    const slot = body.querySelector('#ob-role-slot');
    if (!slot) return;
    const data = onboardingData();
    const order = data.roleOrder;
    const cur = getRole();
    slot.innerHTML =
      `<div class="role-seg ob-role-seg" role="group" aria-label="Режим работы">` +
      order.map(id=>{
        const label = (ROLES.labels && ROLES.labels[id]) || id;
        return `<button type="button" class="role-opt${id===cur?' active':''}" data-ob-role="${SensorUI.escape(id)}" aria-pressed="${id===cur?'true':'false'}">${SensorUI.escape(label)}</button>`;
      }).join('') +
      `</div>`;
    slot.querySelectorAll('[data-ob-role]').forEach(btn=>{
      btn.onclick = ()=>{
        const r = btn.dataset.obRole;
        setRole(r);                       // мгновенно перестраивает навигацию
        slot.querySelectorAll('[data-ob-role]').forEach(x=>{
          const on = x===btn; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on?'true':'false');
        });
        const curEl = body.querySelector('#ob-role-current');
        if (curEl) curEl.textContent = (ROLES.labels && ROLES.labels[r]) || r;
      };
    });
  }

  function openOnboarding(){
    if (tour || !OB || !Array.isArray(OB.steps) || !OB.steps.length) return;
    const steps = OB.steps;
    let i = 0;
    let finished = false;

    const m = SensorUI.modal('Знакомство с Сенсор Suite', '');
    m.el.classList.add('onboarding-modal');
    // тур закрывается по Esc/фону → трактуем как «Пропустить»
    m.el.addEventListener('modal:close', ()=>{ if(!finished){ markOnboarded(); } tour = null; });

    function render(){
      const step = steps[i];
      const data = onboardingData();
      let bodyHTML = '';
      try { bodyHTML = (typeof step.body==='function') ? step.body(data) : (step.body||''); }
      catch(e){ bodyHTML = '<p class="ob-note">Не удалось отобразить шаг.</p>'; console.error(e); }
      const isFirst = i===0, isLast = i===steps.length-1;
      const dots = steps.map((s,idx)=>
        `<span class="ob-dot${idx===i?' on':''}${idx<i?' done':''}" aria-hidden="true"></span>`).join('');

      m.body.innerHTML =
        `<div class="ob-step" data-step="${SensorUI.escape(step.id)}">` +
          `<div class="ob-head"><span class="ob-step-ic" aria-hidden="true">${step.icon||'•'}</span>` +
            `<h4 class="ob-title">${SensorUI.escape(step.title)}</h4></div>` +
          `<div class="ob-body">${bodyHTML}</div>` +
        `</div>` +
        `<div class="ob-foot">` +
          `<div class="ob-progress" role="group" aria-label="Прогресс тура">${dots}` +
            `<span class="ob-count" aria-live="polite">Шаг ${i+1} из ${steps.length}</span></div>` +
          `<div class="ob-actions">` +
            `<button type="button" class="btn ghost sm" data-ob="skip">Пропустить</button>` +
            (isFirst ? '' : `<button type="button" class="btn sm" data-ob="back">← Назад</button>`) +
            (isLast
              ? `<button type="button" class="btn primary sm" data-ob="done">Готово</button>`
              : `<button type="button" class="btn primary sm" data-ob="next">Далее →</button>`) +
          `</div>` +
        `</div>`;

      // обновим доступное имя диалога под текущий шаг
      const dlg = m.el.querySelector('.modal');
      if (dlg){
        dlg.setAttribute('aria-label', step.title + ' · шаг ' + (i+1) + ' из ' + steps.length);
        const h = dlg.querySelector('h3'); if (h) h.textContent = 'Знакомство с Сенсор Suite';
      }

      if (step.kind==='role') mountTourRoleControl(m.body);

      const main = (isLast ? m.body.querySelector('[data-ob="done"]') : m.body.querySelector('[data-ob="next"]'));
      m.body.querySelectorAll('[data-ob]').forEach(btn=>{
        btn.onclick = ()=>{
          const act = btn.dataset.ob;
          if (act==='next'){ if(i<steps.length-1){ i++; render(); } }
          else if (act==='back'){ if(i>0){ i--; render(); } }
          else if (act==='skip'){ finished = true; markOnboarded(); m.close(); }
          else if (act==='done'){ finished = true; markOnboarded(); m.close(); }
        };
      });
      // фокус на основное действие шага (Enter/Space сработают штатно)
      if (main){ try{ main.focus(); }catch(e){} }
    }

    // стрелки ← → листают шаги (когда фокус не в поле ввода внутри тура)
    function onKey(e){
      const t = e.target, tag = t&&t.tagName;
      const typing = tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(t&&t.isContentEditable);
      if (typing) return;
      if (e.key==='ArrowRight'){ if(i<steps.length-1){ e.preventDefault(); i++; render(); } }
      else if (e.key==='ArrowLeft'){ if(i>0){ e.preventDefault(); i--; render(); } }
    }
    m.el.addEventListener('keydown', onKey);

    tour = { close: m.close, el: m.el };
    render();
  }

  // публичный запуск тура заново (Настройки): сбросить флаг и показать с 1-го шага
  function startOnboarding(){ if (tour) return; openOnboarding(); }
  function resetOnboarding(){ SensorStore.set((OB&&OB.storeKey)||'onboarded', false); startOnboarding(); }

  function rebuildNav(){ buildNav(); }

  function bindShortcuts(){
    document.addEventListener('keydown', e=>{
      const meta = e.metaKey || e.ctrlKey;
      const t=e.target, tag=t&&t.tagName;
      const typing = tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || (t&&t.isContentEditable);
      if(meta && (e.key==='k' || e.key==='K')){ e.preventDefault(); togglePalette(); }
      // "/" открывает палитру (поиск), если не в поле ввода
      else if(e.key==='/' && !palette && !typing){ e.preventDefault(); openPalette(); }
      // "?" (Shift+/) — шпаргалка горячих клавиш, если не печатаем и не открыта палитра
      else if(e.key==='?' && !palette && !shortcutsOpen && !typing){ e.preventDefault(); openShortcuts(); }
    });
    const btn = document.getElementById('cmdk-trigger');
    if(btn) btn.onclick = openPalette;
    const search = document.getElementById('global-search');
    if(search){
      const open = ()=>openPalette();
      search.addEventListener('focus', open);
      search.addEventListener('click', open);
    }
    // пункт «Горячие клавиши» в командной палитре
    registerCommand({
      id:'shortcuts', title:'Горячие клавиши', hint:'Шпаргалка сочетаний (?)',
      icon:'⌨', group:'Справка', keywords:['горячие','клавиши','shortcuts','hotkeys','помощь','справка','keyboard'],
      run:()=>openShortcuts()
    });
    // пункт «Пройти приветственный тур» в командной палитре
    if (OB && Array.isArray(OB.steps) && OB.steps.length){
      registerCommand({
        id:'onboarding', title:'Пройти приветственный тур', hint:'Знакомство с Сенсор Suite заново',
        icon:'🎬', group:'Справка', keywords:['тур','онбординг','onboarding','знакомство','помощь','начать','tour','гайд'],
        run:()=>resetOnboarding()
      });
    }
  }

  /* ---------- тема (light / dark / auto) ----------
     Храним выбор в store('theme') = 'light'|'dark'|'auto'. 'auto' следует системе
     через matchMedia с живой подпиской. data-theme на <html> всегда конкретный
     (light|dark) — стили не знают про 'auto'. #theme-toggle переключает свет/тьму
     и при этом фиксирует явный выбор (выходя из auto). */
  let mql = null, mqlHandler = null;
  function systemTheme(){
    try { return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'; }
    catch(e){ return 'light'; }
  }
  // сохранённый выбор пользователя: 'light'|'dark'|'auto' (или дефолт сборки)
  function themePref(){
    let t = SensorStore.get('theme', null);
    if (t==='light'||t==='dark'||t==='auto') return t;
    return (CFG.forceTheme==='dark'||CFG.forceTheme==='light') ? CFG.forceTheme : 'light';
  }
  // вычислить конкретную тему для data-theme из выбора
  function resolvedTheme(pref){
    pref = pref || themePref();
    return pref==='auto' ? systemTheme() : pref;
  }
  function applyTheme(){
    document.documentElement.setAttribute('data-theme', resolvedTheme());
  }
  // подписка/отписка на смену системной темы — активна только в режиме 'auto'
  function syncSystemSubscription(){
    const auto = themePref()==='auto';
    try {
      if (auto && window.matchMedia){
        if (!mql){
          mql = window.matchMedia('(prefers-color-scheme: dark)');
          mqlHandler = ()=>{ if (themePref()==='auto') applyTheme(); };
          if (mql.addEventListener) mql.addEventListener('change', mqlHandler);
          else if (mql.addListener) mql.addListener(mqlHandler); // старые браузеры
        }
      } else if (mql){
        if (mql.removeEventListener) mql.removeEventListener('change', mqlHandler);
        else if (mql.removeListener) mql.removeListener(mqlHandler);
        mql = null; mqlHandler = null;
      }
    } catch(e){}
  }
  // публичный сеттер темы (используют Настройки): принимает 'light'|'dark'|'auto'
  function setTheme(pref){
    if (pref!=='light' && pref!=='dark' && pref!=='auto') return;
    SensorStore.set('theme', pref);
    applyTheme();
    syncSystemSubscription();
    document.dispatchEvent(new CustomEvent('theme:change', { detail:{ pref, resolved: resolvedTheme(pref) } }));
  }
  function getThemePref(){ return themePref(); }
  function theme(){
    applyTheme();
    syncSystemSubscription();
    const toggle = document.getElementById('theme-toggle');
    // тумблер в сайдбаре: переключает свет↔тьму от ТЕКУЩЕЙ отображаемой темы и
    // фиксирует явный выбор (выходит из 'auto'), затем синхронизируется с настройкой
    if(toggle) toggle.onclick = ()=>{
      const cur = document.documentElement.getAttribute('data-theme')==='dark' ? 'dark' : 'light';
      setTheme(cur==='dark' ? 'light' : 'dark');
    };
  }

  function applyBrand(){
    const sub = CFG.brandSubtitle;
    if(sub){ const el=document.querySelector('.brand small'); if(el) el.textContent = sub; }
    // пер-отдел сборка: показать какой отдел активен в бейдже
    const allow = allowedIds();
    if(allow){
      const only = [...allow].filter(x=>x!=='settings');
      if(only.length===1){ const m=moduleById(only[0]); const el=document.querySelector('.brand small');
        if(m && el && !sub) el.textContent = 'сборка: '+m.title; }
    }
  }

  function start(){
    const eb = document.getElementById('env-badge'); if(eb) eb.textContent = env === 'desktop' ? 'desktop' : 'web';
    theme(); buildNav(); applyBrand(); updateDemoBadge(); bindShortcuts();
    window.addEventListener('hashchange', route);
    if(!location.hash){ const last = SensorStore.get('lastRoute',''); location.hash = '#/'+((last && moduleById(last))?last:firstId()); }
    route();
    // приветственный тур — только при первом запуске и вне тестовой среды (см. гейт)
    if (shouldAutoShowOnboarding()){
      // даём оболочке дорисоваться (requestAnimationFrame есть и в jsdom-shim)
      const raf = (typeof requestAnimationFrame==='function') ? requestAnimationFrame : (cb)=>setTimeout(cb,0);
      raf(()=>{ try{ openOnboarding(); }catch(e){ console.error(e); } });
    }
  }

  return { env, register, registerIntegration, registerCommand, start,
           openPalette, openShortcuts, navigate, refreshDemoBadge: updateDemoBadge,
           getRole, setRole, roles: ROLES, rebuildNav,
           setTheme, getThemePref,
           startOnboarding, resetOnboarding, onboardingDone,
           _modules:modules, _integrations:integrations, _commands:commands };
})();

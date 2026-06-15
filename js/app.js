/* ===== Ядро: реестр модулей/интеграций, роутер, контекст, командная палитра ===== */
window.SensorApp = (function () {
  const modules = [];
  const integrations = [];
  const commands = [];          // глобальные быстрые действия (палитра)
  let current = null;

  const env = (navigator.userAgent.indexOf('Electron') >= 0) ? 'desktop' : 'web';
  const CFG = window.SUITE_CONFIG || {};

  function register(m){ if(!m||!m.id) return; modules.push(m); }
  function registerIntegration(i){ if(!i||!i.id) return; integrations.push(i); }
  // registerCommand({id,title,hint?,icon?,group?,keywords?,run(ctx)}) — добавить действие в палитру
  function registerCommand(c){ if(!c||!c.id||typeof c.run!=='function') return; commands.push(c); }

  /* ---------- какие модули включены в этой сборке ---------- */
  // приоритет: ?dept=a,b   >   SUITE_CONFIG.enabledModules   >   все
  function allowedIds(){
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

  function bindShortcuts(){
    document.addEventListener('keydown', e=>{
      const meta = e.metaKey || e.ctrlKey;
      if(meta && (e.key==='k' || e.key==='K')){ e.preventDefault(); togglePalette(); }
      // "/" фокусирует глобальный поиск, если не в поле ввода
      else if(e.key==='/' && !palette){
        const t=e.target, tag=t&&t.tagName;
        if(tag!=='INPUT' && tag!=='TEXTAREA' && !(t&&t.isContentEditable)){ e.preventDefault(); openPalette(); }
      }
    });
    const btn = document.getElementById('cmdk-trigger');
    if(btn) btn.onclick = openPalette;
    const search = document.getElementById('global-search');
    if(search){
      const open = ()=>openPalette();
      search.addEventListener('focus', open);
      search.addEventListener('click', open);
    }
  }

  function theme(){
    let t = SensorStore.get('theme', null);
    if(t==null) t = (CFG.forceTheme==='dark'||CFG.forceTheme==='light') ? CFG.forceTheme : 'light';
    document.documentElement.setAttribute('data-theme', t);
    const toggle = document.getElementById('theme-toggle');
    if(toggle) toggle.onclick = ()=>{
      const n = (document.documentElement.getAttribute('data-theme')==='light')?'dark':'light';
      SensorStore.set('theme',n); document.documentElement.setAttribute('data-theme',n);
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
  }

  return { env, register, registerIntegration, registerCommand, start,
           openPalette, navigate, refreshDemoBadge: updateDemoBadge,
           _modules:modules, _integrations:integrations, _commands:commands };
})();

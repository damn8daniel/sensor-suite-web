/* ===== Ядро: реестр модулей/интеграций, роутер, контекст ===== */
window.SensorApp = (function () {
  const modules = [];
  const integrations = [];
  let current = null;

  const env = (navigator.userAgent.indexOf('Electron') >= 0) ? 'desktop' : 'web';

  function register(m){ if(!m||!m.id) return; modules.push(m); }
  function registerIntegration(i){ if(!i||!i.id) return; integrations.push(i); }

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
             integrations: wrapped, integrationDefs: integrations, data: window.SEED || {} };
  }

  function buildNav(){
    const nav = document.getElementById('nav');
    const groups = {};
    modules.filter(m=>m.id!=='settings').forEach(m=>{ (groups[m.dept||'Прочее'] ||= []).push(m); });
    let html = '';
    Object.keys(groups).forEach(dept=>{
      html += `<div class="nav-group"><h6>${SensorUI.escape(dept)}</h6>`;
      groups[dept].sort((a,b)=>(a.order||99)-(b.order||99)).forEach(m=>{
        html += `<div class="nav-item" data-id="${m.id}"><span class="ic">${m.icon||'•'}</span><span>${SensorUI.escape(m.title)}</span></div>`;
      });
      html += `</div>`;
    });
    nav.innerHTML = html;
    nav.querySelectorAll('.nav-item').forEach(it=>it.onclick=()=>location.hash='#/'+it.dataset.id);
  }

  function route(){
    const id = (location.hash.replace(/^#\//,'') || (modules[0]&&modules[0].id) || 'documents');
    const m = modules.find(x=>x.id===id) || modules[0];
    if(!m) return;
    const view = document.getElementById('view');
    if (current && current.unmount) { try{ current.unmount(view); }catch(e){} }
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.id===m.id));
    document.getElementById('page-title').textContent = m.title;
    document.getElementById('page-sub').textContent = m.description || '';
    view.innerHTML = '';
    current = m;
    try { m.mount(view, ctx()); } catch(e){ view.innerHTML = SensorUI.empty('⚠️','Ошибка модуля: '+SensorUI.escape(e.message)); console.error(e); }
  }

  function theme(){
    const t = SensorStore.get('theme','light');
    document.documentElement.setAttribute('data-theme', t);
    document.getElementById('theme-toggle').onclick = ()=>{
      const n = (SensorStore.get('theme','light')==='light')?'dark':'light';
      SensorStore.set('theme',n); document.documentElement.setAttribute('data-theme',n);
    };
  }

  function start(){
    document.getElementById('env-badge').textContent = env === 'desktop' ? 'desktop' : 'web';
    theme(); buildNav();
    window.addEventListener('hashchange', route);
    if(!location.hash) location.hash = '#/'+((modules[0]&&modules[0].id)||'documents');
    route();
  }

  return { env, register, registerIntegration, start, _modules:modules, _integrations:integrations };
})();

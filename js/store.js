/* ===== Хранилище настроек и кредов (localStorage) ===== */
window.SensorStore = (function () {
  const KEY = 'sensor_suite_v1';
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { s = {}; }
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){} }
  return {
    get(k, def){ return (k in s) ? s[k] : def; },
    set(k, v){ s[k] = v; save(); },
    creds(id){ return (s.creds && s.creds[id]) || {}; },
    setCreds(id, obj){ s.creds = s.creds || {}; s.creds[id] = obj; save(); },
    hasCreds(id){ const c = (s.creds && s.creds[id]) || {}; return Object.values(c).some(v=>v && String(v).trim()); },
    all(){ return s; }
  };
})();

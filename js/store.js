/* ===== Хранилище настроек и кредов (localStorage) ===== */
window.SensorStore = (function () {
  const KEY = 'sensor_suite_v1';
  // Служебные ключи бэкапа живут внутри s, но НЕ видны через all()/get():
  //   __backups      — кольцевой буфер снимков [{ts, data}], FIFO, не длиннее MAX.
  //   __lastBackupTs  — отметка последнего авто-бэкапа (троттлинг).
  const BK = '__backups';
  const LAST = '__lastBackupTs';
  const MAX = 5;            // глубина кольцевого буфера
  const THROTTLE_MS = 60000; // не чаще раза в 60с при авто-вызове
  // Служебные ключи бэкапа никогда не попадают в снимки/all()/get — иначе экспонента и мусор в экспорте.
  const INTERNAL = { [BK]: 1, [LAST]: 1 };

  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { s = {}; }

  function save(){
    backup(); // авто-снимок с троттлингом (см. ниже); сам ничего не бросает
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){}
  }

  // Снимок текущего состояния БЕЗ служебных ключей бэкапа (во избежание рекурсии/экспоненты).
  function snapshot(){
    const out = {};
    for (const k in s){
      if (Object.prototype.hasOwnProperty.call(s, k) && !INTERNAL[k]) {
        out[k] = s[k];
      }
    }
    // глубокая копия, чтобы дальнейшие set() не мутировали уже снятый снимок
    try { return JSON.parse(JSON.stringify(out)); } catch(e){ return out; }
  }

  // Снять снимок в кольцевой буфер. По умолчанию троттлится (раз в THROTTLE_MS);
  // backup(true) форсирует снимок (нужно тестам и явным вызовам).
  function backup(force){
    const now = Date.now();
    if (!force){
      const last = s[LAST] || 0;
      if (now - last < THROTTLE_MS) return false;
    }
    if (!Array.isArray(s[BK])) s[BK] = [];
    s[BK].push({ ts: now, data: snapshot() });
    while (s[BK].length > MAX) s[BK].shift(); // FIFO: вытесняем самый старый
    s[LAST] = now;
    return true;
  }

  // Размер снимка в байтах (по сериализованным данным), для метаданных без раскрытия значений.
  function sizeOf(data){
    try { return JSON.stringify(data).length; } catch(e){ return 0; }
  }

  return {
    get(k, def){ return (k in s) ? s[k] : def; },
    set(k, v){ s[k] = v; save(); },
    creds(id){ return (s.creds && s.creds[id]) || {}; },
    setCreds(id, obj){ s.creds = s.creds || {}; s.creds[id] = obj; save(); },
    hasCreds(id){ const c = (s.creds && s.creds[id]) || {}; return Object.values(c).some(v=>v && String(v).trim()); },
    // all() отдаёт состояние БЕЗ служебных ключей бэкапа — экспорт настроек остаётся чистым.
    all(){
      const out = {};
      for (const k in s){
        if (Object.prototype.hasOwnProperty.call(s, k) && !INTERNAL[k]) out[k] = s[k];
      }
      return out;
    },
    // Снять снимок вручную (force=true игнорирует троттлинг). Возвращает true, если снимок сделан.
    backup(force){ const made = backup(force); if (made) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){} } return made; },
    // Метаданные снимков: ts и размер. Без значений кредов/настроек — только габариты.
    backups(){
      const arr = Array.isArray(s[BK]) ? s[BK] : [];
      return arr.map(b => ({ ts: b.ts, size: sizeOf(b.data) }));
    },
    // Восстановить снимок по ts: заменить состояние (служебные ключи бэкапа сохраняем) и сохранить.
    restore(ts){
      const arr = Array.isArray(s[BK]) ? s[BK] : [];
      const found = arr.find(b => b.ts === ts);
      if (!found) return false;
      let data;
      try { data = JSON.parse(JSON.stringify(found.data)); } catch(e){ data = found.data; }
      const keepBackups = s[BK];
      const keepLast = s[LAST];
      s = {};
      for (const k in data){
        if (Object.prototype.hasOwnProperty.call(data, k) && !INTERNAL[k]) s[k] = data[k];
      }
      s[BK] = keepBackups;   // буфер снимков и троттлинг — сквозные, не теряем историю
      s[LAST] = keepLast;
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){}
      return true;
    }
  };
})();

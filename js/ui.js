/* ===== UI-хелперы (единый визуальный язык) ===== */
window.SensorUI = (function () {
  function escape(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(msg, type){
    const box = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + (type||'');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(()=>{ t.style.opacity='0'; t.style.transition='.3s'; setTimeout(()=>t.remove(),300); }, 3200);
  }
  function modal(title, bodyHTML){
    const titleId = 'mdl_' + Math.random().toString(36).slice(2, 8);
    const bg = document.createElement('div'); bg.className='modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${escape(title)}" aria-labelledby="${titleId}">`+
                   `<button class="modal-x" type="button" aria-label="Закрыть">×</button>`+
                   `<h3 id="${titleId}">${escape(title)}</h3><div class="modal-body"></div></div>`;
    bg.querySelector('.modal-body').innerHTML = bodyHTML || '';
    const dialog = bg.querySelector('.modal');
    const prevFocus = document.activeElement; // вернём фокус после закрытия
    let closed = false;
    bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
    bg.querySelector('.modal-x').addEventListener('click', close);
    // фокус-ловушка: Tab/Shift+Tab по фокусируемым внутри диалога, Esc — закрыть
    function focusables(){
      return [...dialog.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )].filter(el => el.offsetParent !== null || el === document.activeElement);
    }
    function onKey(e){
      if(e.key==='Escape'){ e.stopPropagation(); close(); return; }
      if(e.key==='Tab'){
        const f = focusables();
        if(!f.length){ e.preventDefault(); dialog.focus(); return; }
        const first = f[0], last = f[f.length-1], a = document.activeElement;
        if(e.shiftKey && (a===first || !dialog.contains(a))){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && (a===last || !dialog.contains(a))){ e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(bg);
    requestAnimationFrame(()=>{
      bg.classList.add('show');
      // если вызывающий код (confirm/prompt) уже увёл фокус внутрь — не перебиваем
      if(dialog.contains(document.activeElement)) return;
      // иначе уводим фокус внутрь диалога: первый осмысленный контрол, иначе сам диалог
      const f = focusables();
      const target = f.find(el => !el.classList.contains('modal-x')) || f[0];
      if(target){ try{ target.focus(); }catch(e){} }
      else { dialog.setAttribute('tabindex','-1'); try{ dialog.focus(); }catch(e){} }
    });
    function close(){
      if(closed) return; closed = true;
      document.removeEventListener('keydown', onKey, true);
      bg.dispatchEvent(new CustomEvent('modal:close'));
      bg.classList.remove('show');
      // вернуть фокус элементу, с которого открыли (если он ещё в DOM)
      if(prevFocus && typeof prevFocus.focus==='function' && document.contains(prevFocus)){
        try{ prevFocus.focus(); }catch(e){}
      }
      setTimeout(()=>bg.remove(), 160);
    }
    return { el: bg, body: bg.querySelector('.modal-body'), close };
  }
  function download(filename, blob){
    if (window.saveAs) return window.saveAs(blob, filename);
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  }
  const spinner = '<span class="spinner"></span>';
  function field(label, inputHTML, tok){
    // a11y: связываем <label> с контролом через for=, если у него есть id —
    // даёт доступное имя для select/input (axe: label / select-name). DOM не меняется.
    const idm = /\sid=["']([^"']+)["']/.exec(inputHTML || '');
    const forAttr = idm ? ` for="${escape(idm[1])}"` : '';
    return `<div class="field"><label${forAttr}>${escape(label)} ${tok?`<span class="tok">${escape(tok)}</span>`:''}</label>${inputHTML}</div>`;
  }
  function card(title, hint, bodyHTML){
    return `<div class="card"><h3>${escape(title)}</h3>${hint?`<p class="hint">${escape(hint)}</p>`:''}${bodyHTML||''}</div>`;
  }
  function empty(emoji, text, actionHTML){
    return `<div class="empty"><div class="big">${emoji||'🗂️'}</div><div class="empty-text">${text||''}</div>${actionHTML?`<div class="empty-action">${actionHTML}</div>`:''}</div>`;
  }

  /* ---------- НОВЫЕ ХЕЛПЕРЫ (только добавление, старые не трогаем) ---------- */

  // badge(text, type) — статусный чип. type: ''|'ok'|'err'|'warn'|'info'|'accent'
  function badge(text, type){
    const cls = type ? ' ' + String(type).split(/\s+/).filter(Boolean).join(' ') : '';
    return `<span class="badge${cls}">${escape(text)}</span>`;
  }

  // skeleton(lines|opts) — плейсхолдеры загрузки. skeleton(3) или skeleton({lines:3,gap:10})
  function skeleton(opts){
    if (typeof opts === 'number') opts = { lines: opts };
    opts = opts || {};
    const lines = opts.lines || 3;
    const out = [];
    for (let i = 0; i < lines; i++){
      const w = opts.widths && opts.widths[i] != null ? opts.widths[i] : (i === lines - 1 ? '62%' : '100%');
      out.push(`<div class="sk-line" style="width:${w}"></div>`);
    }
    return `<div class="skeleton" aria-busy="true" aria-label="Загрузка">${out.join('')}</div>`;
  }

  // table(rows, cols) — декларативная таблица.
  //   cols: [{key,label,align?,mono?,width?,render?(value,row)->html}]  (или массив строк = ключи=заголовки)
  //   rows: [{...}]
  //   opts: {empty:'текст', maxHeight:'320px', dense:false, caption}
  function table(rows, cols, opts){
    opts = opts || {};
    rows = rows || [];
    cols = (cols || []).map(c => typeof c === 'string' ? { key: c, label: c } : c);
    if (!rows.length){
      return empty('🔍', opts.empty || 'Нет данных для отображения.');
    }
    const thead = '<thead><tr>' + cols.map(c => {
      const lbl = c.label != null ? c.label : c.key;
      // a11y: пустой заголовок (например колонка действий) недопустим — даём
      // скрытое доступное имя, визуально ничего не меняется (axe: empty-table-header).
      const inner = (lbl != null && String(lbl).trim() !== '')
        ? escape(lbl)
        : `<span class="sr-only">${escape(c.srLabel || 'Действия')}</span>`;
      return `<th${c.align ? ` style="text-align:${c.align}"` : ''}>${inner}</th>`;
    }).join('') + '</tr></thead>';
    const tbody = '<tbody>' + rows.map(r => '<tr>' + cols.map(c => {
      const raw = r[c.key];
      const html = c.render ? c.render(raw, r) : escape(raw == null ? '' : raw);
      const style = [c.align ? `text-align:${c.align}` : '', c.width ? `width:${c.width}` : ''].filter(Boolean).join(';');
      return `<td class="${c.mono ? 'mono' : ''}"${style ? ` style="${style}"` : ''}>${html}</td>`;
    }).join('') + '</tr>').join('') + '</tbody>';
    const cap = opts.caption ? `<div class="tbl-cap">${escape(opts.caption)}</div>` : '';
    const inner = `<table class="tbl${opts.dense ? ' dense' : ''}">${thead}${tbody}</table>`;
    return cap + (opts.maxHeight ? `<div class="tbl-scroll" style="max-height:${opts.maxHeight}">${inner}</div>` : inner);
  }

  // tabs(items, opts) — табы с переключением. items:[{id,label,render(panel)|html}]
  //   opts:{active, onChange(id), variant:'pill'|'underline', store}  store-ключ запоминает выбор.
  //   Возвращает {el, select(id), active}. Вставлять el в DOM.
  function tabs(items, opts){
    opts = opts || {};
    items = (items || []).filter(Boolean);
    const variant = opts.variant === 'underline' ? 'underline' : 'pill';
    const wrap = document.createElement('div');
    wrap.className = 'tabs-wrap';
    let active = opts.active || (opts.store && SensorStore.get('tabs_' + opts.store)) || (items[0] && items[0].id);
    if (!items.some(i => i.id === active)) active = items[0] && items[0].id;

    const bar = document.createElement('div');
    bar.className = variant === 'underline' ? 'tabs-underline' : 'pill-tabs';
    bar.setAttribute('role', 'tablist');
    const panel = document.createElement('div');
    panel.className = 'tabs-panel';

    function paint(){
      [...bar.children].forEach(b => {
        const on = b.dataset.id === active;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      const it = items.find(i => i.id === active);
      panel.innerHTML = '';
      if (!it) return;
      if (typeof it.render === 'function'){ const r = it.render(panel); if (typeof r === 'string') panel.innerHTML = r; }
      else panel.innerHTML = it.html || '';
    }
    function select(id){
      if (!items.some(i => i.id === id)) return;
      active = id; // backing-переменная; api.active использует тот же active через get/set
      if (opts.store) SensorStore.set('tabs_' + opts.store, id);
      paint();
      if (opts.onChange) opts.onChange(id);
    }
    items.forEach((it, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = variant === 'underline' ? 'tab' : 'pill';
      b.dataset.id = it.id;
      b.setAttribute('role', 'tab');
      b.innerHTML = (it.icon ? `<span class="t-ic">${it.icon}</span>` : '') + escape(it.label != null ? it.label : it.id) +
                    (it.count != null ? ` <span class="t-count">${escape(it.count)}</span>` : '');
      b.onclick = () => select(it.id);
      b.onkeydown = e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
          e.preventDefault();
          const dir = e.key === 'ArrowRight' ? 1 : -1;
          const ni = (idx + dir + items.length) % items.length;
          select(items[ni].id);
          bar.children[ni].focus();
        }
      };
      bar.appendChild(b);
    });
    wrap.appendChild(bar); wrap.appendChild(panel);
    const api = { el: wrap, bar, panel, select, get active(){ return active; }, set active(v){ select(v); } };
    paint();
    return api;
  }

  // confirm(opts|message) -> Promise<boolean>. opts:{title,message,ok,cancel,danger,detail}
  function confirm(opts){
    if (typeof opts === 'string') opts = { message: opts };
    opts = opts || {};
    return new Promise(resolve => {
      const m = modal(opts.title || 'Подтверждение',
        `<p class="modal-msg">${escape(opts.message || 'Вы уверены?')}</p>` +
        (opts.detail ? `<p class="hint" style="margin:-6px 0 14px">${escape(opts.detail)}</p>` : '') +
        `<div class="btn-row" style="justify-content:flex-end;margin-top:6px">
           <button class="btn" data-act="cancel">${escape(opts.cancel || 'Отмена')}</button>
           <button class="btn ${opts.danger ? 'danger' : 'primary'}" data-act="ok">${escape(opts.ok || 'Подтвердить')}</button>
         </div>`);
      let done = false;
      const finish = v => { if (done) return; done = true; m.el.removeEventListener('modal:close', onClose); m.close(); resolve(v); };
      function onClose(){ finish(false); }
      m.el.addEventListener('modal:close', onClose);
      m.body.querySelector('[data-act="ok"]').onclick = () => finish(true);
      m.body.querySelector('[data-act="cancel"]').onclick = () => finish(false);
      const ok = m.body.querySelector('[data-act="ok"]'); if (ok) ok.focus();
    });
  }

  // prompt(opts) -> Promise<string|null>. opts:{title,label,value,placeholder,multiline,ok,cancel,required,hint}
  function prompt(opts){
    if (typeof opts === 'string') opts = { title: opts };
    opts = opts || {};
    return new Promise(resolve => {
      const id = 'pm_' + Math.random().toString(36).slice(2, 8);
      const input = opts.multiline
        ? `<textarea id="${id}" rows="${opts.rows || 4}" placeholder="${escape(opts.placeholder || '')}">${escape(opts.value || '')}</textarea>`
        : `<input id="${id}" type="${opts.type || 'text'}" placeholder="${escape(opts.placeholder || '')}" value="${escape(opts.value || '')}" spellcheck="false">`;
      const m = modal(opts.title || 'Ввод',
        (opts.label ? `<label class="pm-label" for="${id}">${escape(opts.label)}</label>` : '') +
        input +
        (opts.hint ? `<p class="hint" style="margin:8px 0 0">${escape(opts.hint)}</p>` : '') +
        `<div class="btn-row" style="justify-content:flex-end;margin-top:16px">
           <button class="btn" data-act="cancel">${escape(opts.cancel || 'Отмена')}</button>
           <button class="btn primary" data-act="ok">${escape(opts.ok || 'ОК')}</button>
         </div>`);
      const field = m.body.querySelector('#' + id);
      let done = false;
      const finish = v => { if (done) return; done = true; m.el.removeEventListener('modal:close', onClose); m.close(); resolve(v); };
      function onClose(){ finish(null); }
      m.el.addEventListener('modal:close', onClose);
      const submit = () => {
        const v = field.value;
        if (opts.required && !String(v).trim()){ field.classList.add('invalid'); field.focus(); return; }
        finish(v);
      };
      m.body.querySelector('[data-act="ok"]').onclick = submit;
      m.body.querySelector('[data-act="cancel"]').onclick = () => finish(null);
      if (!opts.multiline) field.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); submit(); } });
      field.focus(); field.select && field.select();
    });
  }

  // copy(text, okMsg) — копирование в буфер с тостом. Возвращает Promise<boolean>.
  function copy(text, okMsg){
    const ok = () => { toast(okMsg || 'Скопировано в буфер ✓', 'ok'); return true; };
    const fail = () => { toast('Не удалось скопировать', 'err'); return false; };
    text = String(text == null ? '' : text);
    if (navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text).then(ok, () => legacyCopy(text) ? ok() : fail());
    }
    return Promise.resolve(legacyCopy(text) ? ok() : fail());
  }
  function legacyCopy(text){
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const r = document.execCommand('copy'); ta.remove(); return r;
    } catch (e){ return false; }
  }

  // printDoc(opts) — печать самодостаточного HTML-документа в новом окне.
  //   opts:{ title, subtitle?, bodyHTML, meta?:[{label,value}], footer? }
  //   bodyHTML — уже готовый HTML от вызывающего (он сам экранирует данные).
  //   title/subtitle/meta экранируются здесь через escape().
  //   Если окно не открылось (блокировщик / null) — тост-предупреждение, return false.
  //   Печать (focus+print) обёрнута в try/catch: под jsdom-заглушкой это no-op.
  //   Возвращает true при успешной записи документа.
  function printDoc(opts){
    opts = opts || {};
    const win = (typeof window.open === 'function') ? window.open('', '_blank') : null;
    if (!win){
      toast('Разрешите всплывающие окна для печати', 'warn');
      return false;
    }
    const title = opts.title != null ? String(opts.title) : '';
    const subtitle = opts.subtitle != null ? String(opts.subtitle) : '';
    const dateStr = new Date().toLocaleString('ru-RU');
    const metaRows = (opts.meta || []).filter(Boolean).map(m =>
      `<tr><th>${escape(m.label)}</th><td>${escape(m.value)}</td></tr>`).join('');
    const metaHTML = metaRows
      ? `<table class="pd-meta"><tbody>${metaRows}</tbody></table>` : '';
    const subHTML = subtitle ? `<div class="pd-sub">${escape(subtitle)}</div>` : '';
    const footHTML = opts.footer != null && String(opts.footer) !== ''
      ? `<footer class="pd-foot">${escape(opts.footer)}</footer>` : '';
    const css =
      '*{box-sizing:border-box}' +
      'html,body{margin:0;padding:0}' +
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
        'color:#1a1a1a;line-height:1.5;font-size:14px;background:#fff}' +
      '.pd-page{max-width:760px;margin:0 auto;padding:32px 28px}' +
      '.pd-head{border-bottom:2px solid #1a1a1a;padding-bottom:12px;margin-bottom:18px;' +
        'display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}' +
      '.pd-head-main{min-width:0}' +
      '.pd-title{font-size:22px;font-weight:700;margin:0}' +
      '.pd-sub{font-size:14px;color:#555;margin-top:4px}' +
      '.pd-head-aside{text-align:right;font-size:12px;color:#666;white-space:nowrap}' +
      '.pd-brand{font-weight:600;color:#1a1a1a}' +
      '.pd-meta{border-collapse:collapse;margin:0 0 18px;font-size:13px;width:100%}' +
      '.pd-meta th{text-align:left;font-weight:600;color:#555;padding:3px 14px 3px 0;' +
        'white-space:nowrap;vertical-align:top;width:1%}' +
      '.pd-meta td{padding:3px 0;vertical-align:top}' +
      '.pd-body{font-size:14px}' +
      '.pd-body table{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px}' +
      '.pd-body th,.pd-body td{border:1px solid #ccc;padding:6px 9px;text-align:left;vertical-align:top}' +
      '.pd-body thead th{background:#f2f2f2;font-weight:600}' +
      '.pd-foot{margin-top:24px;padding-top:12px;border-top:1px solid #ccc;font-size:12px;color:#666}' +
      '@page{size:A4;margin:16mm}' +
      '@media print{body{font-size:12pt}.pd-page{max-width:none;margin:0;padding:0}}';
    const html =
      '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
      `<title>${escape(title)}</title><style>${css}</style></head><body>` +
      '<div class="pd-page">' +
        '<header class="pd-head"><div class="pd-head-main">' +
          `<h1 class="pd-title">${escape(title)}</h1>${subHTML}</div>` +
          `<div class="pd-head-aside"><div class="pd-brand">Сенсор</div><div>${escape(dateStr)}</div></div>` +
        '</header>' +
        metaHTML +
        `<div class="pd-body">${opts.bodyHTML || ''}</div>` +
        footHTML +
      '</div></body></html>';
    try {
      const doc = win.document;
      doc.open();
      doc.write(html);
      doc.close();
    } catch (e){ /* запись документа не должна валить вызывающий код */ }
    try {
      win.focus();
      win.print();
    } catch (e){ /* под jsdom-заглушкой focus/print — no-op */ }
    return true;
  }

  // printTable(title, columns, rows, opts?) — собирает простую HTML-таблицу и
  //   зовёт printDoc (реестр / сверки). columns: ['Заголовок', ...] или
  //   [{label, key?, align?}]; rows: массив объектов или массивов значений.
  //   opts пробрасывается в printDoc (subtitle/meta/footer/title переопределяют).
  function printTable(title, columns, rows, opts){
    opts = opts || {};
    columns = (columns || []).map(c => typeof c === 'string' ? { label: c } : (c || {}));
    rows = rows || [];
    const thead = '<thead><tr>' + columns.map(c =>
      `<th${c.align ? ` style="text-align:${escape(c.align)}"` : ''}>${escape(c.label != null ? c.label : c.key)}</th>`
    ).join('') + '</tr></thead>';
    const tbody = '<tbody>' + rows.map(r => '<tr>' + columns.map((c, i) => {
      const v = Array.isArray(r) ? r[i] : (c.key != null ? r[c.key] : undefined);
      return `<td${c.align ? ` style="text-align:${escape(c.align)}"` : ''}>${escape(v == null ? '' : v)}</td>`;
    }).join('') + '</tr>').join('') + '</tbody>';
    const bodyHTML = `<table>${thead}${tbody}</table>`;
    return printDoc(Object.assign({ title: title, bodyHTML: bodyHTML }, opts));
  }

  // debounce(fn, wait) — отложенный вызов; .cancel() и .flush() доступны.
  function debounce(fn, wait){
    wait = wait == null ? 250 : wait;
    let t, lastArgs, lastThis;
    function wrapped(){ lastArgs = arguments; lastThis = this; clearTimeout(t); t = setTimeout(() => { t = null; fn.apply(lastThis, lastArgs); }, wait); }
    wrapped.cancel = () => { clearTimeout(t); t = null; };
    wrapped.flush = () => { if (t){ clearTimeout(t); t = null; fn.apply(lastThis, lastArgs); } };
    return wrapped;
  }

  return { escape, toast, modal, download, spinner, field, card, empty,
           badge, skeleton, table, tabs, confirm, prompt, copy, debounce,
           printDoc, printTable };
})();

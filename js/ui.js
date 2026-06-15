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
    const bg = document.createElement('div'); bg.className='modal-bg';
    bg.innerHTML = `<div class="modal"><h3>${escape(title)}</h3><div class="modal-body"></div></div>`;
    bg.querySelector('.modal-body').innerHTML = bodyHTML || '';
    bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
    document.body.appendChild(bg);
    function close(){ bg.remove(); }
    return { el: bg, body: bg.querySelector('.modal-body'), close };
  }
  function download(filename, blob){
    if (window.saveAs) return window.saveAs(blob, filename);
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  }
  const spinner = '<span class="spinner"></span>';
  function field(label, inputHTML, tok){
    return `<div class="field"><label>${escape(label)} ${tok?`<span class="tok">${escape(tok)}</span>`:''}</label>${inputHTML}</div>`;
  }
  function card(title, hint, bodyHTML){
    return `<div class="card"><h3>${escape(title)}</h3>${hint?`<p class="hint">${escape(hint)}</p>`:''}${bodyHTML||''}</div>`;
  }
  function empty(emoji, text){ return `<div class="empty"><div class="big">${emoji||'🗂️'}</div><div>${text||''}</div></div>`; }
  return { escape, toast, modal, download, spinner, field, card, empty };
})();

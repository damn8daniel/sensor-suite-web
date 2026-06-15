/* Модуль «НОК / СРО» — прозрачный калькулятор счетов.
 * Замена хрупкой Google-таблицы (боль B21: автор уволился, любая правка ломает счёт).
 *
 * Принцип: вся арифметика собрана в ОДНОЙ чистой функции calc(state) ниже.
 * Она не трогает DOM, ничего не читает «снаружи» — на вход состояние, на выход разбивка.
 * UI только заполняет state и рисует то, что вернула calc(). Поэтому «сломать одной
 * правкой» нельзя: расчётную логику видно целиком, она линейна и покрыта валидацией.
 *
 * Формула (порядок применения зафиксирован — менять только здесь):
 *   1) база           = базовая стоимость услуги
 *   2) вознаграждение = партнёрское (СОК) — процент ОТ БАЗЫ либо фикс. сумма
 *   3) допы           = сумма доп. позиций (название + сумма)
 *   4) промежуточно   = база + вознаграждение + допы
 *   5) скидка         = процент ОТ ПРОМЕЖУТОЧНОГО либо фикс. сумма (не больше промежуточного)
 *   6) ИТОГО          = промежуточно − скидка   (никогда не отрицательно)
 */
SensorApp.register({
  id: 'nok', title: 'Калькулятор счетов', dept: 'НОК / СРО', order: 30,
  icon: '🧮', description: 'Прозрачный расчёт счёта · НОК · НРС · вступление в СРО',
  mount(root, ctx){
    const ui = ctx.ui;

    /* ── Справочники направлений (обезличенные демо-ориентиры, не прайс компании) ── */
    const DIRECTIONS = [
      { id:'nok',   name:'НОК (независимая оценка квалификации)', hint:'Через партнёра (СОК) — есть партнёрское вознаграждение' },
      { id:'nrs',   name:'НРС (нацреестр специалистов)',          hint:'Ведём сами' },
      { id:'sro',   name:'Вступление в СРО',                       hint:'Взнос + сопровождение' },
    ];
    const REGIONS = ['Москва','Московская область','Санкт-Петербург','Регионы РФ'];

    /* ── Состояние формы. Единственный источник истины для calc(). ── */
    const state = {
      direction:  DIRECTIONS[0].id,
      region:     REGIONS[0],
      base:       '',          // базовая стоимость, ₽ (строка из input)
      feeMode:    'percent',   // 'percent' | 'fixed' — режим партнёрского вознаграждения
      feeValue:   '',          // % либо ₽
      discMode:   'percent',   // 'percent' | 'fixed' — режим скидки
      discValue:  '',          // % либо ₽
      extras:     [],          // [{name, amount}] — доп. позиции
    };

    /* ─────────────────────── ВАЛИДАЦИЯ ЧИСЕЛ ───────────────────────
     * Принимаем «1 234,56» и «1234.56»; пусто → 0. Возвращаем число ≥ 0
     * либо null, если строка не парсится (для подсветки ошибки). */
    function parseNum(raw){
      if (raw == null) return 0;
      const s = String(raw).trim();
      if (s === '') return 0;
      const norm = s.replace(/\s/g,'').replace(',', '.');
      if (!/^\d+(\.\d+)?$/.test(norm)) return null;   // буквы/мусор/минус → невалидно
      const n = parseFloat(norm);
      return (isFinite(n) && n >= 0) ? n : null;
    }
    function rub(n){ // форматирование суммы: «1 234 567,00 ₽»
      return n.toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2}) + ' ₽';
    }

    /* ─────────────────────── ЯДРО РАСЧЁТА ───────────────────────
     * Чистая функция: state → {ok, errors[], lines, base, fee, extrasSum, subtotal, discount, total}.
     * Тут вся математика счёта. Защита от пустого/отрицательного/нечисла — на входе. */
    function calc(s){
      const errors = [];

      const base = parseNum(s.base);
      if (base === null) errors.push('Базовая стоимость — не число.');
      else if (base <= 0) errors.push('Базовая стоимость должна быть больше нуля.');

      const feeRaw = parseNum(s.feeValue);
      if (feeRaw === null) errors.push('Партнёрское вознаграждение — не число.');
      if (s.feeMode === 'percent' && feeRaw !== null && feeRaw > 100)
        errors.push('Вознаграждение в процентах не может превышать 100%.');

      const discRaw = parseNum(s.discValue);
      if (discRaw === null) errors.push('Скидка — не число.');
      if (s.discMode === 'percent' && discRaw !== null && discRaw > 100)
        errors.push('Скидка в процентах не может превышать 100%.');

      // доп. позиции
      let extrasSum = 0;
      const extraLines = [];
      s.extras.forEach((e, i) => {
        const amt = parseNum(e.amount);
        const hasName = String(e.name||'').trim() !== '';
        const hasAmt  = String(e.amount||'').trim() !== '';
        if (!hasName && !hasAmt) return;                 // полностью пустую строку игнорируем
        if (amt === null){ errors.push(`Доп. позиция №${i+1}: сумма не число.`); return; }
        if (!hasName) errors.push(`Доп. позиция №${i+1}: укажите название.`);
        extrasSum += amt;
        extraLines.push({ name: e.name.trim() || `Доп. позиция №${i+1}`, amount: amt });
      });

      if (errors.length) return { ok:false, errors };

      // 2) вознаграждение
      const fee = (s.feeMode === 'percent') ? base * feeRaw / 100 : feeRaw;
      // 4) промежуточный итог
      const subtotal = base + fee + extrasSum;
      // 5) скидка — не больше промежуточного итога
      let discount = (s.discMode === 'percent') ? subtotal * discRaw / 100 : discRaw;
      if (discount > subtotal) discount = subtotal;
      // 6) ИТОГО
      const total = subtotal - discount;

      // построчная разбивка для счёта и экрана
      const lines = [];
      lines.push({ label:'Базовая стоимость услуги', value: base });
      lines.push({ label: s.feeMode === 'percent'
                            ? `Партнёрское вознаграждение (${feeRaw}% от базы)`
                            : 'Партнёрское вознаграждение (фикс.)', value: fee });
      extraLines.forEach(e => lines.push({ label: 'Доп.: ' + e.name, value: e.amount }));
      lines.push({ label:'Промежуточный итог', value: subtotal, sub:true });
      lines.push({ label: s.discMode === 'percent'
                            ? `Скидка (${discRaw}% от промежуточного итога)`
                            : 'Скидка (фикс.)', value: -discount });

      return { ok:true, errors:[], lines, base, fee, extrasSum, subtotal, discount, total,
               dirName:(DIRECTIONS.find(d=>d.id===s.direction)||{}).name||'', region:s.region };
    }

    /* ─────────────────────── РАЗМЕТКА ─────────────────────── */
    function dirOptions(){
      return DIRECTIONS.map(d=>`<option value="${d.id}"${d.id===state.direction?' selected':''}>${ui.escape(d.name)}</option>`).join('');
    }
    function regOptions(){
      return REGIONS.map(r=>`<option${r===state.region?' selected':''}>${ui.escape(r)}</option>`).join('');
    }
    function modeTabs(prefix, mode){
      return `<div class="pill-tabs" data-mode-group="${prefix}" style="margin-bottom:6px">
          <span class="pill${mode==='percent'?' active':''}" data-mode="percent">% от суммы</span>
          <span class="pill${mode==='fixed'?' active':''}" data-mode="fixed">Фикс. ₽</span>
        </div>`;
    }

    root.innerHTML =
      ui.card('Параметры счёта',
        'Прозрачная замена Google-таблицы: вся арифметика на виду, пустые и отрицательные значения отсекаются.',
        `<div class="grid cols-2">
           ${ui.field('Направление', `<select id="f-dir">${dirOptions()}</select>`)}
           ${ui.field('Регион', `<select id="f-reg">${regOptions()}</select>`)}
         </div>
         <p class="hint" id="dir-hint" style="margin-top:-4px"></p>
         ${ui.field('Базовая стоимость, ₽', `<input id="f-base" inputmode="decimal" placeholder="например, 60000">`)}
         <div class="grid cols-2">
           <div>
             <label style="display:block;font-size:12.5px;font-weight:550;margin-bottom:5px;color:var(--ink-2)">Партнёрское вознаграждение (СОК)</label>
             ${modeTabs('fee', state.feeMode)}
             <input id="f-fee" inputmode="decimal" placeholder="0">
           </div>
           <div>
             <label style="display:block;font-size:12.5px;font-weight:550;margin-bottom:5px;color:var(--ink-2)">Скидка</label>
             ${modeTabs('disc', state.discMode)}
             <input id="f-disc" inputmode="decimal" placeholder="0">
           </div>
         </div>`) +
      ui.card('Дополнительные позиции',
        'Любые добавляемые строки: госпошлина, экспертиза, срочность и т.п. Пустые строки игнорируются.',
        `<div id="extras"></div>
         <div class="btn-row"><button class="btn sm" id="add-extra">＋ Добавить позицию</button></div>`) +
      `<div id="result"></div>`;

    /* ── привязка контролов ── */
    const $ = sel => root.querySelector(sel);
    function syncDirHint(){
      const d = DIRECTIONS.find(x=>x.id===state.direction);
      $('#dir-hint').textContent = d ? d.hint : '';
    }
    $('#f-dir').onchange  = e => { state.direction = e.target.value; syncDirHint(); render(); };
    $('#f-reg').onchange  = e => { state.region = e.target.value; render(); };
    $('#f-base').oninput  = e => { state.base = e.target.value; render(); };
    $('#f-fee').oninput   = e => { state.feeValue = e.target.value; render(); };
    $('#f-disc').oninput  = e => { state.discValue = e.target.value; render(); };

    // переключатели % / фикс. (делегирование на пилюли)
    root.querySelectorAll('[data-mode-group]').forEach(group=>{
      group.querySelectorAll('[data-mode]').forEach(pill=>{
        pill.onclick = ()=>{
          const g = group.getAttribute('data-mode-group');
          const m = pill.getAttribute('data-mode');
          if (g === 'fee') state.feeMode = m; else state.discMode = m;
          group.querySelectorAll('[data-mode]').forEach(p=>p.classList.toggle('active', p===pill));
          render();
        };
      });
    });

    /* ── доп. позиции ── */
    function renderExtras(){
      const box = $('#extras');
      if (!state.extras.length){
        box.innerHTML = `<p class="hint" style="margin:0 0 8px">Позиций нет — счёт считается по базе, вознаграждению и скидке.</p>`;
        return;
      }
      box.innerHTML = state.extras.map((e,i)=>
        `<div class="btn-row" data-extra="${i}" style="margin-bottom:8px;flex-wrap:nowrap">
           <input style="flex:2" data-ex-name placeholder="Название позиции" value="${ui.escape(e.name)}">
           <input style="flex:1" data-ex-amt inputmode="decimal" placeholder="Сумма, ₽" value="${ui.escape(e.amount)}">
           <button class="btn sm ghost" data-ex-del title="Удалить">✕</button>
         </div>`).join('');
      box.querySelectorAll('[data-extra]').forEach(rowEl=>{
        const i = +rowEl.getAttribute('data-extra');
        rowEl.querySelector('[data-ex-name]').oninput = e=>{ state.extras[i].name = e.target.value; renderResult(); };
        rowEl.querySelector('[data-ex-amt]').oninput  = e=>{ state.extras[i].amount = e.target.value; renderResult(); };
        rowEl.querySelector('[data-ex-del]').onclick  = ()=>{ state.extras.splice(i,1); renderExtras(); renderResult(); };
      });
    }
    $('#add-extra').onclick = ()=>{ state.extras.push({name:'', amount:''}); renderExtras(); renderResult(); };

    /* ── результат (разбивка + кнопки экспорта) ── */
    function renderResult(){
      const r = calc(state);
      const box = $('#result');

      if (!r.ok){
        box.innerHTML = ui.card('Расчёт',
          'Исправьте данные — счёт пересчитается автоматически.',
          `<div class="empty"><div class="big">⚠️</div><div>${r.errors.map(e=>ui.escape(e)).join('<br>')}</div></div>`);
        return;
      }

      const rows = r.lines.map(l=>{
        const neg = l.value < 0;
        return `<tr${l.sub?' style="font-weight:600"':''}>
            <td>${ui.escape(l.label)}</td>
            <td class="mono" style="text-align:right${neg?';color:var(--accent-d)':''}">${neg?'− '+rub(Math.abs(l.value)):rub(l.value)}</td>
          </tr>`;
      }).join('');

      box.innerHTML = ui.card('Расчёт счёта',
        `${ui.escape(r.dirName)} · ${ui.escape(r.region)}`,
        `<table class="tbl"><tbody>${rows}
           <tr style="font-size:15px;font-weight:700">
             <td>ИТОГО к оплате</td>
             <td class="mono" style="text-align:right">${rub(r.total)}</td>
           </tr></tbody></table>
         <div class="btn-row" style="margin-top:14px">
           <button class="btn primary" id="btn-print">🖨 Печать счёта</button>
           <button class="btn" id="btn-txt">⤓ Скачать .txt</button>
         </div>`);

      $('#btn-print').onclick = ()=>printInvoice(r);
      $('#btn-txt').onclick   = ()=>downloadTxt(r);
    }

    function render(){ renderResult(); }  // форма перерисовывается только в части результата

    /* ─────────────────────── ЭКСПОРТ ─────────────────────── */
    function invoiceText(r){
      const today = new Date().toLocaleDateString('ru-RU');
      const L = [];
      L.push('СЧЁТ (предварительный расчёт)');
      L.push('Сенсор · Лицензирование — НОК / СРО');
      L.push('Дата: ' + today);
      L.push('Направление: ' + r.dirName);
      L.push('Регион: ' + r.region);
      L.push(''.padEnd(48,'─'));
      r.lines.forEach(l=>{
        const val = l.value < 0 ? '− ' + rub(Math.abs(l.value)) : rub(l.value);
        L.push(l.label.padEnd(34,' ').slice(0,34) + ' ' + val.padStart(13,' '));
      });
      L.push(''.padEnd(48,'─'));
      L.push('ИТОГО К ОПЛАТЕ'.padEnd(34,' ') + ' ' + rub(r.total).padStart(13,' '));
      L.push('');
      L.push('Расчёт предварительный, не является офертой.');
      return L.join('\n');
    }

    function downloadTxt(r){
      const blob = new Blob([invoiceText(r)], {type:'text/plain;charset=utf-8'});
      ui.download('Счёт — ' + r.dirName.replace(/[^\wА-Яа-яёЁ]+/g,' ').trim() + '.txt', blob);
      ctx.toast('Счёт сохранён в .txt ✓','ok');
    }

    function printInvoice(r){
      const rows = r.lines.map(l=>{
        const neg = l.value < 0;
        return `<tr${l.sub?' class="sub"':''}><td>${ui.escape(l.label)}</td><td class="r">${neg?'− '+rub(Math.abs(l.value)):rub(l.value)}</td></tr>`;
      }).join('');
      const html =
        `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Счёт</title>
         <style>
           body{font-family:Arial,sans-serif;color:#161a22;max-width:680px;margin:32px auto;padding:0 24px}
           h1{font-size:20px;margin:0 0 4px} .meta{color:#475067;font-size:13px;margin-bottom:18px}
           table{width:100%;border-collapse:collapse;font-size:14px}
           td{padding:7px 4px;border-bottom:1px solid #e8ebf0} .r{text-align:right;white-space:nowrap}
           tr.sub td{font-weight:bold} tr.total td{font-size:17px;font-weight:bold;border-top:2px solid #161a22;border-bottom:none}
           .foot{color:#8a93a3;font-size:12px;margin-top:22px}
         </style></head><body>
         <h1>Счёт (предварительный расчёт)</h1>
         <div class="meta">Сенсор · Лицензирование — НОК / СРО<br>
           Дата: ${new Date().toLocaleDateString('ru-RU')}<br>
           Направление: ${ui.escape(r.dirName)}<br>Регион: ${ui.escape(r.region)}</div>
         <table><tbody>${rows}
           <tr class="total"><td>ИТОГО к оплате</td><td class="r">${rub(r.total)}</td></tr>
         </tbody></table>
         <div class="foot">Расчёт предварительный, не является офертой.</div>
         </body></html>`;
      const w = window.open('', '_blank');
      if (!w){ ctx.toast('Разрешите всплывающие окна для печати','err'); return; }
      w.document.write(html); w.document.close();
      w.focus(); w.print();
    }

    /* ── первый рендер ── */
    syncDirHint();
    renderExtras();
    renderResult();
  }
});

/* Модуль «НОК / СРО» — прозрачный калькулятор счетов.
 * Замена хрупкой Google-таблицы (боль B21: автор уволился, любая правка ломает счёт).
 *
 * Принцип: вся арифметика собрана в ОДНОЙ чистой функции calc(state) ниже.
 * Она не трогает DOM, ничего не читает «снаружи» — на вход состояние, на выход разбивка.
 * UI только заполняет state и рисует то, что вернула calc(). Поэтому «сломать одной
 * правкой» нельзя: расчётную логику видно целиком, она линейна и покрыта валидацией.
 *
 * ───────────────────────── ФОРМУЛА (порядок зафиксирован, менять только в calc) ─────
 *   1) позиции        = Σ (кол-во × цена) по всем непустым позициям
 *   2) вознаграждение = партнёрское (СОК) — процент ОТ СУММЫ ПОЗИЦИЙ либо фикс. ₽
 *   3) промежуточно   = позиции + вознаграждение
 *   4) скидка         = процент ОТ ПРОМЕЖУТОЧНОГО либо фикс. ₽ (не больше промежуточного)
 *   5) после скидки   = промежуточно − скидка                       (≥ 0)
 *   6) НДС:
 *        'none'    — без НДС:        налог = 0,                итог = после скидки
 *        'incl'    — НДС в сумме:    налог = после скидки × r/(100+r), итог = после скидки
 *        'top'     — НДС сверху:     налог = после скидки × r/100,      итог = после скидки + налог
 *   7) госпошлина     = фикс. ₽ — добавляется ПОСЛЕ НДС (пошлина налогом не облагается)
 *   8) ИТОГО          = итог-после-НДС + госпошлина                  (никогда не отрицательно)
 *
 * ───────────────────────── ЮНИТ-ТЕСТЫ (мысленная проверка инвариантов) ──────────────
 * Записаны как комментарии: прогоняются глазами при правках, защищают формулу.
 *
 *   T1. База без допов, без вознаграждения/скидки/НДС:
 *       positions=[{qty:1,price:60000}] → items=60000, fee=0, subtotal=60000,
 *       discount=0, afterDisc=60000, vat=0, total=60000.                         ✔
 *
 *   T2. Вознаграждение 10% от 60000 = 6000; subtotal=66000.                       ✔
 *
 *   T3. Скидка 100% не уводит итог в минус: afterDisc=0, total=0+пошлина.         ✔
 *       (clamp: discount = min(discount, subtotal))
 *
 *   T4. НДС сверху 20% на afterDisc=100000 → vat=20000, total=120000.             ✔
 *
 *   T5. НДС в сумме 20% при afterDisc=120000 → vat=120000×20/120=20000,
 *       total=120000 (итог НЕ растёт — налог «внутри»).                           ✔
 *
 *   T6. Госпошлина 7500 ₽ добавляется поверх НДС и НЕ облагается налогом:
 *       afterVat=120000, gov=7500 → total=127500, vat без изменений.             ✔
 *
 *   T7. Количество × цена: positions=[{qty:3,price:25000}] → items=75000.         ✔
 *
 *   T8. Полностью пустая позиция (нет названия и суммы) игнорируется,
 *       не роняет расчёт и не считается ошибкой.                                  ✔
 *
 *   T9. Мусор в цене («abc») → parseNum=null → ok:false, расчёт не выполняется,
 *       пользователь видит понятную ошибку, а не NaN.                             ✔
 *
 *  T10. Сумма частей сходится с ИТОГО (инвариант баланса):
 *       items + fee − discount + (НДС сверху?vat:0) + gov === total.              ✔
 */
SensorApp.register({
  id: 'nok', title: 'Калькулятор счетов', dept: 'НОК / СРО', order: 30,
  icon: '🧮', description: 'Прозрачный расчёт счёта · НОК · НРС · вступление в СРО',

  /* Быстрые действия для командной палитры (⌘K) */
  actions: [
    { id:'new',     title:'Новый счёт', hint:'Очистить форму', icon:'🧮' },
    { id:'history', title:'История счетов', hint:'Сохранённые расчёты', icon:'🗂️' }
  ],

  mount(root, ctx){
    const ui = ctx.ui;
    const STORE_KEY = 'nok_invoices';   // история сохранённых счетов
    const DRAFT_KEY = 'nok_draft';      // черновик (восстанавливается при возврате)

    /* Модуль-локальные стили. Вставляются один раз (id-guard), используют ТОЛЬКО
     * существующие токены дизайн-системы — css/app.css не трогаем. */
    (function injectStyle(){
      if (document.getElementById('nok-style')) return;
      const css = `
      .nok-sublabel{display:block;font-size:12.5px;font-weight:550;margin-bottom:5px;color:var(--ink-2)}
      .nok-pos-head{display:grid;grid-template-columns:1fr 76px 116px 130px 34px;gap:8px;
        padding:0 2px 6px;color:var(--muted);font-size:10.5px;font-weight:650;
        text-transform:uppercase;letter-spacing:.05em}
      .nok-pos-head span:nth-child(2),.nok-pos-head span:nth-child(3),.nok-pos-head span:nth-child(4){text-align:right}
      .nok-pos-row{display:grid;grid-template-columns:1fr 76px 116px 130px 34px;gap:8px;
        align-items:center;margin-bottom:8px}
      .nok-pos-row .np-qty,.nok-pos-row .np-price{text-align:right}
      .nok-pos-row .np-sum{text-align:right;font-size:12.5px;color:var(--ink-2);
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
      .nok-pos-row .np-del{padding:0;width:34px;height:34px;line-height:1}
      .nok-result-meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
      .nok-breakdown td{padding:9px 10px}
      .nok-breakdown .nok-qty,.nok-breakdown .nok-price{text-align:right;color:var(--ink-3);width:1%;white-space:nowrap}
      .nok-breakdown tr.nok-line-sub td{font-weight:650;border-top:1px solid var(--line-2)}
      .nok-breakdown tr.nok-line-info td{color:var(--ink-3);font-size:12px}
      .nok-breakdown tr.nok-total td{font-size:15.5px;font-weight:750;
        border-top:2px solid var(--ink);border-bottom:none;padding-top:13px}
      .nok-breakdown tr.nok-total:hover td{background:transparent}
      .nok-hist-when{color:var(--muted);font-size:11px;margin-top:2px;font-family:var(--font)}
      .nok-hist-sub{color:var(--muted);font-size:11.5px;margin-top:2px}
      .nok-hist-act .btn{padding:5px 9px}
      @media(max-width:680px){
        .nok-pos-head{display:none}
        .nok-pos-row{grid-template-columns:1fr 1fr;grid-template-areas:'name name' 'qty price' 'sum del'}
        .nok-pos-row .np-name{grid-area:name}
        .nok-pos-row .np-qty{grid-area:qty}
        .nok-pos-row .np-price{grid-area:price}
        .nok-pos-row .np-sum{grid-area:sum;text-align:left}
        .nok-pos-row .np-del{grid-area:del;justify-self:end}
      }
      @media print{
        .nok-pos-head,.nok-hist-act,.nok-result-meta .badge{display:none!important}
      }`;
      const tag = document.createElement('style');
      tag.id = 'nok-style';
      tag.textContent = css;
      document.head.appendChild(tag);
    })();

    /* Реквизиты бланка — обезличенные, редактируются и запоминаются локально. */
    const DEFAULT_REQUISITES = {
      org:    'ООО «Сенсор Лицензирование»',
      sub:    'Помощь в получении разрешительных документов · НОК / СРО',
      addr:   'Москва, БП «Румянцево», блок Б',
      contact:'+7 (000) 000-00-00 · info@example.ru',
      bank:   'р/с 00000000000000000000 · БИК 000000000'
    };

    /* ── Пресеты направлений ──────────────────────────────────────────────
     * Каждый пресет — готовый каркас счёта: позиции, режим вознаграждения,
     * скидка, госпошлина, НДС. Суммы — обезличенные демо-ориентиры (из конспекта
     * продуктов / банка возражений), НЕ официальный прайс компании. */
    const DIRECTIONS = [
      {
        id:'nok', name:'НОК (независимая оценка квалификации)',
        hint:'Через партнёра (СОК) — есть партнёрское вознаграждение',
        preset:{
          positions:[{ name:'Сопровождение НОК (под ключ)', qty:'1', price:'45000' }],
          feeMode:'percent', feeValue:'15',
          discMode:'percent', discValue:'0',
          gov:'0', vatMode:'none', vatRate:'20'
        }
      },
      {
        id:'nrs', name:'НРС (нацреестр специалистов)',
        hint:'Ведём сами — вознаграждение партнёру не начисляем',
        preset:{
          positions:[{ name:'Внесение специалиста в НРС', qty:'1', price:'35000' }],
          feeMode:'fixed', feeValue:'0',
          discMode:'percent', discValue:'0',
          gov:'0', vatMode:'none', vatRate:'20'
        }
      },
      {
        id:'sro', name:'Вступление в СРО',
        hint:'Вступительный/целевой взносы + сопровождение + компенсационный фонд',
        preset:{
          positions:[
            { name:'Сопровождение вступления в СРО', qty:'1', price:'40000' },
            { name:'Вступительный взнос', qty:'1', price:'5000' }
          ],
          feeMode:'fixed', feeValue:'0',
          discMode:'percent', discValue:'0',
          gov:'0', vatMode:'none', vatRate:'20'
        }
      },
      {
        id:'attpr', name:'АТТПР — аттестация проектировщика',
        hint:'Сопровождение + профпереподготовка; аттестация в МЧС бесплатна',
        preset:{
          positions:[
            { name:'Сопровождение аттестации проектировщика', qty:'1', price:'75000' },
            { name:'Профпереподготовка', qty:'1', price:'15000' }
          ],
          feeMode:'fixed', feeValue:'0',
          discMode:'percent', discValue:'0',
          gov:'0', vatMode:'none', vatRate:'20'
        }
      },
      {
        id:'mchs', name:'Лицензия МЧС — монтаж/ТО/ремонт',
        hint:'Сопровождение + обучение спецов; госпошлина 7500 ₽ при подаче',
        preset:{
          positions:[
            { name:'Сопровождение лицензии МЧС (виды 1–9)', qty:'1', price:'120000' },
            { name:'Повышение квалификации специалиста', qty:'4', price:'6000' }
          ],
          feeMode:'fixed', feeValue:'0',
          discMode:'percent', discValue:'0',
          gov:'7500', vatMode:'none', vatRate:'20'
        }
      }
    ];
    const REGIONS = ['Москва','Московская область','Санкт-Петербург','Регионы РФ'];

    /* ── Состояние формы. Единственный источник истины для calc(). ── */
    function blankPositions(){ return [{ name:'', qty:'1', price:'' }]; }
    function freshState(dirId){
      return {
        direction: dirId || DIRECTIONS[0].id,
        region:    REGIONS[0],
        client:    '',                  // плательщик / получатель (необязательно)
        number:    autoNumber(),        // номер счёта
        positions: blankPositions(),    // [{name, qty, price}]
        feeMode:   'percent',           // 'percent' | 'fixed' — партнёрское вознаграждение
        feeValue:  '',
        discMode:  'percent',           // 'percent' | 'fixed' — скидка
        discValue: '',
        gov:       '',                  // госпошлина, ₽ (фикс., не облагается НДС)
        vatMode:   'none',              // 'none' | 'incl' | 'top'
        vatRate:   '20'                 // ставка НДС, %
      };
    }
    function autoNumber(){
      const n = (ctx.store.get(STORE_KEY, []) || []).length + 1;
      const d = new Date();
      return 'СЧ-' + d.getFullYear() + '/' + String(n).padStart(3,'0');
    }

    // черновик из store (например, после возврата из истории) или свежий
    let state = (function(){
      const d = ctx.store.get(DRAFT_KEY, null);
      if (d && Array.isArray(d.positions)) return Object.assign(freshState(), d);
      return freshState();
    })();
    let requisites = Object.assign({}, DEFAULT_REQUISITES, ctx.store.get('nok_requisites', {}) || {});

    function persistDraft(){ ctx.store.set(DRAFT_KEY, state); }

    /* ─────────────────────── ВАЛИДАЦИЯ ЧИСЕЛ ───────────────────────
     * Принимаем «1 234,56» и «1234.56»; пусто → 0. Возвращаем число ≥ 0
     * либо null, если строка не парсится (для подсветки ошибки). */
    function parseNum(raw){
      if (raw == null) return 0;
      const s = String(raw).trim();
      if (s === '') return 0;
      const norm = s.replace(/\s/g,'').replace(/ /g,'').replace(',', '.');
      if (!/^\d+(\.\d+)?$/.test(norm)) return null;   // буквы/мусор/минус → невалидно
      const n = parseFloat(norm);
      return (isFinite(n) && n >= 0) ? n : null;
    }
    function round2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }
    function rub(n){ // форматирование суммы: «1 234 567,00 ₽»
      return Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2, maximumFractionDigits:2}) + ' ₽';
    }
    function num(n){ // число без знака валюты (для кол-ва/цены в построчке)
      return Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:2});
    }

    /* ─────────────────────── ЯДРО РАСЧЁТА ───────────────────────
     * Чистая функция: state → {ok, errors[], lines, positions, itemsSum, fee,
     *   subtotal, discount, afterDisc, vat, afterVat, gov, total, ...}.
     * Тут вся математика счёта. Защита от пустого/отрицательного/нечисла — на входе. */
    function calc(s){
      const errors = [];

      // 1) позиции
      let itemsSum = 0;
      const positions = [];
      (s.positions || []).forEach((p, i) => {
        const hasName  = String(p.name||'').trim()  !== '';
        const hasQty   = String(p.qty||'').trim()   !== '';
        const hasPrice = String(p.price||'').trim()  !== '';
        if (!hasName && !hasPrice && (!hasQty || String(p.qty).trim()==='1')) return; // пустая строка
        const qty   = parseNum(p.qty === '' || p.qty == null ? '1' : p.qty);
        const price = parseNum(p.price);
        if (qty === null){ errors.push(`Позиция №${i+1}: количество — не число.`); return; }
        if (price === null){ errors.push(`Позиция №${i+1}: цена — не число.`); return; }
        if (!hasName) errors.push(`Позиция №${i+1}: укажите наименование.`);
        const sum = round2(qty * price);
        itemsSum += sum;
        positions.push({ name:String(p.name||'').trim() || `Позиция №${i+1}`, qty, price, sum });
      });
      if (!positions.length && !errors.length) errors.push('Добавьте хотя бы одну позицию с ценой.');
      itemsSum = round2(itemsSum);

      // 2) вознаграждение (от суммы позиций)
      const feeRaw = parseNum(s.feeValue);
      if (feeRaw === null) errors.push('Партнёрское вознаграждение — не число.');
      if (s.feeMode === 'percent' && feeRaw !== null && feeRaw > 100)
        errors.push('Вознаграждение в процентах не может превышать 100%.');

      // 4) скидка
      const discRaw = parseNum(s.discValue);
      if (discRaw === null) errors.push('Скидка — не число.');
      if (s.discMode === 'percent' && discRaw !== null && discRaw > 100)
        errors.push('Скидка в процентах не может превышать 100%.');

      // 7) госпошлина
      const gov = parseNum(s.gov);
      if (gov === null) errors.push('Госпошлина — не число.');

      // 6) ставка НДС
      const vatRate = parseNum(s.vatRate);
      if (vatRate === null) errors.push('Ставка НДС — не число.');
      else if (vatRate > 100) errors.push('Ставка НДС не может превышать 100%.');

      if (errors.length) return { ok:false, errors };

      const fee = round2(s.feeMode === 'percent' ? itemsSum * feeRaw / 100 : feeRaw);
      const subtotal = round2(itemsSum + fee);

      let discount = round2(s.discMode === 'percent' ? subtotal * discRaw / 100 : discRaw);
      if (discount > subtotal) discount = subtotal;       // clamp — итог не уйдёт в минус
      const afterDisc = round2(subtotal - discount);

      // 6) НДС
      let vat = 0, afterVat = afterDisc;
      if (s.vatMode === 'top'){ vat = round2(afterDisc * vatRate / 100); afterVat = round2(afterDisc + vat); }
      else if (s.vatMode === 'incl'){ vat = round2(afterDisc * vatRate / (100 + vatRate)); afterVat = afterDisc; }

      // 8) ИТОГО (госпошлина — поверх НДС, налогом не облагается)
      const total = round2(afterVat + gov);

      // ── построчная разбивка для счёта и экрана ──
      const lines = [];
      positions.forEach(p => lines.push({
        label: p.name,
        qty: p.qty, price: p.price, value: p.sum, kind:'pos'
      }));
      if (fee > 0) lines.push({
        label: s.feeMode === 'percent'
                 ? `Партнёрское вознаграждение (${num(feeRaw)}% от суммы позиций)`
                 : 'Партнёрское вознаграждение (фикс.)',
        value: fee, kind:'fee'
      });
      if (fee > 0) lines.push({ label:'Промежуточный итог', value: subtotal, kind:'sub', sub:true });
      if (discount > 0) lines.push({
        label: s.discMode === 'percent'
                 ? `Скидка (${num(discRaw)}% от промежуточного итога)`
                 : 'Скидка (фикс.)',
        value: -discount, kind:'disc'
      });
      if (s.vatMode === 'top') lines.push({ label:`НДС ${num(vatRate)}% (сверху)`, value: vat, kind:'vat' });
      else if (s.vatMode === 'incl') lines.push({ label:`в т.ч. НДС ${num(vatRate)}%`, value: vat, kind:'vat-incl', info:true });
      if (gov > 0) lines.push({ label:'Госпошлина (без НДС)', value: gov, kind:'gov' });

      return {
        ok:true, errors:[], lines, positions,
        itemsSum, fee, subtotal, discount, afterDisc, vat, afterVat, gov, total,
        vatMode:s.vatMode, vatRate,
        dirName:(DIRECTIONS.find(d=>d.id===s.direction)||{}).name||'',
        region:s.region, client:String(s.client||'').trim(), number:String(s.number||'').trim()
      };
    }

    /* ─────────────────────── РАЗМЕТКА ─────────────────────── */
    function dirOptions(){
      return DIRECTIONS.map(d=>`<option value="${d.id}"${d.id===state.direction?' selected':''}>${ui.escape(d.name)}</option>`).join('');
    }
    function regOptions(){
      return REGIONS.map(r=>`<option${r===state.region?' selected':''}>${ui.escape(r)}</option>`).join('');
    }
    function vatOptions(){
      const opts = [['none','Без НДС'],['top','НДС сверху'],['incl','НДС в сумме']];
      return opts.map(([v,l])=>`<option value="${v}"${v===state.vatMode?' selected':''}>${l}</option>`).join('');
    }
    function modeTabs(prefix, mode){
      return `<div class="pill-tabs" data-mode-group="${prefix}" role="tablist" aria-label="Режим" style="margin-bottom:6px">
          <span class="pill${mode==='percent'?' active':''}" role="tab" tabindex="0" aria-selected="${mode==='percent'}" data-mode="percent">% от суммы</span>
          <span class="pill${mode==='fixed'?' active':''}" role="tab" tabindex="0" aria-selected="${mode==='fixed'}" data-mode="fixed">Фикс. ₽</span>
        </div>`;
    }

    root.innerHTML =
      ui.card('Параметры счёта',
        'Прозрачная замена Google-таблицы: вся арифметика на виду (формула и юнит-тесты — в комментариях кода). Пустые и отрицательные значения отсекаются, итог не уходит в минус.',
        `<div class="grid cols-2">
           ${ui.field('Направление', `<select id="f-dir" aria-label="Направление">${dirOptions()}</select>`)}
           ${ui.field('Регион', `<select id="f-reg" aria-label="Регион">${regOptions()}</select>`)}
         </div>
         <p class="hint" id="dir-hint" style="margin-top:-4px"></p>
         <div class="btn-row" id="preset-row" style="margin:-2px 0 14px"></div>
         <div class="grid cols-2">
           ${ui.field('Плательщик / клиент', `<input id="f-client" placeholder="ООО «Ромашка» (необязательно)" autocomplete="off" value="${ui.escape(state.client)}">`)}
           ${ui.field('Номер счёта', `<input id="f-num" placeholder="СЧ-2026/001" autocomplete="off" value="${ui.escape(state.number)}">`)}
         </div>`) +

      ui.card('Позиции счёта',
        'Наименование, количество и цена за единицу. Сумма по строке считается автоматически. Полностью пустые строки игнорируются.',
        `<div class="nok-pos-head" aria-hidden="true">
           <span>Наименование</span><span>Кол-во</span><span>Цена, ₽</span><span>Сумма</span><span></span>
         </div>
         <div id="positions"></div>
         <div class="btn-row" style="margin-top:10px">
           <button class="btn sm" id="add-pos" type="button">＋ Добавить позицию</button>
         </div>`) +

      ui.card('Вознаграждение, скидка и налоги',
        'Партнёрское вознаграждение (СОК) считается от суммы позиций; скидка — от промежуточного итога; НДС — после скидки; госпошлина — поверх НДС (налогом не облагается).',
        `<div class="grid cols-2">
           <div>
             <label class="nok-sublabel">Партнёрское вознаграждение (СОК)</label>
             ${modeTabs('fee', state.feeMode)}
             <input id="f-fee" inputmode="decimal" placeholder="0" value="${ui.escape(state.feeValue)}" aria-label="Вознаграждение">
           </div>
           <div>
             <label class="nok-sublabel">Скидка</label>
             ${modeTabs('disc', state.discMode)}
             <input id="f-disc" inputmode="decimal" placeholder="0" value="${ui.escape(state.discValue)}" aria-label="Скидка">
           </div>
         </div>
         <div class="grid cols-3" style="margin-top:6px">
           ${ui.field('НДС', `<select id="f-vat" aria-label="Режим НДС">${vatOptions()}</select>`)}
           ${ui.field('Ставка НДС, %', `<input id="f-vatrate" inputmode="decimal" placeholder="20" value="${ui.escape(state.vatRate)}">`)}
           ${ui.field('Госпошлина, ₽', `<input id="f-gov" inputmode="decimal" placeholder="0" value="${ui.escape(state.gov)}">`)}
         </div>`) +

      `<div id="result"></div>` +

      ui.card('История счетов',
        'Сохранённые расчёты хранятся локально (этот браузер). Любой можно открыть заново, продублировать или удалить.',
        `<div class="btn-row" style="margin:-2px 0 12px" id="hist-tools"></div>
         <div id="history"></div>`);

    /* ── привязка контролов ── */
    const $ = sel => root.querySelector(sel);

    function syncDirHint(){
      const d = DIRECTIONS.find(x=>x.id===state.direction);
      $('#dir-hint').textContent = d ? d.hint : '';
      renderPresetRow();
    }

    function renderPresetRow(){
      const d = DIRECTIONS.find(x=>x.id===state.direction);
      const row = $('#preset-row');
      if (!d){ row.innerHTML=''; return; }
      row.innerHTML =
        `<button class="btn sm" id="apply-preset" type="button" title="Заполнить позиции типовым набором для направления">⚡ Применить пресет «${ui.escape(d.name.split('(')[0].split('—')[0].trim())}»</button>`;
      $('#apply-preset').onclick = ()=>applyPreset(d.id, true);
    }

    function applyPreset(dirId, notify){
      const d = DIRECTIONS.find(x=>x.id===dirId);
      if (!d || !d.preset) return;
      const p = d.preset;
      state.positions = p.positions.map(x=>({ name:x.name, qty:x.qty, price:x.price }));
      state.feeMode = p.feeMode;   state.feeValue = p.feeValue;
      state.discMode = p.discMode; state.discValue = p.discValue;
      state.gov = p.gov;           state.vatMode = p.vatMode; state.vatRate = p.vatRate;
      // отразить в полях
      $('#f-fee').value = state.feeValue; $('#f-disc').value = state.discValue;
      $('#f-gov').value = state.gov; $('#f-vatrate').value = state.vatRate; $('#f-vat').value = state.vatMode;
      syncModePills('fee', state.feeMode); syncModePills('disc', state.discMode);
      renderPositions(); renderResult(); persistDraft();
      if (notify) ctx.toast('Пресет применён — проверьте суммы ✓','ok');
    }

    function syncModePills(group, mode){
      const g = root.querySelector(`[data-mode-group="${group}"]`);
      if (!g) return;
      g.querySelectorAll('[data-mode]').forEach(p=>{
        const on = p.getAttribute('data-mode')===mode;
        p.classList.toggle('active', on); p.setAttribute('aria-selected', on);
      });
    }

    $('#f-dir').onchange   = e => { state.direction = e.target.value; syncDirHint(); renderResult(); persistDraft(); };
    $('#f-reg').onchange   = e => { state.region = e.target.value; renderResult(); persistDraft(); };
    $('#f-client').oninput = e => { state.client = e.target.value; renderResult(); persistDraft(); };
    $('#f-num').oninput    = e => { state.number = e.target.value; renderResult(); persistDraft(); };
    $('#f-fee').oninput    = e => { state.feeValue = e.target.value; renderResult(); persistDraft(); };
    $('#f-disc').oninput   = e => { state.discValue = e.target.value; renderResult(); persistDraft(); };
    $('#f-gov').oninput    = e => { state.gov = e.target.value; renderResult(); persistDraft(); };
    $('#f-vatrate').oninput= e => { state.vatRate = e.target.value; renderResult(); persistDraft(); };
    $('#f-vat').onchange   = e => { state.vatMode = e.target.value; renderResult(); persistDraft(); };

    // переключатели % / фикс. (делегирование на пилюли + клавиатура)
    root.querySelectorAll('[data-mode-group]').forEach(group=>{
      const g = group.getAttribute('data-mode-group');
      function pick(pill){
        const m = pill.getAttribute('data-mode');
        if (g === 'fee') state.feeMode = m; else state.discMode = m;
        syncModePills(g, m); renderResult(); persistDraft();
      }
      group.querySelectorAll('[data-mode]').forEach(pill=>{
        pill.onclick = ()=>pick(pill);
        pill.onkeydown = e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); pick(pill); } };
      });
    });

    /* ── позиции счёта ── */
    function renderPositions(){
      const box = $('#positions');
      if (!state.positions.length){
        box.innerHTML = `<p class="hint" style="margin:0">Позиций нет — добавьте хотя бы одну строку.</p>`;
        return;
      }
      box.innerHTML = state.positions.map((p,i)=>{
        const qty = parseNum(p.qty===''? '1' : p.qty);
        const price = parseNum(p.price);
        const sum = (qty!==null && price!==null) ? rub(round2(qty*price)) : '—';
        return `<div class="nok-pos-row" data-pos="${i}">
           <input class="np-name" data-pos-name placeholder="Наименование услуги" value="${ui.escape(p.name)}" aria-label="Наименование позиции ${i+1}">
           <input class="np-qty" data-pos-qty inputmode="decimal" placeholder="1" value="${ui.escape(p.qty)}" aria-label="Количество">
           <input class="np-price" data-pos-price inputmode="decimal" placeholder="0" value="${ui.escape(p.price)}" aria-label="Цена">
           <span class="np-sum mono" data-pos-sum>${sum}</span>
           <button class="btn sm ghost np-del" type="button" data-pos-del title="Удалить позицию" aria-label="Удалить позицию ${i+1}">✕</button>
         </div>`;
      }).join('');
      box.querySelectorAll('[data-pos]').forEach(rowEl=>{
        const i = +rowEl.getAttribute('data-pos');
        const nameEl = rowEl.querySelector('[data-pos-name]');
        const qtyEl  = rowEl.querySelector('[data-pos-qty]');
        const priceEl= rowEl.querySelector('[data-pos-price]');
        const sumEl  = rowEl.querySelector('[data-pos-sum]');
        function refreshSum(){
          const q = parseNum(qtyEl.value===''?'1':qtyEl.value);
          const pr = parseNum(priceEl.value);
          const bad = (q===null) || (pr===null);
          sumEl.textContent = bad ? '—' : rub(round2(q*pr));
          qtyEl.setAttribute('aria-invalid', q===null && qtyEl.value.trim()!=='' ? 'true':'false');
          priceEl.setAttribute('aria-invalid', pr===null && priceEl.value.trim()!=='' ? 'true':'false');
        }
        nameEl.oninput  = e=>{ state.positions[i].name = e.target.value; renderResult(); persistDraft(); };
        qtyEl.oninput   = e=>{ state.positions[i].qty = e.target.value; refreshSum(); renderResult(); persistDraft(); };
        priceEl.oninput = e=>{ state.positions[i].price = e.target.value; refreshSum(); renderResult(); persistDraft(); };
        rowEl.querySelector('[data-pos-del]').onclick = ()=>{
          state.positions.splice(i,1);
          if (!state.positions.length) state.positions = blankPositions();
          renderPositions(); renderResult(); persistDraft();
        };
        // Enter в цене последней строки → новая позиция (быстрый ввод)
        priceEl.onkeydown = e=>{ if(e.key==='Enter' && i===state.positions.length-1){ e.preventDefault(); addPosition(true); } };
      });
    }
    function addPosition(focus){
      state.positions.push({ name:'', qty:'1', price:'' });
      renderPositions(); renderResult(); persistDraft();
      if (focus){ const rows = $('#positions').querySelectorAll('[data-pos-name]'); const last = rows[rows.length-1]; if(last) last.focus(); }
    }
    $('#add-pos').onclick = ()=>addPosition(true);

    /* ── результат (разбивка + кнопки) ── */
    function renderResult(){
      const r = calc(state);
      const box = $('#result');

      if (!r.ok){
        box.innerHTML = ui.card('Расчёт счёта',
          'Исправьте данные — счёт пересчитается автоматически.',
          ui.empty('⚠️',
            r.errors.map(e=>ui.escape(e)).join('<br>'),
            ''));
        return;
      }

      // построчная таблица
      const rowsHtml = r.lines.map(l=>{
        const neg = l.value < 0;
        const info = l.info;
        const cls = [l.sub?'nok-line-sub':'', info?'nok-line-info':''].filter(Boolean).join(' ');
        const qtyCell = l.kind==='pos'
          ? `<td class="mono nok-qty">${num(l.qty)}</td><td class="mono nok-price">${rub(l.price)}</td>`
          : `<td class="nok-qty"></td><td class="nok-price"></td>`;
        const valStyle = 'text-align:right' + (neg?';color:var(--accent-d)':'') + (info?';color:var(--ink-3)':'');
        const valTxt = info ? '(' + rub(l.value) + ')' : (neg ? '− '+rub(Math.abs(l.value)) : rub(l.value));
        return `<tr class="${cls}">
            <td>${ui.escape(l.label)}</td>
            ${qtyCell}
            <td class="mono" style="${valStyle}">${valTxt}</td>
          </tr>`;
      }).join('');

      const vatNote = r.vatMode==='none' ? 'без НДС'
                    : r.vatMode==='incl' ? `НДС ${num(r.vatRate)}% в сумме`
                    : `НДС ${num(r.vatRate)}% сверху`;

      box.innerHTML = ui.card(
        'Расчёт счёта',
        `${ui.escape(r.dirName)} · ${ui.escape(r.region)}`,
        `<div class="nok-result-meta">
            ${ui.badge(r.number || 'без номера', 'info')}
            ${r.client ? ui.badge('плательщик: '+r.client) : ''}
            ${ui.badge(vatNote, r.vatMode==='none'?'':'accent')}
            ${r.gov>0 ? ui.badge('госпошлина '+rub(r.gov)) : ''}
         </div>
         <div class="tbl-scroll" style="margin-top:2px">
           <table class="tbl nok-breakdown"><tbody>${rowsHtml}
             <tr class="nok-total">
               <td>ИТОГО к оплате</td><td class="nok-qty"></td><td class="nok-price"></td>
               <td class="mono" style="text-align:right">${rub(r.total)}</td>
             </tr></tbody></table>
         </div>
         <div class="btn-row" style="margin-top:16px">
           <button class="btn primary" id="btn-print" type="button">🖨 Печать счёта</button>
           <button class="btn" id="btn-txt" type="button">⤓ Скачать .txt</button>
           <button class="btn" id="btn-copy" type="button">⧉ Копировать</button>
           <span class="spacer" style="flex:1"></span>
           <button class="btn sm" id="btn-save" type="button" title="Сохранить расчёт в историю">💾 Сохранить</button>
           <button class="btn sm ghost" id="btn-reset" type="button" title="Очистить форму">Новый</button>
         </div>`);

      $('#btn-print').onclick = ()=>printInvoice(r);
      $('#btn-txt').onclick   = ()=>downloadTxt(r);
      $('#btn-copy').onclick  = ()=>ui.copy(invoiceText(r), 'Счёт скопирован в буфер ✓');
      $('#btn-save').onclick  = ()=>saveInvoice(r);
      $('#btn-reset').onclick = ()=>newInvoice();
    }

    function newInvoice(keepDir){
      state = freshState(keepDir ? state.direction : DIRECTIONS[0].id);
      persistDraft();
      // полная перерисовка формы
      $('#f-dir').value = state.direction;
      $('#f-reg').value = state.region;
      $('#f-client').value = ''; $('#f-num').value = state.number;
      $('#f-fee').value = ''; $('#f-disc').value = '';
      $('#f-gov').value = ''; $('#f-vatrate').value = state.vatRate; $('#f-vat').value = state.vatMode;
      syncModePills('fee', state.feeMode); syncModePills('disc', state.discMode);
      syncDirHint(); renderPositions(); renderResult();
      ctx.toast('Новый счёт','info');
    }

    /* ─────────────────────── ИСТОРИЯ ─────────────────────── */
    function loadHistory(){ const a = ctx.store.get(STORE_KEY, []); return Array.isArray(a) ? a : []; }
    function persistHistory(a){ ctx.store.set(STORE_KEY, a); }

    function saveInvoice(r){
      const list = loadHistory();
      const snap = {
        id: 'inv_' + Date.now().toString(36),
        savedAt: new Date().toISOString(),
        number: r.number, client: r.client, dirName: r.dirName, region: r.region,
        total: r.total,
        state: JSON.parse(JSON.stringify(state))   // полное состояние для восстановления
      };
      list.unshift(snap);
      persistHistory(list.slice(0, 100));          // мягкий лимит
      renderHistory();
      ctx.toast('Счёт сохранён в историю ✓','ok');
    }

    function restoreInvoice(id){
      const snap = loadHistory().find(x=>x.id===id);
      if (!snap || !snap.state) return;
      state = Object.assign(freshState(), snap.state);
      persistDraft();
      $('#f-dir').value = state.direction; $('#f-reg').value = state.region;
      $('#f-client').value = state.client; $('#f-num').value = state.number;
      $('#f-fee').value = state.feeValue; $('#f-disc').value = state.discValue;
      $('#f-gov').value = state.gov; $('#f-vatrate').value = state.vatRate; $('#f-vat').value = state.vatMode;
      syncModePills('fee', state.feeMode); syncModePills('disc', state.discMode);
      syncDirHint(); renderPositions(); renderResult();
      root.scrollIntoView && root.scrollIntoView({behavior:'smooth', block:'start'});
      ctx.toast('Счёт восстановлен в форму','ok');
    }

    function duplicateInvoice(id){
      restoreInvoice(id);
      state.number = autoNumber();
      $('#f-num').value = state.number;
      persistDraft(); renderResult();
      ctx.toast('Создан дубликат — номер обновлён','info');
    }

    async function deleteInvoice(id){
      const snap = loadHistory().find(x=>x.id===id);
      const ok = await ui.confirm({
        title:'Удалить счёт?',
        message: snap ? `Счёт ${snap.number||''} на ${rub(snap.total)} будет удалён из истории.` : 'Удалить запись из истории?',
        detail:'Действие необратимо.', ok:'Удалить', danger:true
      });
      if (!ok) return;
      persistHistory(loadHistory().filter(x=>x.id!==id));
      renderHistory();
      ctx.toast('Счёт удалён','info');
    }

    function renderHistory(){
      const box = $('#history');
      const tools = $('#hist-tools');
      const list = loadHistory();
      if (!list.length){
        tools.innerHTML = '';
        box.innerHTML = ui.empty('🗂️','История пуста. Рассчитайте счёт и нажмите «Сохранить» — он появится здесь.');
        return;
      }
      const sum = list.reduce((a,x)=>a+(Number(x.total)||0),0);
      tools.innerHTML =
        `${ui.badge(list.length+' '+plural(list.length,'счёт','счёта','счетов'))}
         ${ui.badge('итого '+rub(sum),'accent')}
         <span class="spacer" style="flex:1"></span>
         <button class="btn sm ghost" id="hist-clear" type="button">Очистить историю</button>`;
      $('#hist-clear').onclick = async ()=>{
        const ok = await ui.confirm({ title:'Очистить историю?', message:`Будут удалены все ${list.length} сохранённых счетов.`, detail:'Действие необратимо.', ok:'Очистить', danger:true });
        if(!ok) return; persistHistory([]); renderHistory(); ctx.toast('История очищена','info');
      };

      box.innerHTML = ui.table(
        list,
        [
          { key:'number', label:'Счёт', render:(v,row)=>`<span class="mono">${ui.escape(v||'—')}</span><div class="nok-hist-when">${ui.escape(fmtWhen(row.savedAt))}</div>` },
          { key:'dirName', label:'Направление', render:(v,row)=>`${ui.escape(shortDir(v))}${row.client?`<div class="nok-hist-sub">${ui.escape(row.client)}</div>`:''}` },
          { key:'region', label:'Регион' },
          { key:'total', label:'Итого', align:'right', mono:true, render:v=>rub(v) },
          { key:'id', label:'', align:'right', render:(v)=>
              `<div class="btn-row nok-hist-act" style="justify-content:flex-end;gap:4px;flex-wrap:nowrap">
                 <button class="btn ghost sm" data-open="${v}" title="Открыть в форме">Открыть</button>
                 <button class="btn ghost sm" data-dup="${v}" title="Дублировать">⎘</button>
                 <button class="btn ghost sm" data-del="${v}" title="Удалить">✕</button>
               </div>` }
        ],
        { maxHeight:'340px' }
      );
      box.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>restoreInvoice(b.dataset.open));
      box.querySelectorAll('[data-dup]').forEach(b=>b.onclick=()=>duplicateInvoice(b.dataset.dup));
      box.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteInvoice(b.dataset.del));
    }
    function plural(n,one,few,many){ const m=n%100, d=n%10; if(m>=11&&m<=14)return many; if(d===1)return one; if(d>=2&&d<=4)return few; return many; }
    function shortDir(s){ return String(s||'').split('(')[0].split('—')[0].trim() || s; }
    function fmtWhen(iso){ try{ const d=new Date(iso); return d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }

    /* ─────────────────────── ЭКСПОРТ ─────────────────────── */
    function invoiceText(r){
      const today = new Date().toLocaleDateString('ru-RU');
      const W = 52;
      const sep = ''.padEnd(W,'─');
      const L = [];
      L.push(requisites.org);
      if (requisites.sub) L.push(requisites.sub);
      if (requisites.addr) L.push(requisites.addr);
      if (requisites.contact) L.push(requisites.contact);
      L.push(sep);
      L.push('СЧЁТ ' + (r.number||'') + ' (предварительный расчёт)');
      L.push('Дата: ' + today);
      L.push('Направление: ' + r.dirName);
      L.push('Регион: ' + r.region);
      if (r.client) L.push('Плательщик: ' + r.client);
      L.push(sep);
      // позиции таблицей
      L.push(pad('Наименование',30) + pad('Кол-во',8,true) + pad('Сумма',14,true));
      r.positions.forEach(p=>{
        L.push(pad(p.name,30) + pad(num(p.qty),8,true) + pad(rub(p.sum),14,true));
      });
      L.push(sep);
      // прочие строки (вознаграждение/скидка/НДС/пошлина)
      r.lines.filter(l=>l.kind!=='pos').forEach(l=>{
        const v = l.info ? '('+rub(l.value)+')' : (l.value<0 ? '− '+rub(Math.abs(l.value)) : rub(l.value));
        L.push(pad(l.label,38) + pad(v,14,true));
      });
      L.push(sep);
      L.push(pad('ИТОГО К ОПЛАТЕ',38) + pad(rub(r.total),14,true));
      L.push(sep);
      if (requisites.bank) L.push(requisites.bank);
      L.push('');
      L.push('Расчёт предварительный, не является офертой.');
      return L.join('\n');
    }
    function pad(s, w, right){
      s = String(s);
      if (s.length > w) s = s.slice(0, w-1) + '…';
      return right ? s.padStart(w,' ') : s.padEnd(w,' ');
    }

    function fileBase(r){
      const dir = shortDir(r.dirName).replace(/[^\wА-Яа-яёЁ ]+/g,' ').trim();
      return ('Счёт ' + (r.number||'') + ' — ' + dir).replace(/\s+/g,' ').trim();
    }
    function downloadTxt(r){
      const blob = new Blob([invoiceText(r)], {type:'text/plain;charset=utf-8'});
      ui.download(fileBase(r) + '.txt', blob);
      ctx.toast('Счёт сохранён в .txt ✓','ok');
    }

    /* Фирменный бланк для печати. */
    function printInvoice(r){
      const today = new Date().toLocaleDateString('ru-RU');
      const e = ui.escape;
      const posRows = r.positions.map((p,i)=>
        `<tr><td class="n">${i+1}</td><td>${e(p.name)}</td>
             <td class="c">${num(p.qty)}</td><td class="r">${rub(p.price)}</td><td class="r">${rub(p.sum)}</td></tr>`).join('');
      const adjRows = r.lines.filter(l=>l.kind!=='pos').map(l=>{
        const neg = l.value<0;
        const val = l.info ? '<span class="info">('+rub(l.value)+')</span>' : (neg ? '− '+rub(Math.abs(l.value)) : rub(l.value));
        return `<tr class="adj${l.sub?' sub':''}"><td colspan="4">${e(l.label)}</td><td class="r">${val}</td></tr>`;
      }).join('');

      const html =
        `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${e('Счёт '+(r.number||''))}</title>
         <style>
           *{box-sizing:border-box}
           body{font-family:Arial,Helvetica,sans-serif;color:#161a22;max-width:720px;margin:28px auto;padding:0 28px;font-size:13px;line-height:1.5}
           .head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:3px solid #d62f1e;padding-bottom:16px;margin-bottom:18px}
           .brand .org{font-size:18px;font-weight:800;letter-spacing:-.01em;margin:0}
           .brand .sub{color:#4a5468;font-size:12px;margin:3px 0 0}
           .brand .req{color:#6b7585;font-size:11.5px;margin:8px 0 0;line-height:1.55}
           .logo{width:52px;height:52px;border-radius:11px;background:linear-gradient(135deg,#d62f1e,#8f1809);color:#fff;font-weight:800;font-size:26px;display:flex;align-items:center;justify-content:center;flex:0 0 52px}
           .title{font-size:20px;font-weight:800;margin:0 0 2px}
           .meta{color:#475067;font-size:12.5px;margin:0 0 18px;line-height:1.6}
           .meta b{color:#161a22;font-weight:700}
           table{width:100%;border-collapse:collapse;font-size:12.5px}
           thead th{text-align:left;background:#f3f5f8;color:#475067;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:8px 8px;border-bottom:2px solid #d8dee7}
           thead th.c{text-align:center} thead th.r{text-align:right}
           tbody td{padding:8px 8px;border-bottom:1px solid #e8ebf0;vertical-align:top}
           td.n{color:#8a93a3;width:26px} td.c{text-align:center;white-space:nowrap} td.r{text-align:right;white-space:nowrap}
           tr.adj td{border-bottom:1px solid #eef1f5;color:#475067}
           tr.adj.sub td{font-weight:700;color:#161a22;border-top:1px solid #d8dee7}
           .info{color:#8a93a3}
           tr.total td{font-size:16px;font-weight:800;border-top:2px solid #161a22;border-bottom:none;padding-top:12px}
           .bank{margin-top:18px;padding:12px 14px;background:#f7f9fb;border:1px solid #e7ebf1;border-radius:8px;color:#475067;font-size:12px}
           .foot{color:#8a93a3;font-size:11.5px;margin-top:20px;border-top:1px solid #e8ebf0;padding-top:12px}
           @media print{ body{margin:0;padding:0} @page{margin:16mm} }
         </style></head><body>
         <div class="head">
           <div class="brand">
             <p class="org">${e(requisites.org)}</p>
             ${requisites.sub?`<p class="sub">${e(requisites.sub)}</p>`:''}
             <p class="req">${[requisites.addr, requisites.contact].filter(Boolean).map(e).join('<br>')}</p>
           </div>
           <div class="logo">С</div>
         </div>
         <h1 class="title">Счёт ${e(r.number||'')} <span style="font-size:13px;font-weight:500;color:#8a93a3">(предварительный расчёт)</span></h1>
         <p class="meta">
           <b>Дата:</b> ${e(today)}<br>
           <b>Направление:</b> ${e(r.dirName)}<br>
           <b>Регион:</b> ${e(r.region)}${r.client?`<br><b>Плательщик:</b> ${e(r.client)}`:''}
         </p>
         <table>
           <thead><tr><th class="n">№</th><th>Наименование</th><th class="c">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead>
           <tbody>
             ${posRows}
             ${adjRows}
             <tr class="total"><td colspan="4">ИТОГО к оплате</td><td class="r">${rub(r.total)}</td></tr>
           </tbody>
         </table>
         ${requisites.bank?`<div class="bank"><b>Реквизиты для оплаты:</b> ${e(requisites.bank)}</div>`:''}
         <div class="foot">Расчёт предварительный, не является офертой. Сформировано в «Сенсор Suite» — ${e(today)}.</div>
         </body></html>`;
      const w = window.open('', '_blank');
      if (!w){ ctx.toast('Разрешите всплывающие окна для печати','err'); return; }
      w.document.write(html); w.document.close();
      w.focus();
      setTimeout(()=>{ try{ w.print(); }catch(e){} }, 120);
    }

    /* ── редактор реквизитов бланка ── */
    async function editRequisites(){
      const m = ui.modal('Реквизиты бланка',
        `<p class="hint" style="margin:-4px 0 14px">Печатаются в шапке счёта и в .txt. Хранятся локально, обезличенно.</p>
         ${ui.field('Организация', `<input id="rq-org" value="${ui.escape(requisites.org)}">`)}
         ${ui.field('Подзаголовок', `<input id="rq-sub" value="${ui.escape(requisites.sub)}">`)}
         ${ui.field('Адрес', `<input id="rq-addr" value="${ui.escape(requisites.addr)}">`)}
         ${ui.field('Контакты', `<input id="rq-contact" value="${ui.escape(requisites.contact)}">`)}
         ${ui.field('Реквизиты для оплаты', `<input id="rq-bank" value="${ui.escape(requisites.bank)}">`)}
         <div class="btn-row" style="justify-content:space-between;margin-top:16px">
           <button class="btn ghost sm" data-act="reset" type="button">Сбросить</button>
           <span style="display:flex;gap:9px">
             <button class="btn" data-act="cancel" type="button">Отмена</button>
             <button class="btn primary" data-act="save" type="button">Сохранить</button>
           </span>
         </div>`);
      const get = id => m.body.querySelector('#'+id).value;
      m.body.querySelector('[data-act="save"]').onclick = ()=>{
        requisites = { org:get('rq-org'), sub:get('rq-sub'), addr:get('rq-addr'), contact:get('rq-contact'), bank:get('rq-bank') };
        ctx.store.set('nok_requisites', requisites);
        m.close(); ctx.toast('Реквизиты сохранены ✓','ok');
      };
      m.body.querySelector('[data-act="cancel"]').onclick = ()=>m.close();
      m.body.querySelector('[data-act="reset"]').onclick = ()=>{
        requisites = Object.assign({}, DEFAULT_REQUISITES);
        ['org','sub','addr','contact','bank'].forEach(k=>{ const el=m.body.querySelector('#rq-'+k); if(el) el.value = requisites[k]; });
      };
    }

    /* кнопка «реквизиты» в шапке параметров — добавляем неинвазивно */
    (function addReqButton(){
      const head = root.querySelector('.card h3');
      if (!head) return;
      const b = document.createElement('button');
      b.className = 'btn sm ghost'; b.type = 'button';
      b.style.cssText = 'margin-left:auto;font-size:12px';
      b.textContent = '⚙︎ Реквизиты бланка';
      b.onclick = editRequisites;
      head.appendChild(b);
    })();

    /* ── первый рендер ── */
    syncDirHint();
    renderPositions();
    renderResult();
    renderHistory();
  }
});

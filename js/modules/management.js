/* Модуль «Управление» — РНП-дашборд (Реестр Новых Продаж): план/факт по блокам.
   Источник реальной структуры — РНП Сенсор 2026 (обезличено). Работает на моке без ключей:
   тянет window.SEED.rnp, импорт из Google Sheets (ctx.integrations.google_sheets.run('values',{range}))
   и из amoCRM (ctx.integrations.amocrm.run('leads')). */
SensorApp.register({
  id: 'management', title: 'РНП-дашборд', dept: 'Управление', order: 50,
  icon: '📊', description: 'Реестр новых продаж · план/факт по блокам, импорт из Google Sheets и amoCRM',
  mount(root, ctx){
    const ui = ctx.ui;

    /* ── Демо-данные РНП (обезличены: вместо фамилий — роли/блоки) ─────────── */
    const SEED_RNP = {
      period: 'Май 2026',
      currency: '₽',
      blocks: [
        { name: 'Финансы', owner: 'Финансовый директор', metrics: [
          { name: 'Маржинальная прибыль (месяц)', plan: 14_500_000, fact: 13_120_000, unit: '₽' },
          { name: 'Выручка месячная',              plan: 28_000_000, fact: 26_900_000, unit: '₽' },
          { name: 'Чистая прибыль / выручка',      plan: 18, fact: 16.4, unit: '%' },
        ]},
        { name: 'Продажи (ОП)', owner: 'РОП', metrics: [
          { name: 'Маржа отдела продаж (месяц)',   plan: 9_600_000, fact: 8_900_000, unit: '₽' },
          { name: 'Обработано лидов всего',         plan: 480, fact: 451, unit: 'шт' },
          { name: 'Конверсия МЧС',                  plan: 14, fact: 11, unit: '%' },
          { name: 'Конверсия Аттестация',           plan: 12, fact: 12, unit: '%' },
          { name: 'Продажи по сарафану',            plan: 12, fact: 4, unit: 'шт' },
        ]},
        { name: 'СРО', owner: 'РОП', metrics: [
          { name: 'Сумма продаж СРО (ОП)',          plan: 1_800_000, fact: 1_950_000, unit: '₽' },
          { name: 'Кол-во продаж СРО (ОП)',         plan: 5, fact: 3, unit: 'шт' },
        ]},
        { name: 'Передачи в ОДП', owner: 'РОП', metrics: [
          { name: 'Передано из ОП в ОДП',           plan: 50, fact: 41, unit: 'шт' },
          { name: 'Долги по передаче в ДО',         plan: 0, fact: 1, unit: 'шт', invert: true },
        ]},
        { name: 'Холодный отдел', owner: 'РГ холодняк', metrics: [
          { name: 'Маржа холодняк (месяц)',         plan: 3_400_000, fact: 2_980_000, unit: '₽' },
          { name: 'Переданных лидов (месяц)',       plan: 82, fact: 82, unit: 'шт' },
          { name: 'Кол-во звонков',                 plan: 4_200, fact: 4_010, unit: 'шт' },
        ]},
        { name: 'Допродажи (ОДП)', owner: 'РОП ОДП', metrics: [
          { name: 'Маржа допродаж ОДП1+ОДП2',       plan: 9_700_000, fact: 9_310_000, unit: '₽' },
          { name: 'R/R по отделу',                  plan: 85, fact: 89, unit: '%' },
          { name: 'Средний чек',                    plan: 90_000, fact: 51_000, unit: '₽' },
          { name: 'Касание базы (все отделы)',      plan: 100, fact: 78, unit: '%' },
          { name: '% активной базы',                plan: 6.7, fact: 6.2, unit: '%' },
        ]},
        { name: 'Условный отказ (УО)', owner: 'РГ УО', metrics: [
          { name: 'Принято лидов из УО',            plan: 70, fact: 50, unit: 'шт' },
          { name: 'Сумма продаж по воронке УО',     plan: 600_000, fact: 450_000, unit: '₽' },
        ]},
        { name: 'Дебиторка', owner: 'Юрист', metrics: [
          { name: 'Просроченная дебиторка (сумма)', plan: 0, fact: 1_240_000, unit: '₽', invert: true },
          { name: 'Кол-во просрочек',               plan: 0, fact: 3, unit: 'шт', invert: true },
          { name: 'Общая дебиторка (сумма)',        plan: 3_000_000, fact: 3_400_000, unit: '₽', invert: true },
        ]},
        { name: 'Сегментация базы', owner: 'РОП ОДП', metrics: [
          { name: 'Клиенты A-категории',            plan: 120, fact: 116, unit: 'шт' },
          { name: 'Клиенты S-категории',            plan: 18,  fact: 16,  unit: 'шт' },
          { name: 'Прирост базы (мес.)',            plan: 150, fact: 155, unit: 'шт' },
        ]},
      ],
    };

    /* текущие данные дашборда + флаг демо */
    let rnp = clone(ctx.data.rnp && ctx.data.rnp.blocks ? ctx.data.rnp : SEED_RNP);
    let demo = true;        // данные из сида → демо
    let demoNote = 'демо-данные (РНП Сенсор, обезличено)';

    render();

    /* ── Рендер каркаса ──────────────────────────────────────────────────── */
    function render(){
      root.innerHTML =
        ui.card('РНП — реестр новых продаж',
          'Сводка план/факт по блокам за период. Импортируйте свежие цифры из Google Sheets или amoCRM — без ключей покажутся демо-данные.',
          `<div class="btn-row">
             <button class="btn primary" id="imp-sheets">📥 Импорт из Google Sheets</button>
             <button class="btn" id="imp-amo">📥 Из amoCRM</button>
             <button class="btn ghost sm" id="reset" title="Вернуть демо-данные">↺ Демо</button>
             <span class="spacer" style="flex:1"></span>
             <span class="badge" id="period">${ui.escape(rnp.period||'—')}</span>
             <span id="demo-badge"></span>
           </div>`) +
        `<div id="kpi"></div>` +
        `<div id="cards"></div>` +
        `<div id="tbl"></div>`;

      paint();

      root.querySelector('#imp-sheets').onclick = importSheets;
      root.querySelector('#imp-amo').onclick = importAmo;
      root.querySelector('#reset').onclick = ()=>{
        rnp = clone(ctx.data.rnp && ctx.data.rnp.blocks ? ctx.data.rnp : SEED_RNP);
        demo = true; demoNote = 'демо-данные (РНП Сенсор, обезличено)';
        paint(); ctx.toast('Загружены демо-данные','info');
      };
    }

    /* ── Перерисовка содержимого (бейдж + KPI + карточки + таблица) ───────── */
    function paint(){
      root.querySelector('#period').textContent = rnp.period || '—';
      root.querySelector('#demo-badge').innerHTML =
        demo ? `<span class="badge warn" title="${ui.escape(demoNote)}">демо-данные</span>`
             : `<span class="badge ok">импортировано</span>`;
      root.querySelector('#kpi').innerHTML = renderKpi();
      root.querySelector('#cards').innerHTML = renderCards();
      root.querySelector('#tbl').innerHTML = renderTable();
    }

    /* агрегаты по всем метрикам */
    function renderKpi(){
      const all = flat();
      const okN = all.filter(m=>status(m)==='ok').length;
      const warnN = all.filter(m=>status(m)==='warn').length;
      const errN = all.filter(m=>status(m)==='err').length;
      const avg = all.length ? Math.round(all.reduce((s,m)=>s+pct(m),0)/all.length) : 0;
      const tile = (label, val, cls)=>
        `<div class="card" style="padding:14px 16px;text-align:center">
           <div class="hint" style="margin:0 0 6px">${ui.escape(label)}</div>
           <div style="font-size:26px;font-weight:700;color:${cls}">${val}</div>
         </div>`;
      return `<div class="grid cols-3" style="margin-top:16px">
        ${tile('Среднее выполнение плана', avg+'%', avg>=95?'var(--ok)':avg>=80?'var(--warn)':'var(--err)')}
        ${tile('Блоков всего · показателей', rnp.blocks.length+' · '+all.length, 'var(--ink)')}
        ${tile('В норме / риск / провал', `${okN} / ${warnN} / ${errN}`, 'var(--ink)')}
      </div>`;
    }

    /* карточки по показателям (grid.cols-3) */
    function renderCards(){
      let html = '';
      rnp.blocks.forEach(b=>{
        html += `<div class="card" style="margin-top:16px">
          <h3>${ui.escape(b.name)} ${b.owner?`<span class="badge" style="vertical-align:1px">${ui.escape(b.owner)}</span>`:''}</h3>
          <div class="grid cols-3" style="margin-top:6px">`;
        (b.metrics||[]).forEach(m=>{
          const st = status(m), p = pct(m);
          const col = st==='ok'?'var(--ok)':st==='warn'?'var(--warn)':'var(--err)';
          const bcls = st==='ok'?'ok':st==='err'?'err':'warn';
          html += `<div class="card" style="padding:13px 15px;box-shadow:none">
            <div class="hint" style="margin:0 0 8px;min-height:2.6em">${ui.escape(m.name)}</div>
            <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
              <span style="font-size:22px;font-weight:700;color:${col}">${p}%</span>
              <span class="badge ${bcls}">${st==='ok'?'в плане':st==='warn'?'риск':'провал'}</span>
            </div>
            <div class="mono" style="color:var(--ink-2)">план ${fmt(m.plan,m.unit)} · факт ${fmt(m.fact,m.unit)}</div>
            <div style="height:6px;border-radius:99px;background:var(--line);margin-top:9px;overflow:hidden">
              <div style="height:100%;width:${Math.max(0,Math.min(100,p))}%;background:${col}"></div>
            </div>
          </div>`;
        });
        html += `</div></div>`;
      });
      return html;
    }

    /* сводная таблица */
    function renderTable(){
      const rows = [];
      rnp.blocks.forEach(b=>(b.metrics||[]).forEach(m=>{
        const st = status(m), bcls = st==='ok'?'ok':st==='err'?'err':'warn';
        rows.push(`<tr>
          <td>${ui.escape(b.name)}</td>
          <td>${ui.escape(m.name)}</td>
          <td class="mono">${fmt(m.plan,m.unit)}</td>
          <td class="mono">${fmt(m.fact,m.unit)}</td>
          <td class="mono">${pct(m)}%</td>
          <td><span class="badge ${bcls}">${st==='ok'?'в плане':st==='warn'?'риск':'провал'}</span></td>
        </tr>`);
      }));
      return ui.card('Сводная таблица', flat().length+' показателей по '+rnp.blocks.length+' блокам',
        rows.length
          ? `<div style="max-height:420px;overflow:auto"><table class="tbl">
               <thead><tr><th>Блок</th><th>Показатель</th><th>План</th><th>Факт</th><th>%</th><th>Статус</th></tr></thead>
               <tbody>${rows.join('')}</tbody></table></div>`
          : ui.empty('📊','Нет показателей.'));
    }

    /* ── Импорт из Google Sheets ─────────────────────────────────────────── */
    async function importSheets(){
      const btn = root.querySelector('#imp-sheets');
      const integ = ctx.integrations && ctx.integrations.google_sheets;
      if(!integ){ ctx.toast('Интеграция Google Sheets не подключена','err'); return; }
      lock(btn, true, 'Загрузка');
      try{
        const res = await integ.run('values', { range: rnp.period ? `'${rnp.period}'!A1:F200` : 'РНП!A1:F200' });
        const rows = res && res.data && (res.data.values || res.data.rows || res.data);
        const parsed = parseSheetRows(rows);
        if(parsed && parsed.blocks.length){
          rnp = parsed;
          demo = !!res.mock; demoNote = res.note || demoNote;
          paint();
          handleResult(res, 'Google Sheets', parsed.blocks.length+' блоков');
        } else {
          ctx.toast('Не удалось распознать структуру РНП в таблице','err');
          if(res && res.note) ctx.toast(res.note,'info');
        }
      }catch(e){ ctx.toast('Ошибка импорта: '+(e&&e.message||e),'err'); }
      finally{ lock(btn, false, '📥 Импорт из Google Sheets'); }
    }

    /* ── Импорт из amoCRM ────────────────────────────────────────────────── */
    async function importAmo(){
      const btn = root.querySelector('#imp-amo');
      const integ = ctx.integrations && ctx.integrations.amocrm;
      if(!integ){ ctx.toast('Интеграция amoCRM не подключена','err'); return; }
      lock(btn, true, 'Загрузка');
      try{
        const res = await integ.run('leads');
        const leads = res && res.data && (res.data._embedded && res.data._embedded.leads || res.data.leads || (Array.isArray(res.data)?res.data:null));
        const agg = aggregateLeads(leads);
        if(agg){
          // обновляем фактический объём продаж в блоке «Продажи (ОП)» из CRM
          mergeFromCrm(agg);
          demo = !!res.mock; demoNote = res.note || demoNote;
          paint();
          handleResult(res, 'amoCRM', `${agg.count} сделок · ${fmt(agg.sum,'₽')}`);
        } else {
          ctx.toast('В ответе amoCRM нет сделок','err');
          if(res && res.note) ctx.toast(res.note,'info');
        }
      }catch(e){ ctx.toast('Ошибка импорта: '+(e&&e.message||e),'err'); }
      finally{ lock(btn, false, '📥 Из amoCRM'); }
    }

    /* реакция на .mock/.note/.error из обёртки интеграции */
    function handleResult(res, src, detail){
      if(res.error){ ctx.toast(`${src}: ${res.error}`,'err'); return; }
      if(res.mock){
        ctx.toast(`${src}: ${res.note||'нет ключей — показаны демо-данные'}`,'info');
      } else {
        ctx.toast(`${src}: импортировано (${detail}) ✓`,'ok');
      }
    }

    /* ── Парсеры/агрегаторы ──────────────────────────────────────────────── */
    // Ожидаем строки вида: [Блок|'', Показатель, План, Факт] (% считаем сами).
    function parseSheetRows(rows){
      if(!Array.isArray(rows) || !rows.length) return null;
      const out = { period: rnp.period, currency: '₽', blocks: [] };
      let cur = null;
      rows.forEach((r, i)=>{
        if(!Array.isArray(r)) return;
        const c0 = String(r[0]||'').trim();
        const name = String(r[1]||'').trim();
        const plan = num(r[2]), fact = num(r[3]);
        if(i===0 && /показатель|план|факт/i.test((r.join(' ')||''))) return; // шапка
        if(c0 && !name){ cur = { name: c0, metrics: [] }; out.blocks.push(cur); return; }
        if(c0 && name){ cur = { name: c0, metrics: [] }; out.blocks.push(cur); }
        if(!cur){ cur = { name: 'Прочее', metrics: [] }; out.blocks.push(cur); }
        if(name && (plan!=null || fact!=null)){
          cur.metrics.push({ name, plan: plan||0, fact: fact||0, unit: guessUnit(name) });
        }
      });
      out.blocks = out.blocks.filter(b=>b.metrics.length);
      return out.blocks.length ? out : null;
    }

    function aggregateLeads(leads){
      if(!Array.isArray(leads) || !leads.length) return null;
      const won = leads.filter(l=>{
        const s = String(l.status_id||l.status||'').toLowerCase();
        return l.status_id===142 || /won|оплач|закры/.test(s) || l.price>0;
      });
      const sum = won.reduce((s,l)=>s+(Number(l.price)||0),0);
      return { count: won.length || leads.length, sum, total: leads.length };
    }

    function mergeFromCrm(agg){
      const op = rnp.blocks.find(b=>/прода/i.test(b.name)) || rnp.blocks[0];
      if(!op) return;
      let m = (op.metrics||[]).find(x=>/маржа|сумм|выручк/i.test(x.name));
      if(m){ m.fact = agg.sum; }
      let l = (op.metrics||[]).find(x=>/лид/i.test(x.name));
      if(l){ l.fact = agg.total; }
    }

    /* ── Утилиты ─────────────────────────────────────────────────────────── */
    function pct(m){ if(!m.plan) return m.fact?100:0; return Math.round((m.fact/m.plan)*100); }
    // status учитывает invert (для дебиторки/долгов меньше = лучше)
    function status(m){
      let p = pct(m);
      if(m.invert){ p = m.plan ? Math.round((m.plan===0?0:(m.plan)/(m.fact||1))*100) : (m.fact?0:100);
        if(m.plan===0) return m.fact>0 ? 'err' : 'ok'; }
      if(p>=95) return 'ok';
      if(p>=80) return 'warn';
      return 'err';
    }
    function fmt(v, unit){
      if(v==null||v==='') return '—';
      if(unit==='%') return v+'%';
      if(unit==='₽'){
        const n = Number(v);
        if(Math.abs(n)>=1_000_000) return (n/1_000_000).toLocaleString('ru-RU',{maximumFractionDigits:2})+' млн ₽';
        return n.toLocaleString('ru-RU')+' ₽';
      }
      return Number(v).toLocaleString('ru-RU')+(unit?(' '+unit):'');
    }
    function guessUnit(name){
      if(/%|конверс|R\/R|актив/i.test(name)) return '%';
      if(/маржа|маржинал|выручк|прибыл|сумм|чек|долг|дебитор/i.test(name)) return '₽';
      return 'шт';
    }
    function num(v){ if(v==null||v==='') return null;
      const n = parseFloat(String(v).replace(/[\s ]/g,'').replace(/,/,'.').replace(/[^0-9.\-]/g,'')); return isNaN(n)?null:n; }
    function flat(){ return rnp.blocks.reduce((a,b)=>a.concat(b.metrics||[]),[]); }
    function clone(o){ return JSON.parse(JSON.stringify(o)); }
    function lock(btn, on, label){ if(!btn) return; btn.disabled=on;
      btn.innerHTML = on ? (ui.spinner+' '+label) : label; }
  }
});

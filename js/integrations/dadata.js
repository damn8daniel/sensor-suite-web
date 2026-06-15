/* Интеграция «DaData» — пробив контрагентов по ИНН/ОГРН/названию (ЕГРЮЛ/ЕГРИП).
   ────────────────────────────────────────────────────────────────────────────
   webCapable:true — Suggestions API DaData отдаёт CORS-заголовки, авторизация
   токеном в рантайме, поэтому пробив работает прямо из браузера (web и desktop).

   Контракт ответа СОХРАНЁН для потребителей (licensing.js, counterparties.js):
   каждый из методов отдаёт плоскую карточку
       { name, inn, kpp, ogrn, address, manager, status }
   плюс — additively — обогащённые поля, которые старый код просто игнорирует:
       { type, opf, statusRaw, statusDate, okved, okvedName, okvedList,
         registrationDate, liquidationDate, managementName, managementPost,
         branchType, capital, employeeCount, finance, value, _raw, _alternatives }

   Методы (ctx.integrations.dadata.run(method, params)):
     • 'findById' — поиск юрлица/ИП по ИНН или ОГРН (одна организация). По 10-/
                    13-значному коду вернётся компания, по 12-/15-значному — ИП.
                    Если у ИНН несколько КПП (филиалы), уточняйте params.kpp.
     • 'suggest'  — подсказки по части названия/ИНН (несколько кандидатов).
                    Возвращает лучший матч + _alternatives[] с остальными.
     • 'party'    — синоним findById (как в терминологии DaData /suggest/party).
   params: строка-запрос ЛИБО объект
     { query, count?, kpp?, branch_type?, type?('LEGAL'|'INDIVIDUAL'), status?[] }

   Все helper-функции скрыты в IIFE: соседняя интеграция spark.js объявляет
   глобальные normalize()/statusLabel()/riskLabel() — изоляция исключает их
   взаимное затирание (classic <script>, без import/export). */
(function () {
  'use strict';

  var SUGGEST_BASE = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/';

  /* ── Регистрация интеграции ─────────────────────────────────────────────── */
  SensorApp.registerIntegration({
    id: 'dadata',
    title: 'DaData',
    webCapable: true,
    fields: [
      { key: 'token', label: 'API-токен (Suggestions)', type: 'password' }
    ],

    // Лимит бесплатного тарифа DaData Suggestions: 10 000 запросов/сутки.
    // Это лишь подсказка для сообщений об ошибках — счётчик ведёт сам сервис.
    dailyFreeLimit: 10000,
    // Таймаут одиночного запроса и число повторов на сетевых/5xx сбоях.
    timeoutMs: 12000,
    maxRetries: 2,

    /* ── Основной интерфейс ───────────────────────────────────────────────── */
    async call(method, params, creds) {
      var m = normMethod(method);
      var p = normParams(params);
      if (!p.query) throw new Error('Пустой запрос: укажите ИНН, ОГРН или название.');

      // Тело запроса к Suggestions API. count: findById/party — один точный
      // результат; suggest — до 10 кандидатов (DaData потолок — 20).
      var body = { query: p.query, count: clampCount(p.count, m) };
      if (p.kpp)         body.kpp = p.kpp;                 // выбрать филиал по КПП
      if (p.branch_type) body.branch_type = p.branch_type; // 'MAIN' | 'BRANCH'
      if (p.type)        body.type = p.type;               // 'LEGAL' | 'INDIVIDUAL'
      if (p.status && p.status.length) body.status = p.status; // ['ACTIVE',...]

      var url = SUGGEST_BASE + (m === 'suggest' ? 'suggest' : 'findById') + '/party';
      var json = await request(url, creds, body, this);

      var list = (json && json.suggestions) || [];
      if (!list.length) {
        var byWhat = /^\d+$/.test(p.query)
          ? 'по ИНН/ОГРН «' + p.query + '»'
          : 'по запросу «' + p.query + '»';
        throw new Error('Контрагент не найден ' + byWhat + '. Проверьте корректность реквизитов.');
      }

      var card = normalizeSuggestion(list[0]);
      // suggest — приложим остальных кандидатов для богатых UI (потребители,
      // читающие только плоские поля, их игнорируют).
      if (m === 'suggest' && list.length > 1) {
        card._alternatives = list.slice(1, 10).map(normalizeSuggestion);
      }
      return card;
    },

    /* ── Проверка соединения ──────────────────────────────────────────────── */
    async test(creds) {
      if (!creds || !String(creds.token || '').trim()) {
        return { ok: false, detail: 'Не указан API-токен DaData (Личный кабинет → API → «Токен для доступа к API»).' };
      }
      try {
        var json = await request(
          SUGGEST_BASE + 'findById/party',
          creds,
          { query: '7707083893', count: 1 }, // ПАО Сбербанк — публичный эталон
          this
        );
        var sug = json && json.suggestions && json.suggestions[0];
        if (sug) {
          var name = (sug.data && sug.data.name && (sug.data.name.short_with_opf || sug.data.name.full_with_opf)) || sug.value;
          return { ok: true, detail: 'Соединение в порядке · эталон: ' + (name || 'ответ получен') };
        }
        return { ok: false, detail: 'Сервис ответил, но без данных (suggestions пуст). Проверьте права токена.' };
      } catch (e) {
        return { ok: false, detail: String(e && e.message || e) };
      }
    },

    /* ── Демо-данные (без ключей / для дизайна) ───────────────────────────────
       Подбираем образец под запрос: по ИНН/ОГРН — точное совпадение из набора,
       иначе — по вхождению в название; на крайний случай первая запись.
       Все организации обезличены/демонстрационные (ПДн нет). */
    mock(method, params) {
      var m = normMethod(method);
      var p = normParams(params);
      var q = (p.query || '').trim();
      var digits = q.replace(/\D/g, '');
      var lower = q.toLowerCase();
      var bank = mockBank();

      var hit = null;
      if (digits) {
        hit = bank.filter(function (x) { return x.inn === digits || x.ogrn === digits; })[0] || null;
        // частичный ИНН (живой ввод) — первый, чей ИНН начинается с цифр
        if (!hit && digits.length >= 3) {
          hit = bank.filter(function (x) { return x.inn.indexOf(digits) === 0; })[0] || null;
        }
      }
      if (!hit && lower) {
        hit = bank.filter(function (x) { return x.name.toLowerCase().indexOf(lower) >= 0; })[0] || null;
      }
      if (!hit) hit = bank[0];

      var card = mockCard(hit);
      if (m === 'suggest') {
        var rest = bank.filter(function (x) { return x !== hit; }).slice(0, 4).map(mockCard);
        if (rest.length) card._alternatives = rest;
      }
      return card;
    }
  });

  /* ════════════════════════════════════════════════════════════════════════
     Низкоуровневый запрос: таймаут (AbortController), ретрай на сетевых/5xx
     сбоях, разбор тела, дружелюбные коды ошибок.
     cfg — объект интеграции (this): timeoutMs, maxRetries, dailyFreeLimit.
     ════════════════════════════════════════════════════════════════════════ */
  async function request(url, creds, body, cfg) {
    var token = String((creds && creds.token) || '').trim();
    if (!token) throw new Error('Не указан API-токен DaData.');

    cfg = cfg || {};
    var dailyLimit = cfg.dailyFreeLimit || 10000;
    var timeoutMs = cfg.timeoutMs || 12000;
    var maxRetries = cfg.maxRetries != null ? cfg.maxRetries : 2;

    // В desktop можно ходить через мост (обход CORS не нужен — DaData его отдаёт,
    // но мост стабильнее за прокси); в вебе — обычный fetch.
    var doFetch = (SensorApp.env === 'desktop' && SensorApp.node && SensorApp.node.fetch)
      ? SensorApp.node.fetch
      : fetch;

    var lastNetErr = null;
    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      var resp, aborted = false;
      var ctl = makeAbort(timeoutMs);
      try {
        resp = await doFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': 'Token ' + token
          },
          body: JSON.stringify(body),
          signal: ctl.signal
        });
      } catch (netErr) {
        aborted = ctl.timedOut;
        lastNetErr = netErr;
        ctl.clear();
        // Таймаут/сетевой сбой — повторяем (запрос идемпотентный, GET-семантика).
        if (attempt < maxRetries) { await sleep(backoff(attempt)); continue; }
        if (aborted) {
          throw new Error('DaData не ответила за ' + Math.round(timeoutMs / 1000) +
            ' с (таймаут). Проверьте интернет или повторите позже.');
        }
        throw new Error('Нет связи с DaData (' + String(netErr && netErr.message || netErr) +
          '). Проверьте интернет; если стоит блокировщик/прокси — он может резать suggestions.dadata.ru.');
      }
      ctl.clear();

      var status = resp.status;

      if (status === 401 || status === 403) {
        throw new Error('Токен DaData недействителен или у него нет прав на Suggestions API ' +
          '(HTTP ' + status + '). Проверьте «Токен для доступа к API» в Личном кабинете DaData.');
      }
      if (status === 402) {
        throw new Error('Закончился баланс/лимит DaData (HTTP 402). Пополните тариф ' +
          'или дождитесь сброса суточного лимита (' + dailyLimit + ' запросов/сутки на бесплатном).');
      }
      if (status === 429) {
        // Превышен лимит запросов. Это «жёсткий» лимит — повтор не поможет сразу,
        // даём понятную подсказку (Retry-After, если сервис его прислал).
        var ra = retryAfterSeconds(resp);
        throw new Error('Превышен лимит запросов DaData (HTTP 429' +
          (ra ? ', повторить через ~' + ra + ' с' : '') + '). ' +
          'Бесплатный тариф — ' + dailyLimit + ' запросов/сутки и ограничение по частоте. ' +
          'Сбавьте темп пробивов или повысьте тариф.');
      }
      if (status === 400) {
        var bt = await safeText(resp);
        throw new Error('DaData отклонила запрос (HTTP 400)' + (bt ? ' · ' + bt.slice(0, 200) : '') +
          '. Вероятно, некорректный формат ИНН/ОГРН.');
      }
      if (status >= 500) {
        // Временный сбой сервиса — повторяем с экспоненциальной паузой.
        if (attempt < maxRetries) { await sleep(backoff(attempt)); continue; }
        var t5 = await safeText(resp);
        throw new Error('Сбой на стороне DaData (HTTP ' + status + ')' + (t5 ? ' · ' + t5.slice(0, 160) : '') +
          '. Попробуйте позже.');
      }
      if (!resp.ok) {
        var t = await safeText(resp);
        throw new Error('HTTP ' + status + (t ? ' · ' + t.slice(0, 200) : '') + ' — ошибка DaData.');
      }

      var raw = await safeText(resp);
      if (!raw) return { suggestions: [] };
      try {
        return JSON.parse(raw);
      } catch (e) {
        throw new Error('Некорректный JSON от DaData: ' + raw.slice(0, 120));
      }
    }
    // До сюда дойдём только если цикл исчерпал повторы по сетевой ошибке.
    throw new Error('Нет связи с DaData (' + String(lastNetErr && lastNetErr.message || lastNetErr || 'нет ответа') + ').');
  }

  // AbortController с таймаутом; .clear() снимает таймер, .timedOut — флаг по факту.
  function makeAbort(ms) {
    if (typeof AbortController === 'undefined') {
      return { signal: undefined, timedOut: false, clear: function () {} };
    }
    var ctl = new AbortController();
    var obj = { signal: ctl.signal, timedOut: false, clear: function () { clearTimeout(timer); } };
    var timer = setTimeout(function () { obj.timedOut = true; try { ctl.abort(); } catch (e) {} }, ms);
    return obj;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function backoff(attempt) { return Math.min(4000, 400 * Math.pow(2, attempt)); }

  function retryAfterSeconds(resp) {
    try {
      var h = resp.headers && resp.headers.get && resp.headers.get('Retry-After');
      var n = Number(h);
      return n > 0 ? n : 0;
    } catch (e) { return 0; }
  }
  async function safeText(resp) {
    try { return (await resp.text()) || ''; } catch (e) { return ''; }
  }

  /* ════════════════════════════════════════════════════════════════════════
     Нормализация ответа Suggestions API → плоская + обогащённая карточка.
     Структура data описана в DaData: name{}, address{}, management{}, opf{},
     okveds[], state{}, finance{}, fio{}, branch_type, capital и т.д.
     ════════════════════════════════════════════════════════════════════════ */
  function normalizeSuggestion(sug) {
    var d = (sug && sug.data) || {};
    var isIp = (d.type === 'INDIVIDUAL') || (String(d.inn || '').length === 12);

    // Наименование: для ИП DaData даёт name.full = «ИП Фамилия И.О.».
    var name =
      (d.name && (d.name.short_with_opf || d.name.full_with_opf || d.name.short || d.name.full)) ||
      (sug && sug.value) || '';

    // Руководитель: ЮЛ → management.name + должность; ИП → ФИО предпринимателя.
    var managementName = '';
    var managementPost = '';
    if (d.management && (d.management.name || d.management.post)) {
      managementName = d.management.name || '';
      managementPost = d.management.post || '';
    } else if (d.fio) {
      managementName = [d.fio.surname, d.fio.name, d.fio.patronymic].filter(Boolean).join(' ');
    }
    var manager = [managementName, managementPost].filter(Boolean).join(', ');

    // Основной ОКВЭД: код + расшифровка из массива okveds (main:true) либо d.okved.
    var okved = d.okved || '';
    var okvedName = '';
    var okvedList = [];
    if (Array.isArray(d.okveds) && d.okveds.length) {
      okvedList = d.okveds.map(function (o) {
        return { code: o.code || '', name: o.name || '', main: !!o.main, type: o.type || '' };
      });
      var main = okvedList.filter(function (o) { return o.main; })[0] || okvedList[0];
      if (main) { okved = okved || main.code; okvedName = main.name; }
    }

    var st = d.state || {};
    var statusRaw = st.status || '';

    var card = {
      // ── контрактные плоские поля (их читают licensing.js / counterparties.js) ──
      name: name,
      inn: d.inn || '',
      kpp: d.kpp || '',
      ogrn: d.ogrn || '',
      address: (d.address && (d.address.unrestricted_value || d.address.value)) || '',
      manager: manager,
      status: statusLabel(statusRaw),

      // ── обогащение (additive; старый код игнорирует) ──
      type: isIp ? 'ИП' : 'ЮЛ',
      opf: (d.opf && (d.opf.short || d.opf.full)) || '',
      statusRaw: String(statusRaw || '').toUpperCase(),
      statusDate: msToDate(st.actuality_date) || msToDate(st.registration_date) || '',
      registrationDate: msToDate(st.registration_date) || '',
      liquidationDate: msToDate(st.liquidation_date) || '',
      okved: okved,
      okvedName: okvedName,
      okvedList: okvedList,
      managementName: managementName,
      managementPost: managementPost,
      branchType: d.branch_type || '',          // 'MAIN' | 'BRANCH'
      capital: capitalLabel(d.capital),
      employeeCount: (d.employee_count != null) ? d.employee_count : '',
      finance: financeLabel(d.finance),
      value: (sug && sug.value) || name,
      _raw: sug || null
    };
    return card;
  }

  /* Коды состояния ЕГРЮЛ/ЕГРИП → человекочитаемая метка (рус.). */
  function statusLabel(code) {
    switch (String(code || '').toUpperCase()) {
      case 'ACTIVE':       return 'Действует';
      case 'LIQUIDATING':  return 'Ликвидируется';
      case 'LIQUIDATED':   return 'Ликвидировано';
      case 'BANKRUPT':     return 'Банкротство';
      case 'REORGANIZING': return 'В процессе присоединения';
      case '':             return '';
      default:             return String(code);
    }
  }

  function msToDate(ms) {
    if (ms == null || ms === '') return '';
    var n = Number(ms);
    if (!isFinite(n) || n <= 0) return '';
    var dt = new Date(n);
    if (isNaN(dt)) return '';
    var p = function (x) { return String(x).padStart(2, '0'); };
    return p(dt.getDate()) + '.' + p(dt.getMonth() + 1) + '.' + dt.getFullYear();
  }

  function capitalLabel(cap) {
    if (!cap || cap.value == null) return '';
    var v = Number(cap.value);
    if (!isFinite(v)) return '';
    return formatMoney(v) + ' ₽' + (cap.type ? ' (' + capitalType(cap.type) + ')' : '');
  }
  function capitalType(t) {
    switch (String(t || '').toUpperCase()) {
      case 'УК':  case 'CHARTER':    return 'уставный капитал';
      case 'УФ':  case 'FUND':       return 'уставный фонд';
      case 'СК':                     return 'складочный капитал';
      case 'ПФ':                     return 'паевой фонд';
      default:                       return String(t);
    }
  }

  function financeLabel(fin) {
    if (!fin) return '';
    var parts = [];
    if (fin.income != null)  parts.push('доход ' + formatMoney(fin.income) + ' ₽');
    if (fin.revenue != null) parts.push('выручка ' + formatMoney(fin.revenue) + ' ₽');
    if (fin.expense != null) parts.push('расход ' + formatMoney(fin.expense) + ' ₽');
    if (fin.tax_system)      parts.push(taxSystem(fin.tax_system));
    if (fin.year)            parts.push('за ' + fin.year);
    return parts.join(' · ');
  }
  function taxSystem(t) {
    switch (String(t || '').toUpperCase()) {
      case 'ОСН':  case 'OSN':   return 'ОСН';
      case 'УСН':  case 'USN':   return 'УСН';
      case 'УСН6':               return 'УСН 6 %';
      case 'УСН15':              return 'УСН 15 %';
      case 'ЕНВД':               return 'ЕНВД';
      case 'ПСН':                return 'ПСН';
      case 'ЕСХН':               return 'ЕСХН';
      default:                   return String(t);
    }
  }

  function formatMoney(v) {
    var n = Number(v);
    if (!isFinite(n)) return String(v);
    // Группировка тысяч, без дробной части (ru-RU использует пробел-разделитель).
    return Math.round(n).toLocaleString('ru-RU');
  }

  /* ── Нормализация входных параметров ─────────────────────────────────────── */
  function normMethod(method) {
    var m = String(method || '').toLowerCase();
    if (m === 'suggest') return 'suggest';
    // 'party' и всё прочее → точный поиск findById
    return 'findById';
  }
  function normParams(params) {
    if (params && typeof params === 'object') {
      var q = params.query != null ? params.query : (params.inn != null ? params.inn : '');
      return {
        query: String(q == null ? '' : q).trim(),
        count: params.count,
        kpp: params.kpp ? String(params.kpp).trim() : '',
        branch_type: params.branch_type || '',
        type: params.type || '',
        status: Array.isArray(params.status) ? params.status : null
      };
    }
    return { query: String(params == null ? '' : params).trim(), count: undefined,
             kpp: '', branch_type: '', type: '', status: null };
  }
  function clampCount(count, method) {
    var def = method === 'suggest' ? 10 : 1;
    var n = Number(count);
    if (!isFinite(n) || n <= 0) return def;
    return Math.max(1, Math.min(20, Math.round(n))); // DaData потолок — 20
  }

  /* ════════════════════════════════════════════════════════════════════════
     Демо-набор: обезличенные организации в духе предметной области Sensor
     (B2B-лицензирование МЧС, проектирование ПБ). Все ИНН/ОГРН — синтетические.
     ════════════════════════════════════════════════════════════════════════ */
  function mockBank() {
    return [
      {
        type: 'LEGAL', name: 'ООО «Ромашка»', opf: 'ООО',
        inn: '7700000001', kpp: '770001001', ogrn: '1027700000001',
        address: 'г. Москва, вн.тер.г. муниципальный округ Тверской, ул. Примерная, д. 1, помещ. 5',
        managementName: 'Иванов Иван Иванович', managementPost: 'Генеральный директор',
        status: 'ACTIVE', registrationDate: '12.03.2014', actualityDate: '01.06.2026',
        okved: '43.21', okvedName: 'Производство электромонтажных работ',
        okveds: [
          { code: '43.21', name: 'Производство электромонтажных работ', main: true },
          { code: '80.20', name: 'Деятельность систем обеспечения безопасности', main: false }
        ],
        capital: 100000, capitalType: 'УК', taxSystem: 'УСН', revenue: 28500000, year: 2024,
        employeeCount: 12
      },
      {
        type: 'LEGAL', name: 'ООО «Монтаж-Сервис»', opf: 'ООО',
        inn: '7700000002', kpp: '770201001', ogrn: '1027700000002',
        address: 'г. Москва, поселение Московский, дер. Румянцево, стр. 1, этаж 2, офис 210',
        managementName: 'Петрова Анна Сергеевна', managementPost: 'Директор',
        status: 'ACTIVE', registrationDate: '05.07.2016', actualityDate: '01.06.2026',
        okved: '80.20', okvedName: 'Деятельность систем обеспечения безопасности',
        okveds: [
          { code: '80.20', name: 'Деятельность систем обеспечения безопасности', main: true },
          { code: '43.29', name: 'Производство прочих строительно-монтажных работ', main: false }
        ],
        capital: 250000, capitalType: 'УК', taxSystem: 'ОСН', revenue: 61000000, year: 2024,
        employeeCount: 27
      },
      {
        type: 'INDIVIDUAL', name: 'ИП Сидоров Пётр Алексеевич', opf: 'ИП',
        inn: '770300000003', kpp: '', ogrn: '320770000000003',
        address: 'г. Москва',
        fioSurname: 'Сидоров', fioName: 'Пётр', fioPatronymic: 'Алексеевич',
        managementPost: 'Индивидуальный предприниматель',
        status: 'ACTIVE', registrationDate: '18.09.2020', actualityDate: '01.06.2026',
        okved: '71.12.4', okvedName: 'Деятельность в области проектирования инженерных систем',
        okveds: [
          { code: '71.12.4', name: 'Деятельность, связанная с разработкой проектов в области пожарной безопасности', main: true }
        ],
        capital: 0, taxSystem: 'УСН6', revenue: 4200000, year: 2024, employeeCount: 0
      },
      {
        type: 'LEGAL', name: 'АО «Пожпроект»', opf: 'АО',
        inn: '7800000004', kpp: '780001001', ogrn: '1027800000004',
        address: 'г. Санкт-Петербург, наб. Примерная, д. 7, литера А, пом. 12-Н',
        managementName: 'Кузнецов Дмитрий Олегович', managementPost: 'Генеральный директор',
        status: 'ACTIVE', registrationDate: '22.02.2012', actualityDate: '01.06.2026',
        okved: '71.12.45', okvedName: 'Инженерно-технологическое проектирование объектов',
        okveds: [
          { code: '71.12.45', name: 'Инженерно-технологическое проектирование объектов', main: true },
          { code: '74.90', name: 'Деятельность профессиональная научная и техническая прочая', main: false }
        ],
        capital: 1000000, capitalType: 'УК', taxSystem: 'ОСН', revenue: 154000000, year: 2024,
        employeeCount: 64
      },
      {
        type: 'LEGAL', name: 'ООО «Гранит-Безопасность»', opf: 'ООО',
        inn: '5000000005', kpp: '500001001', ogrn: '1095000000005',
        address: 'Московская обл., г. Химки, ул. Промышленная, д. 14, корп. 2',
        managementName: 'Смирнова Ольга Викторовна', managementPost: 'Директор',
        status: 'LIQUIDATING', registrationDate: '30.11.2009', actualityDate: '15.05.2026',
        okved: '43.22', okvedName: 'Производство санитарно-технических работ, монтаж систем',
        okveds: [
          { code: '43.22', name: 'Производство санитарно-технических работ, монтаж систем', main: true }
        ],
        capital: 100000, capitalType: 'УК', taxSystem: 'ОСН', revenue: 9800000, year: 2023,
        employeeCount: 5
      },
      {
        type: 'LEGAL', name: 'ООО «Старый Огнезащит»', opf: 'ООО',
        inn: '6300000006', kpp: '630001001', ogrn: '1086300000006',
        address: 'г. Самара, ул. Заводская, д. 3',
        managementName: 'Фёдоров Алексей Иванович', managementPost: 'Конкурсный управляющий',
        status: 'BANKRUPT', registrationDate: '14.08.2008', actualityDate: '28.04.2026',
        liquidationDate: '',
        okved: '25.21', okvedName: 'Производство радиаторов и котлов центрального отопления',
        okveds: [
          { code: '25.21', name: 'Производство радиаторов и котлов центрального отопления', main: true }
        ],
        capital: 100000, capitalType: 'УК', taxSystem: 'ОСН', revenue: 0, year: 2023,
        employeeCount: 0
      }
    ];
  }

  /* Запись демо-набора → карточка той же формы, что normalizeSuggestion(). */
  function mockCard(x) {
    var managementName = x.managementName || [x.fioSurname, x.fioName, x.fioPatronymic].filter(Boolean).join(' ');
    var manager = [managementName, x.managementPost].filter(Boolean).join(', ');
    var okvedList = (x.okveds || []).map(function (o) {
      return { code: o.code || '', name: o.name || '', main: !!o.main, type: o.type || '' };
    });
    return {
      name: x.name,
      inn: x.inn,
      kpp: x.kpp || '',
      ogrn: x.ogrn,
      address: x.address || '',
      manager: manager,
      status: statusLabel(x.status),

      type: x.type === 'INDIVIDUAL' ? 'ИП' : 'ЮЛ',
      opf: x.opf || '',
      statusRaw: String(x.status || '').toUpperCase(),
      statusDate: x.actualityDate || x.registrationDate || '',
      registrationDate: x.registrationDate || '',
      liquidationDate: x.liquidationDate || '',
      okved: x.okved || '',
      okvedName: x.okvedName || '',
      okvedList: okvedList,
      managementName: managementName,
      managementPost: x.managementPost || '',
      branchType: 'MAIN',
      capital: x.capital != null ? capitalLabel({ value: x.capital, type: x.capitalType }) : '',
      employeeCount: (x.employeeCount != null) ? x.employeeCount : '',
      finance: financeLabel(x.revenue != null ? { revenue: x.revenue, tax_system: x.taxSystem, year: x.year } : null),
      value: x.name,
      _raw: null
    };
  }
})();

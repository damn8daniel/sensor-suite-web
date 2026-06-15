/* ════════════════════════════════════════════════════════════════════════
   Интеграция «SPARK Интерфакс» — пробив контрагентов по ИНН.
   ────────────────────────────────────────────────────────────────────────
   SPARK API (Интерфакс) — корпоративный SOAP/REST-сервис. Основные операции:
     • GetCompanyShortReport    — короткая справка (реквизиты, статус, ИДО);
     • GetCompanyExtendedReport — расширенная справка (+ ОКВЭД, учредители,
                                   финпоказатели, арбитраж, госконтракты).
   Доступ выдаётся по договору: выделенный логин/ключ + белый список IP.

   webCapable:false — почему из браузера нельзя:
     1) SPARK API не отдаёт CORS-заголовков → fetch из web блокируется;
     2) трафик идёт с разрешённых IP (белый список), браузер этого не даёт;
     3) ключ нельзя светить в клиентском JS.
   → В web ядро (app.js makeIntegration) увидит webCapable:false и вернёт
     демо-данные mock(). Реальный вызов работает только в desktop через мост
     SensorApp.node.fetch (запрос без CORS, с серверного IP).

   Контракт интеграции (CONTRACT.md): registerIntegration + обязательный mock().
   Весь файл обёрнут в IIFE: внутренние helper-функции (normalize/parseXml/…)
   НЕ попадают в global scope, чтобы не конфликтовать с одноимёнными
   функциями в dadata.js (там тоже есть normalize/statusLabel).
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ---- хосты SPARK API (выдаются при подключении корпоративного доступа) ---- */
  // Боевой SOAP-эндпоинт и REST-шлюз. Здесь — адреса-каркасы; реальные значения
  // прописываются менеджером Интерфакса под конкретный договор/белый список IP.
  var SOAP_ENDPOINT = 'https://api.spark-interfax.ru/iface/Spark.asmx';
  var SOAP_NS       = 'http://interfax.ru/ifaxwebsvc/spark';
  var REST_BASE     = 'https://api.spark-interfax.ru/v1';

  // method → операция SPARK
  var OPS = {
    company:        'GetCompanyShortReport',
    short:          'GetCompanyShortReport',
    shortReport:    'GetCompanyShortReport',
    extended:       'GetCompanyExtendedReport',
    extendedReport: 'GetCompanyExtendedReport'
  };

  /* ───────────────────────── регистрация интеграции ───────────────────────── */
  SensorApp.registerIntegration({
    id: 'spark',
    title: 'SPARK Интерфакс',
    webCapable: false,
    fields: [
      { key: 'login', label: 'Логин SPARK',              type: 'text' },
      { key: 'key',   label: 'Ключ доступа (API key)',   type: 'password' },
      { key: 'host',  label: 'Хост API (необязательно)', type: 'text' }
    ],

    // оставляем для обратной совместимости (раньше читалось снаружи)
    endpoint: SOAP_ENDPOINT,
    soapNs: SOAP_NS,
    restBase: REST_BASE,

    // Таймаут одиночного транспортного вызова (мс) и число повторов на 5xx/таймауте.
    timeoutMs: 15000,
    maxRetries: 2,

    // Подсказка про корпоративный доступ — модуль/настройки могут показать.
    accessNote:
      'SPARK Интерфакс — платный корпоративный сервис. Для реальных запросов ' +
      'нужен договор с Интерфаксом: выделенный логин, ключ доступа (API key) и ' +
      'белый список IP. Из веб-версии запрос невозможен (нет CORS, требуется ' +
      'серверный IP из белого списка) — используйте desktop-версию.',

    /* method:
         'company' | 'short'    → GetCompanyShortReport    (короткая справка)
         'extended'             → GetCompanyExtendedReport  (расширенная)
       params: { inn } | { inn, ogrn } | строка-ИНН | { query }
       Возвращает нормализованную карточку:
         { name, inn, ogrn, kpp, address, manager, status, risk, finance, … } */
    async call(method, params, creds) {
      var op = OPS[method] || (method === 'extended' ? OPS.extended : OPS.company);

      var inn = digits((params && (params.inn || params.query)) || params || '');
      if (!inn) throw new Error('Не указан ИНН');
      if (inn.length !== 10 && inn.length !== 12) {
        throw new Error('ИНН должен содержать 10 цифр (юрлицо) или 12 (ИП): получено ' + inn.length);
      }

      if (!creds || !creds.login || !creds.key) {
        throw new Error('Нужен корпоративный доступ SPARK: логин и ключ (выдаёт менеджер Интерфакса).');
      }

      // В desktop запрос идёт через мост (минуя CORS и с серверного IP),
      // в остальных случаях — обычный fetch (в web до сюда не доходит:
      // ядро вернёт mock из-за webCapable:false).
      var doFetch = (SensorApp.env === 'desktop' && SensorApp.node && SensorApp.node.fetch)
        ? SensorApp.node.fetch
        : fetch;

      var auth = basicAuth(creds.login, creds.key);
      var cfg = { timeoutMs: this.timeoutMs || 15000, maxRetries: this.maxRetries != null ? this.maxRetries : 2 };
      var report;

      try {
        report = await soapCall(doFetch, op, inn, auth, creds, cfg);
      } catch (soapErr) {
        // SPARK поддерживает и REST-шлюз — пробуем его как запасной транспорт.
        try {
          report = await restCall(doFetch, op, inn, auth, creds, cfg);
        } catch (restErr) {
          throw new Error(
            'SPARK не ответил. SOAP: ' + short(soapErr) + ' · REST: ' + short(restErr) +
            ' (проверьте корпоративный доступ, ключ и белый список IP).'
          );
        }
      }

      return normalize(report, op);
    },

    async test(creds) {
      // Реальную проверку можно сделать только в desktop с выданными кредами.
      if (SensorApp.env !== 'desktop') {
        return {
          ok: false,
          detail: 'SPARK Интерфакс доступен только в desktop-версии: нет CORS и нужен ' +
                  'серверный IP из белого списка. В web показываются демо-данные.'
        };
      }
      if (!creds || !creds.login || !creds.key) {
        return { ok: false, detail: 'Нужен корпоративный доступ SPARK: логин и ключ (выдаёт менеджер Интерфакса).' };
      }
      try {
        var r = await this.call('company', { inn: '7707083893' }, creds);
        return { ok: true, detail: 'Соединение в порядке · ' + (r.name || 'ответ получен') };
      } catch (e) {
        return {
          ok: false,
          detail: 'Нет ответа SPARK API: ' + short(e) +
                  ' (проверьте корпоративный доступ, ключ и белый список IP).'
        };
      }
    },

    /* Богатый демо-ответ. Возвращается, если нет ключей или мы в web (CORS).
       Карточка обезличена — никаких реальных персональных данных. */
    mock(method, params) {
      var op = OPS[method] || (method === 'extended' ? OPS.extended : OPS.company);
      var rawQuery = String((params && (params.inn || params.query)) || params || '');
      var inn = digits(rawQuery);
      // если в запросе нет ИНН (искали по названию) — пробуем подобрать демку по слову
      var card = inn ? pickMock(inn) : (pickMockByName(rawQuery) || pickMock(''));
      // короткая справка отдаёт срез без тяжёлых блоков расширенного отчёта
      if (op === OPS.company) {
        return slim(card);
      }
      return card;
    }
  });

  /* ════════════════════════ ТРАНСПОРТ ════════════════════════ */

  /* SOAP 1.1: SPARK.GetCompanyShortReport / GetCompanyExtendedReport по ИНН. */
  async function soapCall(doFetch, op, inn, auth, creds, cfg) {
    var url = baseHost(creds, SOAP_ENDPOINT);
    var envelope =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"' +
      ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
      ' xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
        '<soap:Body>' +
          '<' + op + ' xmlns="' + SOAP_NS + '">' +
            '<inn>' + xmlEscape(inn) + '</inn>' +
          '</' + op + '>' +
        '</soap:Body>' +
      '</soap:Envelope>';

    var resp = await fetchWithRetry(doFetch, url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '"' + SOAP_NS + '/' + op + '"',
        'Authorization': 'Basic ' + auth
      },
      body: envelope
    }, cfg, 'SOAP');
    if (!resp.ok) {
      var t = await resp.text().catch(function () { return ''; });
      throw new Error(httpLabel('SOAP', resp.status) + (t ? ' · ' + t.slice(0, 160) : ''));
    }
    var xml = await resp.text();
    var faultMsg = soapFault(xml);
    if (faultMsg) throw new Error('SOAP Fault: ' + faultMsg);
    return parseSparkXml(xml);
  }

  /* REST-шлюз SPARK (современная альтернатива SOAP): GET /v1/<Op>?inn=… */
  async function restCall(doFetch, op, inn, auth, creds, cfg) {
    var base = baseHost(creds, REST_BASE);
    var url = base + '/' + op + '?inn=' + encodeURIComponent(inn);
    var resp = await fetchWithRetry(doFetch, url, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Authorization': 'Basic ' + auth }
    }, cfg, 'REST');
    if (!resp.ok) {
      var t = await resp.text().catch(function () { return ''; });
      throw new Error(httpLabel('REST', resp.status) + (t ? ' · ' + t.slice(0, 160) : ''));
    }
    var raw = await resp.text();
    try { return JSON.parse(raw); }
    catch (e) { return parseSparkXml(raw); } // некоторые шлюзы отдают XML и на REST
  }

  /* ──────────────── Транспорт: таймаут (AbortController) + ретрай ────────────────
     Повторяем на сетевых сбоях / таймауте / 5xx с экспоненциальной паузой.
     Жёсткие коды (401/403/429/4xx) возвращаем сразу — вызыватель разберёт через
     httpLabel(). cfg = { timeoutMs, maxRetries }. */
  async function fetchWithRetry(doFetch, url, opts, cfg, kind) {
    cfg = cfg || {};
    var timeoutMs = cfg.timeoutMs || 15000;
    var maxRetries = cfg.maxRetries != null ? cfg.maxRetries : 2;
    var lastErr = null;

    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      var ctl = sparkAbort(timeoutMs);
      var resp;
      try {
        resp = await doFetch(url, assign({}, opts, { signal: ctl.signal }));
      } catch (e) {
        var timedOut = ctl.timedOut;
        ctl.clear();
        lastErr = e;
        if (attempt < maxRetries) { await sparkSleep(sparkBackoff(attempt)); continue; }
        if (timedOut) throw new Error(kind + ': нет ответа за ' + Math.round(timeoutMs / 1000) + ' с (таймаут)');
        throw new Error(kind + ': ' + short(e));
      }
      ctl.clear();
      // 5xx — временный сбой сервиса: повторяем.
      if (resp.status >= 500 && attempt < maxRetries) { await sparkSleep(sparkBackoff(attempt)); continue; }
      return resp;
    }
    throw new Error(kind + ': ' + short(lastErr || 'нет ответа'));
  }

  /* HTTP-код → понятная метка (авторизация/права/лимит/прочее). */
  function httpLabel(kind, status) {
    if (status === 401) return kind + ' HTTP 401 — неверный логин/ключ SPARK (проверьте корпоративный доступ)';
    if (status === 403) return kind + ' HTTP 403 — доступ запрещён (IP не в белом списке или нет прав на отчёт)';
    if (status === 429) return kind + ' HTTP 429 — превышен лимит запросов SPARK, сбавьте темп';
    if (status >= 500)  return kind + ' HTTP ' + status + ' — сбой на стороне SPARK, попробуйте позже';
    return kind + ' HTTP ' + status;
  }

  function sparkAbort(ms) {
    if (typeof AbortController === 'undefined') return { signal: undefined, timedOut: false, clear: function () {} };
    var ctl = new AbortController();
    var obj = { signal: ctl.signal, timedOut: false, clear: function () { clearTimeout(timer); } };
    var timer = setTimeout(function () { obj.timedOut = true; try { ctl.abort(); } catch (e) {} }, ms);
    return obj;
  }
  function sparkSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function sparkBackoff(attempt) { return Math.min(4000, 500 * Math.pow(2, attempt)); }
  /* Object.assign-полифилл (не тащим зависимостей; merge мелких объектов опций). */
  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (src) for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  /* Если в кредах задан свой host — используем его, иначе дефолт.
     Для SOAP это полный URL .asmx, для REST — базовый /v1. */
  function baseHost(creds, fallback) {
    var h = creds && creds.host && String(creds.host).trim();
    if (!h) return fallback;
    h = h.replace(/\/+$/, '');
    if (fallback === SOAP_ENDPOINT) {
      return /\.asmx$/i.test(h) ? h : h + '/iface/Spark.asmx';
    }
    return /\/v\d+$/i.test(h) ? h : h + '/v1';
  }

  /* ════════════════════════ НОРМАЛИЗАЦИЯ ════════════════════════ */

  /* Ответ SPARK (SOAP/REST, любой регистр ключей) → единая плоская карточка.
     Поля name/inn/ogrn/address/manager/status/risk/finance + алиасы, которые
     ждёт counterparties.js (fullName/shortName/director/directorPost/INN/OGRN/KPP). */
  function normalize(report, op) {
    var r = unwrap(report);

    var full  = first(r, ['FullName', 'fullName', 'CompanyName', 'companyName']);
    var short = first(r, ['ShortName', 'shortName', 'Name', 'name']);
    var name  = short || full || '';

    var inn  = first(r, ['INN', 'Inn', 'inn']);
    var ogrn = first(r, ['OGRN', 'Ogrn', 'ogrn']);
    var kpp  = first(r, ['KPP', 'Kpp', 'kpp']);

    var address = pickAddress(r);
    var mgr = pickManager(r);

    var status    = statusLabel(first(r, ['Status', 'State', 'status', 'CompanyStatus']));
    var statusRaw = String(first(r, ['StatusCode', 'StateCode', 'Status', 'State', 'status']) || '').toUpperCase();

    var riskRaw = first(r, ['RiskFactors', 'Risk', 'SparkInterfaxRiskFactor', 'DueDiligenceIndex', 'IDO', 'risk']);
    var risk = riskLabel(riskRaw);

    var card = {
      // основные поля карточки
      name: name,
      // алиасы под counterparties.normalize (читает fullName/shortName/director/…)
      fullName: full || name,
      shortName: short || name,
      inn: inn, INN: inn,
      ogrn: ogrn, OGRN: ogrn,
      kpp: kpp, KPP: kpp,
      address: address, legalAddress: address,
      manager: mgr.text,
      director: mgr.name || mgr.text,
      directorPost: mgr.post || 'Руководитель',
      status: status, statusText: status, statusCode: statusRaw,
      risk: risk,
      registrationDate: first(r, ['RegistrationDate', 'RegDate', 'registrationDate']),
      authorizedCapital: numOrNull(first(r, ['AuthorizedCapital', 'Capital', 'authorizedCapital'])),
      okved: okvedList(r),
      finance: financeBlock(r),
      sparkUrl: first(r, ['SparkUrl', 'Url', 'url'])
    };

    // расширенный отчёт — добавляем тяжёлые блоки
    if (op === OPS.extended) {
      card.founders   = foundersList(r);
      card.arbitration = arbitrationBlock(r);
      card.contracts   = contractsBlock(r);
      card.riskFactors = riskFactorsList(r);
    }
    return card;
  }

  function unwrap(report) {
    if (!report || typeof report !== 'object') return {};
    return report.Report || report.report ||
           report.Company || report.company ||
           report.Data || report.data || report;
  }

  function first(o, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = o && o[keys[i]];
      if (v != null && v !== '') return typeof v === 'object' ? v : v;
    }
    return '';
  }

  function pickAddress(r) {
    var a = r.Address || r.LegalAddress || r.address || r.legalAddress;
    if (a && typeof a === 'object') return a.FullAddress || a.value || a.Value || a.unrestricted_value || '';
    return a || '';
  }

  function pickManager(r) {
    var m = r.Manager || r.Head || r.Director || r.CEO || r.manager || r.management;
    if (m && typeof m === 'object') {
      var nm = m.Name || m.FullName || m.name || m.fio || '';
      var post = m.Post || m.Position || m.post || '';
      return { name: nm, post: post, text: [nm, post].filter(Boolean).join(', ') };
    }
    return { name: m || '', post: '', text: m || '' };
  }

  function okvedList(r) {
    var src = r.OKVED || r.Okved || r.okved || r.Activities || r.activities;
    if (!src) return [];
    var arr = Array.isArray(src) ? src : [src];
    return arr.map(function (x) {
      if (x && typeof x === 'object') return { code: x.Code || x.code || '', name: x.Name || x.name || '' };
      return { code: '', name: String(x) };
    }).filter(function (x) { return x.code || x.name; });
  }

  function financeBlock(r) {
    var f = r.Finance || r.Financials || r.finance || r.FinanceData;
    if (!f || typeof f !== 'object') return null;
    return {
      year:    first(f, ['Year', 'year', 'Period']) || '',
      revenue: numOrNull(first(f, ['Revenue', 'revenue', 'Vyruchka'])),
      profit:  numOrNull(first(f, ['NetProfit', 'Profit', 'profit', 'netProfit'])),
      assets:  numOrNull(first(f, ['Assets', 'assets', 'BalanceTotal'])),
      taxes:   numOrNull(first(f, ['Taxes', 'taxes', 'TaxPaid']))
    };
  }

  function foundersList(r) {
    var src = r.Founders || r.founders || r.Owners || r.owners;
    if (!src) return [];
    var arr = Array.isArray(src) ? src : [src];
    return arr.map(function (x) {
      if (x && typeof x === 'object') {
        return { name: x.Name || x.name || '', share: x.Share || x.share || '', inn: x.INN || x.inn || '' };
      }
      return { name: String(x), share: '', inn: '' };
    });
  }

  function arbitrationBlock(r) {
    var a = r.Arbitration || r.arbitration || r.Lawsuits || r.lawsuits;
    if (!a || typeof a !== 'object') return null;
    return {
      asPlaintiff: numOrNull(first(a, ['AsPlaintiff', 'plaintiff', 'Istec'])),
      asDefendant: numOrNull(first(a, ['AsDefendant', 'defendant', 'Otvetchik'])),
      sumDefendant: numOrNull(first(a, ['SumDefendant', 'sumDefendant']))
    };
  }

  function contractsBlock(r) {
    var c = r.GovContracts || r.govContracts || r.Contracts || r.contracts;
    if (!c || typeof c !== 'object') return null;
    return {
      count: numOrNull(first(c, ['Count', 'count'])),
      sum:   numOrNull(first(c, ['Sum', 'sum', 'TotalSum']))
    };
  }

  function riskFactorsList(r) {
    var src = r.RiskFactorsList || r.riskFactors || r.NegativeFactors;
    if (!src) return [];
    var arr = Array.isArray(src) ? src : [src];
    return arr.map(function (x) {
      if (x && typeof x === 'object') return { level: x.Level || x.level || '', text: x.Text || x.text || x.Name || '' };
      return { level: '', text: String(x) };
    }).filter(function (x) { return x.text; });
  }

  /* ════════════════════════ XML / SOAP ПАРСИНГ ════════════════════════ */

  /* Разбор XML-ответа SPARK (DOMParser в browser/desktop-renderer). */
  function parseSparkXml(xml) {
    if (typeof DOMParser === 'undefined' || !xml) return {};
    var doc;
    try { doc = new DOMParser().parseFromString(xml, 'text/xml'); }
    catch (e) { return {}; }
    if (!doc) return {};

    var pick = function (tag) {
      var n = doc.getElementsByTagName(tag)[0];
      return n ? (n.textContent || '').trim() : '';
    };

    var out = {
      FullName:  pick('FullName')  || pick('CompanyName'),
      ShortName: pick('ShortName') || pick('Name'),
      INN:       pick('INN'),
      OGRN:      pick('OGRN'),
      KPP:       pick('KPP'),
      Address:   pick('Address')   || pick('LegalAddress'),
      Manager:   pick('Manager')   || pick('Head') || pick('Director'),
      Status:    pick('Status')    || pick('State'),
      RiskFactors: pick('RiskFactors') || pick('Risk') || pick('DueDiligenceIndex'),
      RegistrationDate: pick('RegistrationDate') || pick('RegDate'),
      AuthorizedCapital: pick('AuthorizedCapital') || pick('Capital')
    };

    // ОКВЭД списком
    var okv = doc.getElementsByTagName('OKVED');
    if (okv && okv.length) {
      out.OKVED = [];
      for (var i = 0; i < okv.length; i++) {
        var node = okv[i];
        out.OKVED.push({
          code: childText(node, 'Code'),
          name: childText(node, 'Name') || (node.textContent || '').trim()
        });
      }
    }

    // Финблок
    var fin = doc.getElementsByTagName('Finance')[0] || doc.getElementsByTagName('Financials')[0];
    if (fin) {
      out.Finance = {
        Year:      childText(fin, 'Year'),
        Revenue:   childText(fin, 'Revenue'),
        NetProfit: childText(fin, 'NetProfit') || childText(fin, 'Profit'),
        Assets:    childText(fin, 'Assets')
      };
    }
    return out;
  }

  function childText(node, tag) {
    var n = node.getElementsByTagName(tag)[0];
    return n ? (n.textContent || '').trim() : '';
  }

  /* Достаём текст soap:Fault, если SPARK вернул ошибку в конверте. */
  function soapFault(xml) {
    if (!xml || xml.indexOf('Fault') < 0) return '';
    if (typeof DOMParser === 'undefined') {
      var m = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
      return m ? m[1].trim() : '';
    }
    try {
      var doc = new DOMParser().parseFromString(xml, 'text/xml');
      var fs = doc.getElementsByTagName('faultstring')[0];
      return fs ? (fs.textContent || '').trim() : '';
    } catch (e) { return ''; }
  }

  /* ════════════════════════ СЛОВАРИ ════════════════════════ */

  function statusLabel(code) {
    var s = String(code || '').toUpperCase();
    if (!s) return '';
    if (/ACTIVE|ДЕЙСТВ/.test(s))                      return 'Действует';
    if (/LIQUIDATING|ЛИКВИДИРУЕТ|В ПРОЦЕССЕ ЛИКВ/.test(s)) return 'Ликвидируется';
    if (/LIQUIDATED|ЛИКВИДИРОВАН/.test(s))            return 'Ликвидировано';
    if (/BANKRUPT|БАНКРОТ/.test(s))                   return 'Банкротство';
    if (/REORGANIZ|РЕОРГАНИЗ|ПРИСОЕДИНЕН/.test(s))    return 'Реорганизация';
    return code;
  }

  /* ИДО (Индекс должной осмотрительности SPARK): светофор → метка риска. */
  function riskLabel(v) {
    var s = String(v || '').toLowerCase();
    if (!s) return '';
    // числовой ИДО SPARK: 1–40 низкий, 41–70 средний, 71–99 высокий
    var n = parseInt(s, 10);
    if (!isNaN(n) && /^\d+$/.test(s.trim())) {
      if (n >= 71) return 'высокий';
      if (n >= 41) return 'средний';
      return 'низкий';
    }
    if (/red|высок|красн/.test(s))            return 'высокий';
    if (/yellow|средн|жёлт|желт/.test(s))     return 'средний';
    if (/green|низк|зелён|зелен/.test(s))     return 'низкий';
    return String(v);
  }

  /* ════════════════════════ ХЕЛПЕРЫ ════════════════════════ */

  function digits(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
  }
  function xmlEscape(s) {
    return String(s).replace(/[<>&'"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c];
    });
  }
  function basicAuth(login, key) {
    var pair = (login || '') + ':' + (key || '');
    if (typeof btoa === 'function') {
      try { return btoa(unescape(encodeURIComponent(pair))); } catch (e) { return btoa(pair); }
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(pair, 'utf-8').toString('base64');
    return pair;
  }
  function numOrNull(v) {
    if (v == null || v === '') return null;
    var n = Number(String(v).replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? null : n;
  }
  function short(e) {
    return String((e && e.message) || e || '').slice(0, 180);
  }

  /* ════════════════════════ ДЕМО-ДАННЫЕ (mock) ════════════════════════
     Несколько обезличенных карточек под разные ИНН, чтобы демонстрация была
     живой: разные статусы, уровни риска и финпоказатели. Никаких реальных
     персональных данных — ФИО/реквизиты синтетические. */
  var MOCK = {
    // эталон из test() — крупная «белая» компания, низкий риск
    '7707083893': {
      name: 'ПАО «Пример Энерго»', fullName: 'Публичное акционерное общество «Пример Энерго»',
      shortName: 'ПАО «Пример Энерго»',
      inn: '7707083893', ogrn: '1027700000001', kpp: '770701001',
      address: 'г. Москва, ул. Демонстрационная, д. 1',
      manager: 'Демидов Д. Д., Генеральный директор', director: 'Демидов Д. Д.', directorPost: 'Генеральный директор',
      status: 'Действует', statusText: 'Действует', statusCode: 'ACTIVE',
      risk: 'низкий',
      registrationDate: '2002-09-14', authorizedCapital: 41041753984,
      okved: [
        { code: '35.11', name: 'Производство электроэнергии' },
        { code: '35.13', name: 'Распределение электроэнергии' }
      ],
      finance: { year: '2024', revenue: 1284000000000, profit: 105000000000, assets: 4900000000000, taxes: 92000000000 },
      founders: [
        { name: 'Росимущество', share: '52%', inn: '7710723134' },
        { name: 'Прочие акционеры', share: '48%', inn: '' }
      ],
      arbitration: { asPlaintiff: 412, asDefendant: 318, sumDefendant: 2400000000 },
      contracts: { count: 1840, sum: 318000000000 },
      riskFactors: [
        { level: 'low', text: 'Компания включена в реестр субъектов естественных монополий — повышенный публичный контроль.' }
      ]
    },
    // средний бизнес, профильный клиент (монтаж ПБ), средний риск
    '7733180970': {
      name: 'ООО «ПожМонтаж-Сервис»', fullName: 'Общество с ограниченной ответственностью «ПожМонтаж-Сервис»',
      shortName: 'ООО «ПожМонтаж-Сервис»',
      inn: '7733180970', ogrn: '1157746000099', kpp: '773301001',
      address: 'г. Москва, Румянцево, Киевское шоссе, 22-й км, стр. 4, оф. 312',
      manager: 'Сергеев С. С., Директор', director: 'Сергеев С. С.', directorPost: 'Директор',
      status: 'Действует', statusText: 'Действует', statusCode: 'ACTIVE',
      risk: 'средний',
      registrationDate: '2015-03-02', authorizedCapital: 100000,
      okved: [
        { code: '43.21', name: 'Производство электромонтажных работ' },
        { code: '80.20', name: 'Деятельность систем обеспечения безопасности' },
        { code: '33.14', name: 'Ремонт электрического оборудования' }
      ],
      finance: { year: '2024', revenue: 84300000, profit: 6100000, assets: 41200000, taxes: 7800000 },
      founders: [
        { name: 'Сергеев С. С.', share: '70%', inn: '' },
        { name: 'Кузнецова К. К.', share: '30%', inn: '' }
      ],
      arbitration: { asPlaintiff: 3, asDefendant: 5, sumDefendant: 2100000 },
      contracts: { count: 27, sum: 58400000 },
      riskFactors: [
        { level: 'medium', text: 'Среднесписочная численность < заявленных видов работ — проверить штат под лицензию МЧС.' },
        { level: 'low', text: 'Один действующий судебный спор в роли ответчика на сумму 2,1 млн ₽.' }
      ]
    },
    // ИП (12 цифр), низкий риск, малые обороты
    '770300000099': {
      name: 'ИП Проектировщиков П. П.', fullName: 'Индивидуальный предприниматель Проектировщиков Пётр Петрович',
      shortName: 'ИП Проектировщиков П. П.',
      inn: '770300000099', ogrn: '315774600000099', kpp: '',
      address: 'г. Москва',
      manager: 'Проектировщиков П. П., Индивидуальный предприниматель', director: 'Проектировщиков П. П.', directorPost: 'Индивидуальный предприниматель',
      status: 'Действует', statusText: 'Действует', statusCode: 'ACTIVE',
      risk: 'низкий',
      registrationDate: '2015-06-18', authorizedCapital: null,
      okved: [{ code: '71.12.5', name: 'Деятельность в области проектирования систем пожарной безопасности' }],
      finance: { year: '2024', revenue: 4200000, profit: null, assets: null, taxes: 252000 },
      founders: [],
      arbitration: { asPlaintiff: 0, asDefendant: 0, sumDefendant: 0 },
      contracts: { count: 4, sum: 1900000 },
      riskFactors: []
    },
    // высокий риск — на грани банкротства, отрицательная прибыль
    '5024000003': {
      name: 'ООО «Рискград»', fullName: 'Общество с ограниченной ответственностью «Рискград»',
      shortName: 'ООО «Рискград»',
      inn: '5024000003', ogrn: '1095024000003', kpp: '502401001',
      address: 'Московская обл., г. Красногорск, ул. Образцовая, д. 7',
      manager: 'Туманов Т. Т., Конкурсный управляющий', director: 'Туманов Т. Т.', directorPost: 'Конкурсный управляющий',
      status: 'Банкротство', statusText: 'Банкротство', statusCode: 'BANKRUPT',
      risk: 'высокий',
      registrationDate: '2009-04-21', authorizedCapital: 10000,
      okved: [{ code: '41.20', name: 'Строительство жилых и нежилых зданий' }],
      finance: { year: '2023', revenue: 12800000, profit: -34500000, assets: 8100000, taxes: 0 },
      founders: [{ name: 'Офшор-Холдинг Лтд', share: '100%', inn: '' }],
      arbitration: { asPlaintiff: 2, asDefendant: 41, sumDefendant: 184000000 },
      contracts: { count: 0, sum: 0 },
      riskFactors: [
        { level: 'high', text: 'Введено конкурсное производство (дело о банкротстве).' },
        { level: 'high', text: '41 судебный спор в роли ответчика на сумму 184 млн ₽.' },
        { level: 'high', text: 'Массовый адрес регистрации · недостоверность сведений в ЕГРЮЛ.' },
        { level: 'medium', text: 'Задолженность по уплате налогов — приостановлены операции по счетам.' }
      ]
    }
  };

  // ключевые слова → ИНН, чтобы поиск по названию в демо тоже что-то находил
  var MOCK_BY_NAME = [
    { re: /монтаж|пож/i,        inn: '7733180970' },
    { re: /проектир|ип\b|аттпр/i, inn: '770300000099' },
    { re: /риск|банкрот/i,      inn: '5024000003' }
  ];

  function pickMock(inn) {
    if (inn && MOCK[inn]) return clone(MOCK[inn]);
    // если ИНН не из набора — отдадим профильную демку (монтаж ПБ),
    // но подставим запрошенный ИНН, чтобы карточка выглядела «по делу»
    var base = clone(MOCK['7733180970']);
    if (inn && (inn.length === 10 || inn.length === 12)) {
      base.inn = base.INN = inn;
      base.name = 'ООО «Демо-Контрагент»';
      base.fullName = 'Общество с ограниченной ответственностью «Демо-Контрагент»';
      base.shortName = base.name;
    }
    return base;
  }

  function pickMockByName(q) {
    for (var i = 0; i < MOCK_BY_NAME.length; i++) {
      if (MOCK_BY_NAME[i].re.test(q)) return clone(MOCK[MOCK_BY_NAME[i].inn]);
    }
    return null;
  }

  // короткая справка: убираем тяжёлые блоки расширенного отчёта
  function slim(card) {
    var c = clone(card);
    delete c.founders;
    delete c.arbitration;
    delete c.contracts;
    // оставляем краткий риск-сигнал, но без полного списка факторов
    if (c.riskFactors) {
      c.riskFactorsCount = c.riskFactors.length;
      delete c.riskFactors;
    }
    return c;
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }
})();

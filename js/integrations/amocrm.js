/* Интеграция «amoCRM» — сделки, воронки, контакты и компании по REST API v4.

   webCapable:false — amoCRM не отдаёт CORS-заголовки и требует серверного запроса
   с Bearer-токеном (long-lived integration token). Из браузера (web) ядро вернёт
   note про десктоп-версию и demo-данные mock(). Реальный вызов работает в
   desktop-версии через мост SensorApp.node (запрос без CORS), как у SPARK.

   Контракт ответа сохранён для потребителей (см. js/modules/management.js):
     • leads      → { _embedded:{ leads:[{id,name,price,status_id,status,...}] }, _page, _links }
     • pipelines  → { _embedded:{ pipelines:[{id,name,sort,_embedded:{statuses}}] } }
     • contacts   → { _embedded:{ contacts:[...] } }
     • companies  → { _embedded:{ companies:[...] } }
     • account    → { id, name, subdomain }
   Пагинация amoCRM — курсорная: ответ несёт _page и _links.next.href; этот адаптер
   умеет автоматически дособирать все страницы (params._fetchAll или params._maxPages). */
SensorApp.registerIntegration({
  id: 'amocrm',
  title: 'amoCRM',
  webCapable: false,
  fields: [
    { key: 'subdomain',    label: 'Поддомен (например sensor → sensor.amocrm.ru)', type: 'text' },
    { key: 'access_token', label: 'Access-токен (Bearer, долгоживущий)',          type: 'password' }
  ],

  // Сколько элементов на страницу просим по умолчанию (amoCRM лимит — 250).
  pageSize: 50,
  // Предохранитель авто-пагинации: не утянуть случайно тысячи страниц.
  maxPagesDefault: 20,
  // Таймаут одиночного запроса (мс) и максимум повторов на сетевых/5xx/429 сбоях.
  timeoutMs: 15000,
  maxRetries: 3,

  /* ── Основной интерфейс ────────────────────────────────────────────────────
     method : 'leads' | 'pipelines' | 'contacts' | 'companies' | 'account'
              | произвольный путь v4 (например 'leads/pipelines/2/statuses').
     params : query-параметры запроса. Помимо родных amoCRM-полей понимает:
              { limit, page, query, with:'contacts,...', filter:{...},
                _fetchAll:true,        // дособрать все страницы по _links.next
                _maxPages:Number,      // ограничитель авто-пагинации
                _raw:true }            // вернуть тело as-is без агрегации
     creds  : { subdomain, access_token } */
  async call(method, params, creds){
    const sub = String((creds && creds.subdomain) || '').trim().replace(/\.amocrm\.ru.*$/i, '');
    if (!sub) throw new Error('Не указан поддомен amoCRM (например «sensor»).');
    const token = String((creds && creds.access_token) || '').trim();
    if (!token) throw new Error('Не указан access-токен amoCRM (Bearer).');

    const path = String(method || 'leads').replace(/^\/+/, '');
    const base = 'https://' + sub + '.amocrm.ru/api/v4/';

    // account — единичный объект, без пагинации.
    if (path === 'account'){
      return await this._request(base + 'account' + this._qs(params), token);
    }

    // Имя встроенной коллекции для агрегации страниц (leads/contacts/...).
    const collection = path.split('/')[0];

    const wantAll  = !!(params && (params._fetchAll || params._all));
    const maxPages = Math.max(1, Number(params && params._maxPages) || this.maxPagesDefault);

    // Первая страница.
    let page = Math.max(1, Number(params && params.page) || 1);
    let first = await this._request(base + path + this._qs(this._pageParams(params, page)), token);
    if (params && params._raw) return first;
    if (!first || typeof first !== 'object') return { _embedded: {} };

    // Без авто-пагинации — отдаём страницу как есть (потребитель сам ходит по _links).
    if (!wantAll) return first;

    // Авто-сбор: идём по _links.next, склеивая _embedded[collection].
    const acc = first._embedded && Array.isArray(first._embedded[collection])
      ? first._embedded[collection].slice() : [];
    let body = first, pages = 1;
    while (pages < maxPages){
      const next = body && body._links && body._links.next && body._links.next.href;
      if (!next) break;
      body = await this._request(next, token);
      pages++;
      const chunk = body && body._embedded && body._embedded[collection];
      if (Array.isArray(chunk) && chunk.length) acc.push.apply(acc, chunk);
      else break;
    }
    const embedded = {}; embedded[collection] = acc;
    return { _page: pages, _total: acc.length, _embedded: embedded,
             _links: (body && body._links) || first._links || {} };
  },

  /* ── Низкоуровневый запрос с таймаутом, обработкой 401/403/429/5xx и мостом ──
     Таймаут через AbortController; 401 — токен протух; 403 — нет прав;
     429/5xx/таймаут/сетевой сбой — ретрай с экспоненциальной паузой (уважает
     Retry-After). В desktop запрос идёт через SensorApp.node.fetch (минуя CORS). */
  async _request(url, token, attempt){
    attempt = attempt || 0;
    const doFetch = (SensorApp.env === 'desktop' && SensorApp.node && SensorApp.node.fetch)
      ? SensorApp.node.fetch : fetch;
    const timeoutMs = this.timeoutMs || 15000;
    const maxRetries = this.maxRetries != null ? this.maxRetries : 3;

    let resp;
    const ctl = this._abort(timeoutMs);
    try {
      resp = await doFetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
        signal: ctl.signal
      });
    } catch(netErr){
      const timedOut = ctl.timedOut;
      ctl.clear();
      // Таймаут/сетевой сбой — повторяем (GET идемпотентен).
      if (attempt < maxRetries){
        await new Promise(r => setTimeout(r, Math.min(8000, 500 * Math.pow(2, attempt))));
        return this._request(url, token, attempt + 1);
      }
      if (timedOut){
        throw new Error('amoCRM не ответил за ' + Math.round(timeoutMs / 1000) +
          ' с (таймаут). Повторите позже или проверьте доступ к *.amocrm.ru.');
      }
      // Сетевой сбой / блокировка CORS в вебе — даём осмысленную подсказку.
      throw new Error('Нет связи с amoCRM (' + String(netErr && netErr.message || netErr) +
        '). amoCRM не отдаёт CORS — реальные запросы доступны в desktop-версии.');
    }
    ctl.clear();

    if (resp.status === 204) return { _embedded: {} };   // пустая коллекция

    if (resp.status === 401){
      throw new Error('401 — токен amoCRM недействителен или истёк. ' +
        'Обновите долгоживущий access-токен в карточке интеграции amoCRM и впишите его в Настройках.');
    }

    if (resp.status === 403){
      throw new Error('403 — нет прав на этот ресурс amoCRM (проверьте права интеграции).');
    }

    if (resp.status === 429){
      // Лимит запросов. amoCRM подсказывает паузу в Retry-After (секунды).
      const ra = Number(resp.headers && resp.headers.get && resp.headers.get('Retry-After'));
      const waitMs = (ra > 0 ? ra : Math.min(8, Math.pow(2, attempt))) * 1000;
      if (attempt < maxRetries){
        await new Promise(r => setTimeout(r, waitMs));
        return this._request(url, token, attempt + 1);
      }
      throw new Error('429 — превышен лимит запросов amoCRM (≈7 rps). Повторите позже.');
    }

    if (resp.status >= 500){
      // Временный сбой сервиса — повторяем с паузой.
      if (attempt < maxRetries){
        await new Promise(r => setTimeout(r, Math.min(8000, 500 * Math.pow(2, attempt))));
        return this._request(url, token, attempt + 1);
      }
      let d5 = '';
      try { const t = await resp.text(); d5 = t ? ' · ' + t.slice(0, 200) : ''; } catch(e){}
      throw new Error('Сбой на стороне amoCRM (HTTP ' + resp.status + ')' + d5 + '. Попробуйте позже.');
    }

    if (!resp.ok){
      let detail = '';
      try { const t = await resp.text(); detail = t ? ' · ' + t.slice(0, 200) : ''; } catch(e){}
      throw new Error('HTTP ' + resp.status + detail);
    }

    // amoCRM почти всегда JSON; на пустом теле возвращаем безопасную заглушку.
    const text = await resp.text();
    if (!text) return { _embedded: {} };
    try { return JSON.parse(text); }
    catch(e){ throw new Error('Некорректный JSON от amoCRM: ' + text.slice(0, 120)); }
  },

  /* AbortController с таймаутом. .clear() снимает таймер; .timedOut — флаг отмены
     по таймауту (чтобы отличить таймаут от обычного сетевого сбоя/CORS). */
  _abort(ms){
    if (typeof AbortController === 'undefined') return { signal: undefined, timedOut: false, clear(){} };
    const ctl = new AbortController();
    const obj = { signal: ctl.signal, timedOut: false, clear(){ clearTimeout(timer); } };
    const timer = setTimeout(() => { obj.timedOut = true; try { ctl.abort(); } catch(e){} }, ms);
    return obj;
  },

  /* Сбор query-параметров страницы из пользовательских params. */
  _pageParams(params, page){
    const p = {};
    if (params && typeof params === 'object'){
      Object.keys(params).forEach(k => { if (k[0] !== '_') p[k] = params[k]; });
    }
    if (p.limit == null) p.limit = this.pageSize;
    p.page = page;
    return p;
  },

  /* Сериализация query-string: поддержка filter[...] и массивов (amoCRM-стиль). */
  _qs(params){
    if (!params || typeof params !== 'object') return '';
    const out = [];
    const push = (k, v) => { if (v != null && v !== '') out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); };
    Object.keys(params).forEach(k => {
      if (k[0] === '_') return;                    // служебные ключи адаптера
      const v = params[k];
      if (Array.isArray(v)) v.forEach((item, i) => push(k + '[' + i + ']', item));
      else if (v && typeof v === 'object'){
        // вложенный объект (amoCRM-стиль filter[поле]); массивы внутри → filter[поле][i]
        Object.keys(v).forEach(sub => {
          const sv = v[sub];
          if (Array.isArray(sv)) sv.forEach((item, i) => push(k + '[' + sub + '][' + i + ']', item));
          else push(k + '[' + sub + ']', sv);
        });
      } else push(k, v);
    });
    return out.length ? '?' + out.join('&') : '';
  },

  /* ── Проверка соединения — GET /api/v4/account (минимальный авторизованный) ── */
  async test(creds){
    const sub = String((creds && creds.subdomain) || '').trim();
    if (SensorApp.env !== 'desktop'){
      return { ok: false, detail: 'amoCRM доступен только в desktop-версии: нет CORS, ' +
        'браузер не может обратиться к *.amocrm.ru напрямую. В вебе показаны демо-данные.' };
    }
    if (!sub)                       return { ok: false, detail: 'Не указан поддомен amoCRM.' };
    if (!(creds && creds.access_token)) return { ok: false, detail: 'Не указан access-токен (Bearer).' };
    try {
      const j = await this.call('account', null, creds);
      const name = (j && (j.name || j.subdomain || j.id)) || sub;
      return { ok: true, detail: 'Аккаунт «' + name + '» · соединение в порядке.' };
    } catch(e){
      return { ok: false, detail: String(e && e.message || e) };
    }
  },

  /* ── Демо-данные ────────────────────────────────────────────────────────────
     Обезличенные B2B-сделки лицензирования: воронки «Лицензия МЧС» и «АТТПР»,
     несколько статусов, продукты и суммы из конспекта Sensor. Реальных ПДн нет.
     Мок честно поддерживает пагинацию: при params.page>1 отдаёт срез и _links.next,
     чтобы потребитель мог отрабатывать курсор как с настоящим API. */
  mock(method, params){
    const m = String(method || 'leads').replace(/^\/+/, '');
    const head = m.split('/')[0];

    if (head === 'account'){
      return {
        id: 31415926, name: 'Сенсор Лицензирование (демо)', subdomain: 'sensor-demo',
        country: 'RU', currency: 'RUB', currency_symbol: '₽',
        created_at: 1717200000, mobile_feature_version: 1,
        _links: { self: { href: 'https://sensor-demo.amocrm.ru/api/v4/account' } }
      };
    }

    if (head === 'pipelines'){
      const pipelines = [
        { id: 7701, name: 'Лицензия МЧС', sort: 1, is_main: true, account_id: 31415926,
          _embedded: { statuses: [
            { id: 142001, name: 'Первичный контакт',  sort: 10, color: '#fffeb2', type: 0, pipeline_id: 7701 },
            { id: 142002, name: 'Квалификация',        sort: 20, color: '#ffeab2', type: 0, pipeline_id: 7701 },
            { id: 142003, name: 'КП отправлено',       sort: 30, color: '#ffdc7f', type: 0, pipeline_id: 7701 },
            { id: 142004, name: 'Договор / оплата',    sort: 40, color: '#deff81', type: 0, pipeline_id: 7701 },
            { id: 142,    name: 'Успешно реализовано', sort: 50, color: '#c1e0ff', type: 1, pipeline_id: 7701 },
            { id: 143,    name: 'Закрыто и не реализовано', sort: 60, color: '#d5d8db', type: 2, pipeline_id: 7701 }
          ] } },
        { id: 7702, name: 'Аттестация (АТТПР)', sort: 2, is_main: false, account_id: 31415926,
          _embedded: { statuses: [
            { id: 144001, name: 'Заявка',          sort: 10, color: '#fffeb2', type: 0, pipeline_id: 7702 },
            { id: 144002, name: 'Квалификация',    sort: 20, color: '#ffeab2', type: 0, pipeline_id: 7702 },
            { id: 144003, name: 'Профпереподготовка', sort: 30, color: '#ffdc7f', type: 0, pipeline_id: 7702 },
            { id: 144004, name: 'Запись на экзамен', sort: 40, color: '#deff81', type: 0, pipeline_id: 7702 },
            { id: 142,    name: 'Успешно реализовано', sort: 50, color: '#c1e0ff', type: 1, pipeline_id: 7702 },
            { id: 143,    name: 'Закрыто и не реализовано', sort: 60, color: '#d5d8db', type: 2, pipeline_id: 7702 }
          ] } }
      ];
      return { _total_items: pipelines.length, _embedded: { pipelines: pipelines },
               _links: { self: { href: 'https://sensor-demo.amocrm.ru/api/v4/leads/pipelines' } } };
    }

    if (head === 'contacts'){
      const contacts = [
        { id: 50101, name: 'Контакт А.',  responsible_user_id: 901, created_at: 1717400000,
          _embedded: { companies: [{ id: 60201 }] },
          custom_fields_values: [{ field_code: 'POSITION', values: [{ value: 'Директор (ЛПР)' }] }] },
        { id: 50102, name: 'Контакт Б.',  responsible_user_id: 902, created_at: 1717480000,
          _embedded: { companies: [{ id: 60202 }] },
          custom_fields_values: [{ field_code: 'POSITION', values: [{ value: 'Инженер ПБ (ЛВР)' }] }] },
        { id: 50103, name: 'Контакт В.',  responsible_user_id: 901, created_at: 1717560000,
          _embedded: { companies: [{ id: 60203 }] },
          custom_fields_values: [{ field_code: 'POSITION', values: [{ value: 'Проектировщик' }] }] }
      ];
      return this._paginateMock('contacts', contacts, params, 'contacts');
    }

    if (head === 'companies'){
      const companies = [
        { id: 60201, name: 'ООО «Ромашка»',        responsible_user_id: 901, created_at: 1717400000,
          custom_fields_values: [{ field_code: 'INN', values: [{ value: '7700000001' }] }] },
        { id: 60202, name: 'ООО «Монтаж-Сервис»',  responsible_user_id: 902, created_at: 1717480000,
          custom_fields_values: [{ field_code: 'INN', values: [{ value: '7700000002' }] }] },
        { id: 60203, name: 'ИП Сидоров',           responsible_user_id: 901, created_at: 1717560000,
          custom_fields_values: [{ field_code: 'INN', values: [{ value: '770300000003' }] }] }
      ];
      return this._paginateMock('companies', companies, params, 'companies');
    }

    // method === 'leads' (по умолчанию) — сделки по продуктам и статусам.
    // Поля price/status_id/status совместимы с aggregateLeads() в management.js:
    // status_id 142 = «Успешно реализовано» (won) → попадает в выручку.
    const leads = [
      lead(11001, 'Лицензия МЧС — виды 1–9 · ООО «Ромашка»', 320000, 142,    7701, 'Успешно реализовано', 'Лицензия МЧС', 60201, 50101),
      lead(11002, 'Лицензия МЧС — п.10 (огнетушители) · ООО «Монтаж-Сервис»', 360000, 142004, 7701, 'Договор / оплата', 'Лицензия МЧС', 60202, 50102),
      lead(11003, 'Лицензия МЧС — переоформление (смена адреса)', 95000, 142003, 7701, 'КП отправлено', 'Переоформление', 60203, null),
      lead(11004, 'Лицензия МЧС — подтверждение соответствия (лицконтроль)', 110000, 142002, 7701, 'Квалификация', 'Лицконтроль', 60201, 50101),
      lead(11005, 'Аренда комплекта оборудования (МЧС)', 320000, 142, 7701, 'Успешно реализовано', 'Оборудование', 60202, 50102),
      lead(11006, 'АТТПР — аттестация проектировщика', 90000, 142, 7702, 'Успешно реализовано', 'АТТПР', 60203, 50103),
      lead(11007, 'АТТПР + профпереподготовка под ключ', 90000, 144004, 7702, 'Запись на экзамен', 'АТТПР', 60201, 50101),
      lead(11008, 'АТТПР — повторная сдача (после отказа)', 75000, 144002, 7702, 'Квалификация', 'АТТПР', 60202, 50102),
      lead(11009, 'Пакет: Лицензия МЧС + АТТПР (пивот)', 410000, 142003, 7701, 'КП отправлено', 'Кросс-продажа', 60203, 50103),
      lead(11010, 'Лицензия МЧС — первичка (регион)', 280000, 143, 7701, 'Закрыто и не реализовано', 'Лицензия МЧС', 60201, null)
    ];
    return this._paginateMock('leads', leads, params, 'leads');
  },

  /* Пагинация мок-коллекции: уважает params.limit/page, проставляет _page и
     _links.next (с _mock=1), чтобы авто-пагинация call() корректно остановилась. */
  _paginateMock(name, items, params, collection){
    const limit = Math.max(1, Number(params && params.limit) || this.pageSize);
    const page  = Math.max(1, Number(params && params.page) || 1);
    const start = (page - 1) * limit;
    const slice = items.slice(start, start + limit);
    const hasNext = start + limit < items.length;
    const embedded = {}; embedded[collection] = slice;
    const links = { self: { href: '#mock/' + name + '?page=' + page } };
    if (hasNext) links.next = { href: '#mock/' + name + '?page=' + (page + 1) };
    return { _page: page, _total_items: items.length, _embedded: embedded, _links: links };
  }
});

/* Конструктор демо-сделки в форме, близкой к amoCRM v4 (price/status_id/pipeline_id
   + custom_fields_values с продуктом и госпошлиной). */
function lead(id, name, price, statusId, pipelineId, statusName, product, companyId, contactId){
  const cf = [
    { field_id: 9001, field_name: 'Продукт',   field_code: 'PRODUCT',   values: [{ value: product }] }
  ];
  if (product === 'Лицензия МЧС' || product === 'Переоформление')
    cf.push({ field_id: 9002, field_name: 'Госпошлина, ₽', field_code: 'GOSPOSHLINA', values: [{ value: product === 'Переоформление' ? 3500 : 7500 }] });
  if (product === 'АТТПР')
    cf.push({ field_id: 9002, field_name: 'Госпошлина, ₽', field_code: 'GOSPOSHLINA', values: [{ value: 0 }] });

  const emb = {};
  if (companyId) emb.companies = [{ id: companyId }];
  if (contactId) emb.contacts  = [{ id: contactId, is_main: true }];

  return {
    id: id, name: name, price: price,
    status_id: statusId, status: statusName,        // status — текстовая метка (для UI/фоллбэка)
    pipeline_id: pipelineId, responsible_user_id: 901,
    created_at: 1717200000 + id, updated_at: 1717600000 + id,
    custom_fields_values: cf,
    _embedded: emb
  };
}

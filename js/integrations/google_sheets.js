/* Интеграция «Google Sheets» — чтение/запись таблиц через Sheets API v4.
   webCapable:true — публичный Sheets API отдаёт CORS-заголовки, поэтому чтение по
   API-ключу работает прямо из браузера (web). API-ключ даёт доступ ТОЛЬКО к
   таблицам, открытым «по ссылке» (anyone with the link). Запись (append) требует
   OAuth-токена и в браузере, как правило, упирается в права 401/403 —
   ядро в этом случае показывает понятную ошибку и предлагает demo-режим.

   Поддерживаемые методы (ctx.integrations.google_sheets.run(method, params)):
     • 'values' — прочитать диапазон.   params: { range, majorDimension?, render? }
     • 'meta'   — метаданные таблицы.    params: { fields? }
     • 'append' — дописать строки.       params: { range, values:[[...]], insert? }
   Все методы возвращают нормализованный объект; форма 'values' совместима с
   парсером РНП в management.js (res.data.values → [[Блок, Показатель, План, Факт]]). */
SensorApp.registerIntegration({
  id: 'google_sheets',
  title: 'Google Sheets',
  webCapable: true,
  fields: [
    { key: 'api_key',        label: 'API-ключ (Google Cloud)', type: 'password' },
    { key: 'spreadsheet_id', label: 'ID таблицы',               type: 'text' },
    { key: 'oauth_token',    label: 'OAuth-токен (для записи, необязательно)', type: 'password' }
  ],

  // База Sheets API v4.
  base: 'https://sheets.googleapis.com/v4/spreadsheets',

  /* ── Основной интерфейс ──────────────────────────────────────────────────
     method ∈ {'values','meta','append'}. params — см. шапку файла. */
  async call(method, params, creds){
    params = params || {};
    const id = String((params.spreadsheet_id || (creds && creds.spreadsheet_id) || '')).trim();
    if (!id) throw new Error('Не указан ID таблицы. Откройте таблицу в браузере — ID это часть ссылки между /d/ и /edit.');

    const m = String(method || 'values');
    if (m === 'values') return await this._values(id, params, creds);
    if (m === 'meta')   return await this._meta(id, params, creds);
    if (m === 'append') return await this._append(id, params, creds);
    throw new Error('Неизвестный метод Google Sheets: «' + method + '». Доступны: values, meta, append.');
  },

  /* values(range) → { values, range, majorDimension }
     range по умолчанию — весь первый лист (A1:Z1000). Допускаются записи вида
     'Лист1!A1:F200' или "'РНП июнь'!A1:F200" (имя листа с пробелом — в кавычках). */
  async _values(id, params, creds){
    const range = String(params.range || 'A1:Z1000');
    const qs = this._qs({
      key: this._key(creds),
      majorDimension: params.majorDimension || 'ROWS',
      valueRenderOption: params.render || 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    }, creds);
    const url = this.base + '/' + enc(id) + '/values/' + enc(range) + qs;
    const j = await this._get(url, creds, { id, range });
    return {
      values: j.values || [],
      range: j.range || range,
      majorDimension: j.majorDimension || (params.majorDimension || 'ROWS')
    };
  },

  /* meta → { title, locale, timeZone, sheets:[{title,index,rows,cols,gridId}], url } */
  async _meta(id, params, creds){
    const fields = params.fields ||
      'properties(title,locale,timeZone),sheets(properties(sheetId,title,index,gridProperties))';
    const url = this.base + '/' + enc(id) + this._qs({ key: this._key(creds), fields }, creds);
    const j = await this._get(url, creds, { id });
    const p = j.properties || {};
    const sheets = (j.sheets || []).map(s => {
      const sp = s.properties || {};
      const gp = sp.gridProperties || {};
      return {
        title: sp.title || '',
        index: sp.index || 0,
        gridId: sp.sheetId,
        rows: gp.rowCount || 0,
        cols: gp.columnCount || 0
      };
    });
    return {
      title: p.title || id,
      locale: p.locale || '',
      timeZone: p.timeZone || '',
      sheets,
      url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit'
    };
  },

  /* append(range, values) → { updatedRange, updatedRows, updatedCells }
     Дописывает строки в конец диапазона. Требует OAuth-токена (запись).
     С одним API-ключом Google вернёт 401 — мы превращаем это в понятный текст. */
  async _append(id, params, creds){
    const range = String(params.range || 'A1');
    const rows = Array.isArray(params.values) ? params.values : (params.values ? [params.values] : []);
    if (!rows.length) throw new Error('Нет строк для записи (params.values пуст).');
    if (!(creds && creds.oauth_token) && this._key(creds)){
      // запись по API-ключу невозможна — даём ранний понятный сигнал
      throw new Error('Запись в Google Sheets требует OAuth-токена. API-ключ позволяет только чтение. ' +
                      'Добавьте OAuth-токен в Настройках или экспортируйте данные файлом.');
    }
    const qs = this._qs({
      key: this._key(creds),
      valueInputOption: params.valueInputOption || 'USER_ENTERED',
      insertDataOption: params.insert === 'insert' ? 'INSERT_ROWS' : 'OVERWRITE',
      includeValuesInResponse: 'false'
    }, creds);
    const url = this.base + '/' + enc(id) + '/values/' + enc(range) + ':append' + qs;
    const j = await this._post(url, { values: rows }, creds, { id, range });
    const u = j.updates || {};
    return {
      updatedRange: u.updatedRange || range,
      updatedRows: u.updatedRows || rows.length,
      updatedCells: u.updatedCells || 0,
      spreadsheetId: j.spreadsheetId || id
    };
  },

  /* ── Проверка соединения (Настройки) ─────────────────────────────────────
     Запрашиваем метаданные: это самый дешёвый авторизованный вызов. */
  async test(creds){
    const id = String((creds && creds.spreadsheet_id) || '').trim();
    if (!this._key(creds) && !(creds && creds.oauth_token)){
      return { ok: false, detail: 'Нужен API-ключ Google Cloud (или OAuth-токен) — раздел Настройки.' };
    }
    if (!id) return { ok: false, detail: 'Не указан ID таблицы (часть ссылки между /d/ и /edit).' };
    try {
      const meta = await this._meta(id, {}, creds);
      const sheetList = meta.sheets.length
        ? ' · листы: ' + meta.sheets.slice(0, 4).map(s => '«' + s.title + '»').join(', ') +
          (meta.sheets.length > 4 ? ` и ещё ${meta.sheets.length - 4}` : '')
        : '';
      return { ok: true, detail: '«' + meta.title + '» · листов: ' + meta.sheets.length + sheetList };
    } catch (e){
      return { ok: false, detail: String(e && e.message || e) };
    }
  },

  /* ── HTTP-обёртки: единый разбор ошибок 400/401/403/404/429 ───────────────── */
  _get(url, creds, extra){ return this._request('GET', url, null, creds, extra); },
  _post(url, body, creds, extra){ return this._request('POST', url, body, creds, extra); },

  async _request(verb, url, body, creds, extra){
    const headers = { 'Accept': 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (creds && creds.oauth_token) headers['Authorization'] = 'Bearer ' + creds.oauth_token;

    // В desktop запрос можно вести через мост (минуя CORS); в web — обычный fetch.
    const doFetch = (SensorApp.env === 'desktop' && SensorApp.node && SensorApp.node.fetch)
      ? SensorApp.node.fetch
      : fetch;

    let resp;
    try {
      resp = await doFetch(url, { method: verb, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (netErr){
      throw new Error('Нет сети или запрос заблокирован браузером (CORS): ' + String(netErr && netErr.message || netErr));
    }

    if (resp.ok) return await resp.json().catch(()=> ({}));

    // Достаём текст ошибки Google: { error: { code, message, status } }
    let apiMsg = '', apiStatus = '';
    try {
      const j = await resp.json();
      if (j && j.error){ apiMsg = j.error.message || ''; apiStatus = j.error.status || ''; }
    } catch (e){
      try { apiMsg = (await resp.text() || '').slice(0, 200); } catch (e2){}
    }
    throw new Error(this._explain(resp.status, apiStatus, apiMsg, extra));
  },

  /* Человекочитаемые сообщения по кодам ответа Google Sheets API. */
  _explain(http, gStatus, gMsg, extra){
    const id = extra && extra.id;
    const range = extra && extra.range;
    const tail = gMsg ? ' — ' + gMsg : '';
    switch (http){
      case 400:
        // чаще всего битый range или валидация
        return 'Неверный запрос (HTTP 400)' + (range ? ` — проверьте диапазон «${range}»` : '') +
               ' (имя листа с пробелом берите в одинарные кавычки: \'Мой лист\'!A1:C9)' + tail;
      case 401:
        return 'Не авторизовано (HTTP 401): API-ключ недействителен или для записи нужен OAuth-токен' + tail;
      case 403:
        if (/quota|rate|limit/i.test(gMsg || gStatus || ''))
          return 'Превышена квота Google API (HTTP 403)' + tail + '. Подождите и повторите.';
        return 'Доступ запрещён (HTTP 403): откройте таблицу «по ссылке» (Доступ → Все, у кого есть ссылка) ' +
               'и включите Google Sheets API в проекте Cloud Console' + tail;
      case 404:
        return 'Таблица не найдена (HTTP 404)' + (id ? ` — проверьте ID «${id}»` : '') +
               ' (ID это часть ссылки между /d/ и /edit)' + tail;
      case 429:
        return 'Слишком много запросов (HTTP 429): лимит Google API. Подождите минуту и повторите' + tail;
      default:
        if (http >= 500) return 'Сбой на стороне Google (HTTP ' + http + '), попробуйте позже' + tail;
        return 'HTTP ' + http + (gStatus ? ' / ' + gStatus : '') + tail;
    }
  },

  /* ── Утилиты ──────────────────────────────────────────────────────────── */
  _key(creds){ return String((creds && creds.api_key) || '').trim(); },
  // query-строка: ключ добавляем только если нет OAuth (Google не любит оба сразу)
  _qs(obj, creds){
    const hasOAuth = !!(creds && creds.oauth_token);
    const parts = [];
    Object.keys(obj).forEach(k => {
      let v = obj[k];
      if (k === 'key' && (hasOAuth || !v)) return; // с OAuth ключ не нужен
      if (v == null || v === '') return;
      parts.push(enc(k) + '=' + enc(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  },

  /* ── Демо-данные (нет ключей / CORS) ──────────────────────────────────────
     Возвращаем форму, совместимую с запрошенным методом. Для 'values' выдаём
     лист РНП так, как его прислал бы реальный Google Sheets: строки
     [Блок, Показатель, План, Факт] — ровно то, что парсит management.js.
     Несколько листов-периодов (РНП июнь/май/апрель) + сводный — переключаются
     по имени листа в params.range. */
  mock(method, params){
    const m = String(method || 'values');
    params = params || {};

    if (m === 'meta'){
      return {
        title: 'Сенсор · РНП (демо)',
        locale: 'ru_RU',
        timeZone: 'Europe/Moscow',
        url: 'https://docs.google.com/spreadsheets/d/demo/edit',
        sheets: [
          { title: 'РНП июнь',   index: 0, gridId: 0,  rows: 200, cols: 6 },
          { title: 'РНП май',    index: 1, gridId: 11, rows: 200, cols: 6 },
          { title: 'РНП апрель', index: 2, gridId: 12, rows: 200, cols: 6 },
          { title: 'Справочник', index: 3, gridId: 13, rows: 50,  cols: 4 }
        ]
      };
    }

    if (m === 'append'){
      const rows = Array.isArray(params.values) ? params.values : (params.values ? [params.values] : []);
      return {
        updatedRange: (params.range || 'РНП июнь!A1') + ' (демо)',
        updatedRows: rows.length || 1,
        updatedCells: rows.reduce((n, r)=> n + (Array.isArray(r) ? r.length : 1), 0) || 0,
        spreadsheetId: 'demo'
      };
    }

    // m === 'values' — выбираем демо-лист по имени из range
    const sheet = sheetNameFromRange(params.range);
    const data = MOCK_SHEETS[sheet] || MOCK_SHEETS['РНП июнь'];
    return {
      values: data,
      range: (sheet || 'РНП июнь') + '!A1:F' + data.length,
      majorDimension: 'ROWS'
    };
  }
});

/* encodeURIComponent для частей URL (id/range/qs-значений). */
function enc(s){ return encodeURIComponent(String(s == null ? '' : s)); }

/* Достаём имя листа из range вида "'РНП май'!A1:F200" / "РНП май!A1" / "A1:F200". */
function sheetNameFromRange(range){
  const r = String(range || '');
  const bang = r.indexOf('!');
  if (bang < 0) return 'РНП июнь';
  let name = r.slice(0, bang).trim();
  if (name[0] === "'" && name[name.length - 1] === "'") name = name.slice(1, -1).replace(/''/g, "'");
  return name || 'РНП июнь';
}

/* Демо-листы РНП: строки как из Google Sheets ([Блок, Показатель, План, Факт]).
   Шапка распознаётся парсером management.js по словам «Показатель/План/Факт».
   Строка с одним лишь названием в колонке A = заголовок блока. Цифры —
   демонстрационные, не реальные показатели. */
const HEADER = ['Блок', 'Показатель', 'План', 'Факт'];

const MOCK_SHEETS = {
  'РНП июнь': [
    HEADER,
    ['Финансы', '', '', ''],
    ['', 'Выручка, ₽', '4 800 000', '4 210 000'],
    ['', 'Средний чек, ₽', '98 000', '91 500'],
    ['', 'Маржинальность, %', '43', '40'],
    ['Продажи', '', '', ''],
    ['', 'Сделок закрыто', '52', '47'],
    ['', 'Конверсия лид→сделка, %', '19', '16'],
    ['', 'Звонков на менеджера/день', '42', '38'],
    ['', 'Длина цикла сделки, дней', '7', '8'],
    ['Допродажи', '', '', ''],
    ['', 'Доля сделок с допродажей, %', '37', '30'],
    ['', 'Доход с допродаж, ₽', '900 000', '690 000'],
    ['', 'Пивотов МЧС↔АТТПР', '22', '16'],
    ['Маркетинг', '', '', ''],
    ['', 'Лидов получено', '340', '312'],
    ['', 'Стоимость лида (CPL), ₽', '1 750', '1 980'],
    ['', 'Позиций в Яндекс-топ-10', '13', '9'],
    ['Документооборот', '', '', ''],
    ['', 'Договоров оформлено в срок, %', '100', '94'],
    ['', 'Лицензий получено', '32', '29'],
    ['', 'Просрочек по лицконтролю', '0', '1'],
    ['NPS', '', '', ''],
    ['', 'NPS, пункты', '62', '57'],
    ['', 'Доля промоутеров, %', '72', '65']
  ],
  'РНП май': [
    HEADER,
    ['Финансы', '', '', ''],
    ['', 'Выручка, ₽', '4 500 000', '3 920 000'],
    ['', 'Средний чек, ₽', '95 000', '88 000'],
    ['', 'Маржинальность, %', '42', '39'],
    ['Продажи', '', '', ''],
    ['', 'Сделок закрыто', '48', '44'],
    ['', 'Конверсия лид→сделка, %', '18', '15'],
    ['', 'Звонков на менеджера/день', '40', '36'],
    ['Допродажи', '', '', ''],
    ['', 'Доля сделок с допродажей, %', '35', '28'],
    ['', 'Доход с допродаж, ₽', '850 000', '610 000'],
    ['Маркетинг', '', '', ''],
    ['', 'Лидов получено', '320', '295'],
    ['', 'Стоимость лида (CPL), ₽', '1 800', '2 100'],
    ['Документооборот', '', '', ''],
    ['', 'Лицензий получено', '30', '27'],
    ['', 'Просрочек по лицконтролю', '0', '2']
  ],
  'РНП апрель': [
    HEADER,
    ['Финансы', '', '', ''],
    ['', 'Выручка, ₽', '4 200 000', '4 050 000'],
    ['', 'Средний чек, ₽', '92 000', '90 000'],
    ['Продажи', '', '', ''],
    ['', 'Сделок закрыто', '46', '45'],
    ['', 'Конверсия лид→сделка, %', '17', '17'],
    ['Маркетинг', '', '', ''],
    ['', 'Лидов получено', '300', '298'],
    ['Документооборот', '', '', ''],
    ['', 'Лицензий получено', '28', '28']
  ],
  'Справочник': [
    ['Код', 'Расшифровка', 'Единица', 'Норматив'],
    ['CPL', 'Стоимость лида', '₽', '≤ 1800'],
    ['NPS', 'Индекс лояльности', 'пункты', '≥ 60'],
    ['ЛК', 'Подтверждение соответствия (лицконтроль)', 'раб. дней', '20'],
    ['АТТПР', 'Срок аттестации проектировщика', 'раб. дней', '10']
  ]
};

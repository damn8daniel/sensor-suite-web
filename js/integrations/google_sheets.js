/* Интеграция «Google Sheets» — чтение диапазонов таблиц через Sheets API v4.
   webCapable:true — API отдаёт CORS-заголовки, работает прямо из браузера. */
SensorApp.registerIntegration({
  id: 'google_sheets',
  title: 'Google Sheets',
  webCapable: true,
  fields: [
    { key: 'api_key',        label: 'API-ключ', type: 'password' },
    { key: 'spreadsheet_id', label: 'ID таблицы', type: 'text' }
  ],

  // method: 'values' — прочитать диапазон. params: { range: 'Лист1!A1:C10' }
  async call(method, params, creds){
    const id  = encodeURIComponent(creds.spreadsheet_id || '');
    const key = encodeURIComponent(creds.api_key || '');

    if (method === 'values'){
      const range = encodeURIComponent((params && params.range) || 'A1:Z1000');
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?key=${key}`;
      const res = await fetch(url);
      if (!res.ok){
        let msg = 'HTTP ' + res.status;
        try { const j = await res.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch(e){}
        throw new Error(msg);
      }
      const j = await res.json();
      return { values: j.values || [] };
    }

    throw new Error('Неизвестный метод: ' + method);
  },

  // Проверка соединения — запрос метаданных таблицы.
  async test(creds){
    const id  = encodeURIComponent(creds.spreadsheet_id || '');
    const key = encodeURIComponent(creds.api_key || '');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}?key=${key}`;
    const res = await fetch(url);
    if (!res.ok){
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch(e){}
      return { ok:false, detail: msg };
    }
    const j = await res.json();
    const title = (j.properties && j.properties.title) || creds.spreadsheet_id || 'таблица';
    const sheets = (j.sheets || []).length;
    return { ok:true, detail:`«${title}» · листов: ${sheets}` };
  },

  // Демо-данные (обезличенный план/факт по показателям отдела).
  mock(){
    return { values: [
      ['Показатель', 'План',     'Факт'],
      ['Маржа год',  '278.4 млн', '98.3 млн'],
      ['NPS',        '0.92',      '0.92']
    ] };
  }
});

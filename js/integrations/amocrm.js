/* Интеграция «amoCRM» — сделки, воронки и контакты по API v4.
   webCapable:false — amoCRM не отдаёт CORS-заголовки и требует серверного запроса
   с Bearer-токеном; из браузера (web) ядро вернёт note про десктоп-версию и demo-данные. */
SensorApp.registerIntegration({
  id: 'amocrm',
  title: 'amoCRM',
  webCapable: false,
  fields: [
    { key: 'subdomain',    label: 'Поддомен (например sensor)', type: 'text' },
    { key: 'access_token', label: 'Access-токен (Bearer)',      type: 'password' }
  ],

  // method: 'leads' | 'pipelines' | 'contacts' | 'companies' | 'account' | произвольный путь v4.
  // params: query-параметры запроса, напр. { limit: 50, query: 'АТТПР' }.
  async call(method, params, creds){
    const sub = String((creds && creds.subdomain) || '').trim();
    if (!sub) throw new Error('Не указан поддомен amoCRM');

    const path = String(method || 'leads').replace(/^\/+/, '');
    let url = 'https://' + sub + '.amocrm.ru/api/v4/' + path;

    if (params && typeof params === 'object'){
      const qs = Object.keys(params)
        .filter(k => params[k] != null && params[k] !== '')
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
        .join('&');
      if (qs) url += '?' + qs;
    }

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + ((creds && creds.access_token) || '')
      }
    });

    if (resp.status === 204) return {}; // amoCRM отдаёт 204 на пустую коллекцию
    if (!resp.ok){
      const text = await resp.text().catch(()=> '');
      throw new Error('HTTP ' + resp.status + (text ? ' · ' + text.slice(0, 200) : ''));
    }
    return await resp.json();
  },

  // Проверка соединения — GET /api/v4/account (минимальный авторизованный запрос).
  async test(creds){
    const sub = String((creds && creds.subdomain) || '').trim();
    if (!sub) return { ok:false, detail:'не указан поддомен' };
    const url = 'https://' + sub + '.amocrm.ru/api/v4/account';
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + ((creds && creds.access_token) || '')
      }
    });
    if (!resp.ok) return { ok:false, detail:'HTTP ' + resp.status };
    const j = await resp.json().catch(()=> null);
    const name = (j && (j.name || j.id)) || sub;
    return { ok:true, detail:'Аккаунт «' + name + '» · соединение в порядке' };
  },

  // Демо-данные (обезличенные сделки B2B-лицензирования: АТТПР / Лицензия МЧС).
  mock(method){
    const m = String(method || 'leads').replace(/^\/+/, '');

    if (m === 'pipelines'){
      return { _embedded: { pipelines: [
        { id: 1, name: 'Лицензирование МЧС', sort: 1 },
        { id: 2, name: 'Аттестация (АТТПР)', sort: 2 }
      ] } };
    }

    if (m === 'contacts'){
      return { _embedded: { contacts: [
        { id: 101, name: 'Контакт А.', responsible_user_id: 1 },
        { id: 102, name: 'Контакт Б.', responsible_user_id: 1 }
      ] } };
    }

    if (m === 'companies'){
      return { _embedded: { companies: [
        { id: 201, name: 'ООО «Ромашка»' },
        { id: 202, name: 'ООО «Монтаж-Сервис»' }
      ] } };
    }

    if (m === 'account'){
      return { id: 1, name: 'Демо-аккаунт', subdomain: 'sensor-demo' };
    }

    // method === 'leads' (по умолчанию)
    return { _embedded: { leads: [
      { id: 1, name: 'Сделка МЧС', price: 120000, status: 'в работе' },
      { id: 2, name: 'АТТПР',      price: 90000,  status: 'передача' }
    ] } };
  }
});

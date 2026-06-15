/* Интеграция «DaData» — пробив контрагентов по ИНН/ОГРН/названию.
   CORS-разрешён, токен в рантайме — работает прямо из браузера (web). */
SensorApp.registerIntegration({
  id: 'dadata',
  title: 'DaData',
  webCapable: true,
  fields: [{ key: 'token', label: 'API-токен', type: 'password' }],

  // method: 'findById' (поиск по ИНН/ОГРН) | 'suggest' (поиск по названию/части)
  // params: строка-запрос или { query }
  async call(method, params, creds){
    const m = (method === 'suggest') ? 'suggest' : 'findById';
    const query = (params && typeof params === 'object') ? (params.query || '') : String(params || '');
    const url = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/' + m + '/party';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Token ' + creds.token
      },
      body: JSON.stringify({ query: query, count: 1 })
    });
    if (!resp.ok){
      const text = await resp.text().catch(()=> '');
      throw new Error('HTTP ' + resp.status + (text ? ' · ' + text.slice(0, 200) : ''));
    }
    const json = await resp.json();
    const sug = json && json.suggestions && json.suggestions[0];
    if (!sug) throw new Error('Контрагент не найден');
    return normalize(sug);
  },

  async test(creds){
    const url = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Token ' + creds.token
      },
      body: JSON.stringify({ query: '7707083893', count: 1 })
    });
    if (!resp.ok) return { ok: false, detail: 'HTTP ' + resp.status };
    const json = await resp.json().catch(()=> null);
    const has = !!(json && json.suggestions && json.suggestions.length);
    return has
      ? { ok: true, detail: 'Соединение в порядке · ' + (json.suggestions[0].value || 'ответ получен') }
      : { ok: false, detail: 'Пустой ответ (suggestions)' };
  },

  mock(){
    return {
      name: 'ООО «Ромашка»',
      inn: '7700000000',
      ogrn: '1110000000000',
      kpp: '770001001',
      address: 'г. Москва, ул. Примерная, 1',
      manager: 'Иванов И.И.',
      status: 'Действует'
    };
  }
});

/* Нормализация первого suggestion DaData → плоский объект карточки контрагента. */
function normalize(sug){
  const d = (sug && sug.data) || {};
  const name = (d.name && (d.name.short_with_opf || d.name.full_with_opf || d.name.short || d.name.full)) || sug.value || '';

  let manager = '';
  if (d.management && (d.management.name || d.management.post)){
    manager = [d.management.name, d.management.post].filter(Boolean).join(', ');
  } else if (d.fio){
    manager = [d.fio.surname, d.fio.name, d.fio.patronymic].filter(Boolean).join(' ');
  }

  const status = statusLabel(d.state && d.state.status);

  return {
    name: name,
    inn: d.inn || '',
    ogrn: d.ogrn || '',
    kpp: d.kpp || '',
    address: (d.address && (d.address.unrestricted_value || d.address.value)) || '',
    manager: manager,
    status: status
  };
}

function statusLabel(code){
  switch (code){
    case 'ACTIVE':       return 'Действует';
    case 'LIQUIDATING':  return 'Ликвидируется';
    case 'LIQUIDATED':   return 'Ликвидировано';
    case 'BANKRUPT':     return 'Банкротство';
    case 'REORGANIZING': return 'В процессе присоединения';
    default:             return code || '';
  }
}

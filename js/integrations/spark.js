/* Интеграция «SPARK Интерфакс» — пробив контрагентов по ИНН через SPARK API.
   webCapable:false — SPARK API не отдаёт CORS-заголовки и требует корпоративного
   доступа (выделенный логин/ключ, белый список IP). Из браузера (web) недоступно —
   ядро вернёт демо-данные mock(). Реальный вызов работает в desktop-версии через
   мост SensorApp.node (запрос без CORS). */
SensorApp.registerIntegration({
  id: 'spark',
  title: 'SPARK Интерфакс',
  webCapable: false,
  fields: [
    { key: 'login', label: 'Логин SPARK', type: 'text' },
    { key: 'key',   label: 'Ключ доступа (API key)', type: 'password' }
  ],

  // Эндпоинт SPARK API (GetCompanyShortReport). Реальный хост выдаётся при
  // подключении корпоративного доступа; здесь — базовый адрес-каркас.
  endpoint: 'https://api.spark-interfax.ru/v1/GetCompanyShortReport',

  // method: 'company' — короткая справка по контрагенту. params: { inn }.
  // Возвращает нормализованную карточку {name,inn,ogrn,address,manager,status,risk}.
  async call(method, params, creds){
    if (method !== 'company') throw new Error('Неизвестный метод: ' + method);

    const inn = String((params && (params.inn || params.query)) || '').replace(/\D/g, '');
    if (!inn) throw new Error('Не указан ИНН');

    // SPARK API использует Basic-аутентификацию (логин + ключ доступа).
    // GetCompanyShortReport принимает ИНН и отдаёт XML/JSON со справкой.
    const url = this.endpoint + '?inn=' + encodeURIComponent(inn);
    const auth = (typeof btoa === 'function')
      ? btoa((creds.login || '') + ':' + (creds.key || ''))
      : Buffer.from((creds.login || '') + ':' + (creds.key || '')).toString('base64');

    // В desktop запрос идёт через мост (минуя CORS), в остальных случаях — fetch.
    const doFetch = (SensorApp.env === 'desktop' && SensorApp.node && SensorApp.node.fetch)
      ? SensorApp.node.fetch
      : fetch;

    const resp = await doFetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Basic ' + auth
      }
    });
    if (!resp.ok){
      const text = await resp.text().catch(()=> '');
      throw new Error('HTTP ' + resp.status + (text ? ' · ' + text.slice(0, 200) : ''));
    }

    // SPARK может ответить как JSON, так и XML — пробуем JSON, иначе парсим XML.
    const raw = await resp.text();
    let report;
    try {
      report = JSON.parse(raw);
    } catch(e){
      report = parseSparkXml(raw);
    }
    return normalize(report);
  },

  async test(creds){
    // SPARK закрыт для веба и требует корпоративного доступа: реальную проверку
    // соединения можно выполнить только в desktop-версии с выданными кредами.
    if (SensorApp.env !== 'desktop'){
      return { ok: false, detail: 'SPARK Интерфакс доступен только в desktop-версии (требуется корпоративный доступ, нет CORS).' };
    }
    if (!creds || !creds.login || !creds.key){
      return { ok: false, detail: 'Нужен корпоративный доступ SPARK: логин и ключ (выдаёт менеджер Интерфакса).' };
    }
    try {
      const r = await this.call('company', { inn: '7700000001' }, creds);
      return { ok: true, detail: 'Соединение в порядке · ' + (r.name || 'ответ получен') };
    } catch(e){
      return { ok: false, detail: 'Нет ответа SPARK API: ' + String(e && e.message || e) + ' (проверьте корпоративный доступ и белый список IP).' };
    }
  },

  mock(){
    return {
      name:    'АО «Пример»',
      inn:     '7700000001',
      ogrn:    '1027700000001',
      address: 'г. Москва',
      manager: 'Петров П.П.',
      status:  'Действует',
      risk:    'низкий'
    };
  }
});

/* Нормализация ответа SPARK GetCompanyShortReport → плоская карточка контрагента. */
function normalize(report){
  const r = (report && (report.Report || report.report || report.Company || report.company)) || report || {};

  const name = r.FullName || r.ShortName || r.Name || r.CompanyName || '';
  const inn  = r.INN  || r.Inn  || r.inn  || '';
  const ogrn = r.OGRN || r.Ogrn || r.ogrn || '';

  let address = '';
  const a = r.Address || r.LegalAddress || r.address;
  if (a && typeof a === 'object') address = a.FullAddress || a.value || a.Value || '';
  else address = a || '';

  let manager = '';
  const m = r.Manager || r.Head || r.Director || r.manager;
  if (m && typeof m === 'object') manager = [m.Name || m.FullName, m.Post].filter(Boolean).join(', ');
  else manager = m || '';

  const status = statusLabel(r.Status || r.State || r.status);
  const risk   = riskLabel(r.RiskFactors || r.Risk || r.SparkInterfaxRiskFactor || r.risk);

  return { name, inn, ogrn, address, manager, status, risk };
}

/* Минимальный разбор XML-ответа SPARK (DOMParser в браузере / в desktop). */
function parseSparkXml(xml){
  if (typeof DOMParser === 'undefined') return {};
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const pick = tag => { const n = doc.getElementsByTagName(tag)[0]; return n ? (n.textContent || '').trim() : ''; };
  return {
    FullName:  pick('FullName')  || pick('ShortName') || pick('CompanyName'),
    INN:       pick('INN'),
    OGRN:      pick('OGRN'),
    Address:   pick('Address')   || pick('LegalAddress'),
    Manager:   pick('Manager')   || pick('Head') || pick('Director'),
    Status:    pick('Status')    || pick('State'),
    Risk:      pick('RiskFactors') || pick('Risk')
  };
}

function statusLabel(code){
  const s = String(code || '').toUpperCase();
  switch (s){
    case 'ACTIVE': case 'ДЕЙСТВУЕТ':           return 'Действует';
    case 'LIQUIDATING': case 'ЛИКВИДИРУЕТСЯ':   return 'Ликвидируется';
    case 'LIQUIDATED':  case 'ЛИКВИДИРОВАНО':   return 'Ликвидировано';
    case 'BANKRUPT':    case 'БАНКРОТСТВО':     return 'Банкротство';
    case 'REORGANIZING':                        return 'Реорганизация';
    case '':                                    return '';
    default:                                    return code;
  }
}

/* SPARK-Интерфакс-индекс должной осмотрительности: цвет светофора → метка риска. */
function riskLabel(v){
  const s = String(v || '').toLowerCase();
  if (/red|высок|красн/.test(s))   return 'высокий';
  if (/yellow|средн|жёлт|желт/.test(s)) return 'средний';
  if (/green|низк|зелён|зелен/.test(s)) return 'низкий';
  return v ? String(v) : '';
}

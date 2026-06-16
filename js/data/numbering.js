/* ===== Реестр нумерации исходящих документов (счётчик + журнал) =====
 * Идея #9. Детерминированный генератор и журнал номеров исходящих документов
 * учебного центра. Хранение — через SensorStore.set('outgoing_log', [...]) / get.
 *
 * Vanilla SPA: чистый window.*-ассайн, БЕЗ import/export/ES-модулей.
 * UI здесь НЕТ — это автономный слой данных/логики; вкладку (в documents/licensing)
 * подключают в поздней волне через ctx.ui. Деградация: ничего не бросает в jsdom —
 * SensorStore может отсутствовать (тогда журнал живёт в памяти процесса).
 *
 * ВАЖНО про детерминизм: чистые функции format()/parse()/next() НЕ читают Date.now
 * без явной передачи даты. Год/дата по умолчанию берутся из new Date() ТОЛЬКО когда
 * аргумент не передан — в тестах дату инъецируют параметром, чтобы не зависеть от часов.
 *
 * API window.SensorNumbering:
 *   format(opts{prefix,seq,date,mask?}) -> строка
 *     плейсхолдеры маски: {seq} {YYYY} {YY} {MM} {DD} {prefix}
 *     маска по умолчанию: '№ {seq}/{YY} от {DD.MM.YYYY}'
 *   parse(str, mask?) -> {prefix,seq,date} | null   (по умолчанию по той же маске)
 *   next(prefix?, dateOrLog?, maybeLog?) -> следующий seq
 *     = (макс seq по журналу за год+префикс) + 1; пустой год/префикс → 1.
 *     год берётся из переданной даты (для тестов) либо текущий.
 *   register(entry{prefix,seq,date,title,counterparty?}) -> запись | null
 *     добавляет в журнал с защитой от дубля (seq+year+prefix). Дубль → null.
 *   list() -> копия журнала (массив записей)
 *   clear() -> очистить журнал
 *   DEFAULT_MASK — строка маски по умолчанию.
 */
(function () {
  'use strict';

  var STORE_KEY = 'outgoing_log';
  var DEFAULT_MASK = '№ {seq}/{YY} от {DD.MM.YYYY}'; // «№ {seq}/{YY} от {DD.MM.YYYY}»

  // --- безопасный доступ к хранилищу (без него — память процесса) ---------
  var mem = []; // фолбэк-журнал, если SensorStore недоступен
  function hasStore() {
    return typeof window !== 'undefined' && window.SensorStore &&
      typeof window.SensorStore.get === 'function' &&
      typeof window.SensorStore.set === 'function';
  }
  function loadLog() {
    if (hasStore()) {
      var v = window.SensorStore.get(STORE_KEY, null);
      return Array.isArray(v) ? v : [];
    }
    return mem.slice();
  }
  function saveLog(arr) {
    var list = Array.isArray(arr) ? arr : [];
    if (hasStore()) { window.SensorStore.set(STORE_KEY, list); }
    else { mem = list.slice(); }
  }

  // --- работа с датами (чистая, без скрытого Date.now) ---------------------
  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  // Нормализуем дату в {Y,M,D}. Принимаем: Date | 'YYYY-MM-DD'(-ish) | undefined.
  // undefined → текущая дата (единственная точка чтения часов; в чистых вызовах
  // тесты дату передают явно).
  function toParts(date) {
    var d;
    if (date instanceof Date) {
      d = date;
    } else if (typeof date === 'string' && date.trim()) {
      // поддержим ISO 'YYYY-MM-DD' и 'YYYY-MM-DDTHH:..' без зависимости от таймзоны
      var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date.trim());
      if (m) return { Y: +m[1], M: +m[2], D: +m[3] };
      d = new Date(date);
      if (isNaN(d.getTime())) d = new Date();
    } else {
      d = new Date();
    }
    return { Y: d.getFullYear(), M: d.getMonth() + 1, D: d.getDate() };
  }

  // --- format(opts) --------------------------------------------------------
  function format(opts) {
    opts = opts || {};
    var mask = (typeof opts.mask === 'string' && opts.mask) ? opts.mask : DEFAULT_MASK;
    var p = toParts(opts.date);
    var seq = (opts.seq == null) ? '' : String(opts.seq);
    var prefix = (opts.prefix == null) ? '' : String(opts.prefix);
    var YYYY = String(p.Y);
    var YY = YYYY.slice(-2);
    var MM = pad2(p.M);
    var DD = pad2(p.D);
    // Поддерживаем как составной {DD.MM.YYYY}, так и одиночные плейсхолдеры.
    // Сначала составные (чтобы не порушить точки внутри них), затем одиночные.
    return mask
      .replace(/\{DD\.MM\.YYYY\}/g, DD + '.' + MM + '.' + YYYY)
      .replace(/\{DD\.MM\.YY\}/g, DD + '.' + MM + '.' + YY)
      .replace(/\{prefix\}/g, prefix)
      .replace(/\{seq\}/g, seq)
      .replace(/\{YYYY\}/g, YYYY)
      .replace(/\{YY\}/g, YY)
      .replace(/\{MM\}/g, MM)
      .replace(/\{DD\}/g, DD);
  }

  // --- parse(str, mask?) — обратная операция по той же маске ---------------
  // Строим regex из маски, заменяя плейсхолдеры на именованные группы.
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function parse(str, mask) {
    if (typeof str !== 'string' || !str.trim()) return null;
    mask = (typeof mask === 'string' && mask) ? mask : DEFAULT_MASK;
    // Токенизируем маску: чередуем литералы и плейсхолдеры.
    var tokens = mask.split(/(\{DD\.MM\.YYYY\}|\{DD\.MM\.YY\}|\{prefix\}|\{seq\}|\{YYYY\}|\{YY\}|\{MM\}|\{DD\})/);
    var re = '^';
    var order = []; // какие части в каком порядке захватываются
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (!tk) continue;
      switch (tk) {
        case '{DD.MM.YYYY}': re += '(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})'; order.push('D', 'M', 'Y'); break;
        case '{DD.MM.YY}': re += '(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2})'; order.push('D', 'M', 'YY'); break;
        case '{prefix}': re += '([^/\\s]*)'; order.push('prefix'); break;
        case '{seq}': re += '(\\d+)'; order.push('seq'); break;
        case '{YYYY}': re += '(\\d{4})'; order.push('Y'); break;
        case '{YY}': re += '(\\d{2})'; order.push('YY'); break;
        case '{MM}': re += '(\\d{1,2})'; order.push('M'); break;
        case '{DD}': re += '(\\d{1,2})'; order.push('D'); break;
        default: re += esc(tk);
      }
    }
    re += '$';
    var mm;
    try { mm = new RegExp(re).exec(str.trim()); } catch (e) { return null; }
    if (!mm) return null;
    var out = { prefix: '', seq: null, date: null };
    var Y = null, M = null, D = null, YY = null;
    for (var j = 0; j < order.length; j++) {
      var val = mm[j + 1];
      switch (order[j]) {
        case 'prefix': out.prefix = val || ''; break;
        case 'seq': out.seq = +val; break;
        case 'Y': Y = +val; break;
        case 'YY': YY = +val; break;
        case 'M': M = +val; break;
        case 'D': D = +val; break;
      }
    }
    if (Y == null && YY != null) Y = 2000 + YY; // двузначный год → 20xx
    if (Y != null && M != null && D != null) {
      out.date = Y + '-' + pad2(M) + '-' + pad2(D);
    } else if (Y != null) {
      out.year = Y;
    }
    return out;
  }

  // --- next(prefix?, dateOrLog?, maybeLog?) --------------------------------
  // Перегрузки (без зависимости от порядка для удобства тестов):
  //   next()                       → по текущему году, без префикса, по журналу из стора
  //   next('ПБ')                   → текущий год, префикс 'ПБ'
  //   next('ПБ', date)             → год из date, префикс 'ПБ'
  //   next('ПБ', date, logArray)   → год из date, по переданному журналу (чистая)
  //   next('ПБ', logArray)         → текущий год, по переданному журналу
  function next(prefix, dateOrLog, maybeLog) {
    prefix = (prefix == null) ? '' : String(prefix);
    var log, date;
    if (Array.isArray(dateOrLog)) { log = dateOrLog; date = undefined; }
    else { date = dateOrLog; log = Array.isArray(maybeLog) ? maybeLog : null; }
    if (!log) log = loadLog();
    var year = toParts(date).Y;
    var max = 0;
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      if (!e) continue;
      if (String(e.prefix == null ? '' : e.prefix) !== prefix) continue;
      if (toParts(e.date).Y !== year) continue;
      var s = +e.seq;
      if (!isNaN(s) && s > max) max = s;
    }
    return max + 1;
  }

  // --- register(entry) — добавить в журнал с дедупом (seq+year+prefix) -----
  function sameKey(a, prefix, seq, year) {
    return String(a.prefix == null ? '' : a.prefix) === prefix &&
      +a.seq === seq && toParts(a.date).Y === year;
  }
  function register(entry) {
    entry = entry || {};
    var prefix = (entry.prefix == null) ? '' : String(entry.prefix);
    var seq = +entry.seq;
    if (isNaN(seq)) return null;            // без валидного seq не регистрируем
    var date = (entry.date == null) ? new Date() : entry.date;
    var parts = toParts(date);
    var year = parts.Y;
    var log = loadLog();
    for (var i = 0; i < log.length; i++) {
      if (log[i] && sameKey(log[i], prefix, seq, year)) return null; // дубль
    }
    var rec = {
      prefix: prefix,
      seq: seq,
      // нормализуем дату записи к ISO-строке для стабильного хранения
      date: parts.Y + '-' + pad2(parts.M) + '-' + pad2(parts.D),
      title: (entry.title == null) ? '' : String(entry.title),
      counterparty: (entry.counterparty == null) ? '' : String(entry.counterparty),
      number: format({ prefix: prefix, seq: seq, date: date, mask: entry.mask }),
      ts: parts.Y + '-' + pad2(parts.M) + '-' + pad2(parts.D)
    };
    log.push(rec);
    saveLog(log);
    return rec;
  }

  // --- list() / clear() ----------------------------------------------------
  function list() { return loadLog().slice(); }
  function clear() { saveLog([]); }

  window.SensorNumbering = {
    DEFAULT_MASK: DEFAULT_MASK,
    STORE_KEY: STORE_KEY,
    format: format,
    parse: parse,
    next: next,
    register: register,
    list: list,
    clear: clear
  };
})();

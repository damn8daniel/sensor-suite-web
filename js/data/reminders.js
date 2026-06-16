/* ===== Слой напоминаний/дедлайнов и SLA (журнал напоминаний) =====
 * Идея #3. Лёгкий детерминированный журнал напоминаний с дедлайнами и
 * SLA-статусом. Хранение — через SensorStore.set('reminders_log', [...]) / get
 * (как numbering пишет в outgoing_log). Без стора — журнал живёт в памяти
 * процесса, модуль НИЧЕГО не бросает.
 *
 * Vanilla SPA: чистый window.*-ассайн, БЕЗ import/export/ES-модулей.
 * UI здесь НЕТ — это автономный слой данных/логики; вкладку подключают позже
 * через ctx.ui. Деградация: ничего не бросает в jsdom — SensorStore может
 * отсутствовать. Зависимость от SensorStore только опциональная (if(...)).
 *
 * ВАЖНО про детерминизм: функции статуса НЕ читают Date.now без явной передачи.
 * Текущий момент инъецируется параметром now (Date | 'YYYY-MM-DD'(-ish) | мс).
 * Только когда now не передан — берётся new Date() (единственная точка чтения
 * часов; в тестах момент инъецируют явно, чтобы не зависеть от часов).
 *
 * SLA-границы (по календарным дням до дедлайна, локальная дата):
 *   'overdue' — дедлайн раньше дня now (просрочено);
 *   'today'   — дедлайн в день now (срок сегодня);
 *   'soon'    — дедлайн в пределах ближайших SOON_DAYS дней (1..SOON_DAYS);
 *   'ok'      — дедлайн дальше SOON_DAYS дней (или дедлайн не задан/некорректен).
 *
 * API window.SensorReminders:
 *   add({title, due, kind?}) -> запись {id, title, due, kind, createdAt} | null
 *     добавляет напоминание в журнал; без title возвращает null (нечего напоминать).
 *   list() -> копия журнала (массив записей)
 *   remove(id) -> true|false (была ли удалена запись)
 *   statusOf(rec, now?) -> 'overdue'|'today'|'soon'|'ok'
 *     детерминированный статус записи (или объекта с .due / строки-даты).
 *   due(now?) -> отсортированный по дедлайну список с полем status у каждой записи
 *     (просроченные/ближайшие сверху; записи без дедлайна — в конце).
 *   clear() -> очистить журнал
 *   SOON_DAYS — порог «скоро» в днях.
 *   STORE_KEY — ключ хранения.
 */
(function (global) {
  'use strict';

  var STORE_KEY = 'reminders_log';
  var SOON_DAYS = 3; // дедлайн в пределах ближайших 3 дней считается «скоро»

  // --- безопасный доступ к хранилищу (без него — память процесса) ---------
  var mem = []; // фолбэк-журнал, если SensorStore недоступен
  function hasStore() {
    return !!(global && global.SensorStore &&
      typeof global.SensorStore.get === 'function' &&
      typeof global.SensorStore.set === 'function');
  }
  function loadLog() {
    if (hasStore()) {
      var v = global.SensorStore.get(STORE_KEY, null);
      return Array.isArray(v) ? v : [];
    }
    return mem.slice();
  }
  function saveLog(arr) {
    var listArr = Array.isArray(arr) ? arr : [];
    if (hasStore()) { global.SensorStore.set(STORE_KEY, listArr); }
    else { mem = listArr.slice(); }
  }

  // --- работа с датами (чистая, без скрытого Date.now) ---------------------
  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  // Нормализуем момент/дату в {Y,M,D} (локальная календарная дата).
  // Принимаем: Date | 'YYYY-MM-DD'(-ish) | число (мс эпохи) | undefined/null.
  // undefined/null → текущая дата (единственная точка чтения часов).
  function toParts(value) {
    var d;
    if (value instanceof Date) {
      d = value;
    } else if (typeof value === 'number' && isFinite(value)) {
      d = new Date(value);
    } else if (typeof value === 'string' && value.trim()) {
      // ISO 'YYYY-MM-DD' и 'YYYY-MM-DDTHH:..' без зависимости от таймзоны
      var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value.trim());
      if (m) return { Y: +m[1], M: +m[2], D: +m[3] };
      d = new Date(value);
      if (isNaN(d.getTime())) return null; // мусорная строка → нет даты
    } else if (value == null) {
      d = new Date();
    } else {
      return null; // неподдерживаемый тип → нет даты
    }
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    return { Y: d.getFullYear(), M: d.getMonth() + 1, D: d.getDate() };
  }

  // ISO-строка 'YYYY-MM-DD' из {Y,M,D} (стабильное хранение/сортировка).
  function partsToIso(p) {
    if (!p) return '';
    return p.Y + '-' + pad2(p.M) + '-' + pad2(p.D);
  }

  // Серийный номер дня (для разницы в календарных днях без таймзонных артефактов).
  function dayNumber(p) {
    // Date.UTC даёт стабильные мс по полуночи UTC → деление на сутки безопасно.
    return Math.floor(Date.UTC(p.Y, p.M - 1, p.D) / 86400000);
  }

  // Разбор ИМЕННО дедлайна: null/undefined/'' → нет дедлайна (null), БЕЗ фолбэка
  // на «сегодня» (в отличие от toParts, где undefined означает «текущий момент»).
  function dueParts(value) {
    if (value == null) return null;
    if (typeof value === 'string' && !value.trim()) return null;
    return toParts(value);
  }

  // --- statusOf(rec, now?) — детерминированный SLA-статус ------------------
  // rec: запись {due} | объект с .due | строка-дата. now: момент (инъекция).
  function dueOf(rec) {
    if (rec == null) return null;
    if (typeof rec === 'string' || typeof rec === 'number' || rec instanceof Date) return rec;
    return rec.due; // объект-запись
  }
  function statusOf(rec, now) {
    var duePart = dueParts(dueOf(rec));
    if (!duePart) return 'ok'; // нет/некорректный дедлайн → не торопимся
    var nowPart = toParts(now);
    if (!nowPart) nowPart = toParts(new Date()); // фолбэк, если now мусорный
    var diff = dayNumber(duePart) - dayNumber(nowPart); // дней до дедлайна
    if (diff < 0) return 'overdue';
    if (diff === 0) return 'today';
    if (diff <= SOON_DAYS) return 'soon';
    return 'ok';
  }

  // --- add({title, due, kind?}) -------------------------------------------
  function makeId() {
    // детерминизма ради id не обязан быть «красивым»; уникальность — время+рандом
    return 'rem_' + Date.now().toString(36) + '_' +
      Math.floor(Math.random() * 1e6).toString(36);
  }
  function add(entry) {
    entry = entry || {};
    var title = (entry.title == null) ? '' : String(entry.title).trim();
    if (!title) return null; // без заголовка напоминать нечего
    var duePart = dueParts(entry.due);
    var createdPart = toParts(entry.createdAt); // позволяем инъекцию для тестов
    if (!createdPart) createdPart = toParts(new Date());
    var rec = {
      id: (entry.id == null || String(entry.id).trim() === '') ? makeId() : String(entry.id),
      title: title,
      due: duePart ? partsToIso(duePart) : '', // нормализуем к ISO либо пусто
      kind: (entry.kind == null) ? '' : String(entry.kind),
      createdAt: partsToIso(createdPart)
    };
    var log = loadLog();
    log.push(rec);
    saveLog(log);
    return rec;
  }

  // --- list() / remove(id) / clear() --------------------------------------
  function list() { return loadLog().slice(); }
  function remove(id) {
    if (id == null) return false;
    var key = String(id);
    var log = loadLog();
    var kept = [];
    var removed = false;
    for (var i = 0; i < log.length; i++) {
      if (log[i] && String(log[i].id) === key) { removed = true; continue; }
      kept.push(log[i]);
    }
    if (removed) saveLog(kept);
    return removed;
  }
  function clear() { saveLog([]); }

  // --- due(now?) — отсортированный список со статусом ----------------------
  // Сортировка: по дедлайну по возрастанию (раньше дедлайн → выше). Записи без
  // дедлайна уходят в конец. now инъецируется параметром (детерминизм).
  function due(now) {
    var log = loadLog();
    var withIdx = [];
    for (var i = 0; i < log.length; i++) {
      var rec = log[i];
      if (!rec) continue;
      var copy = {
        id: rec.id,
        title: rec.title,
        due: rec.due == null ? '' : rec.due,
        kind: rec.kind == null ? '' : rec.kind,
        createdAt: rec.createdAt == null ? '' : rec.createdAt,
        status: statusOf(rec, now)
      };
      var p = dueParts(copy.due);
      copy._key = p ? dayNumber(p) : Infinity; // без дедлайна → в конец
      withIdx.push({ rec: copy, i: i });
    }
    withIdx.sort(function (a, b) {
      if (a.rec._key !== b.rec._key) return a.rec._key - b.rec._key;
      return a.i - b.i; // стабильность: при равном дедлайне — порядок добавления
    });
    return withIdx.map(function (x) {
      delete x.rec._key; // служебный ключ наружу не отдаём
      return x.rec;
    });
  }

  global.SensorReminders = {
    STORE_KEY: STORE_KEY,
    SOON_DAYS: SOON_DAYS,
    add: add,
    list: list,
    remove: remove,
    statusOf: statusOf,
    due: due,
    clear: clear
  };
})(typeof window !== 'undefined' ? window : this);

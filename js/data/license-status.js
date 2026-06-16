/* ===== Слой статусов/SLA пакета лицензии (машина состояний заявки) =====
 * Идея #7. Конечный автомат статусов заявки на образовательную лицензию
 * учебного центра: легальные переходы, история смен статуса, прогресс в %.
 * Хранение журнала заявок — опционально через SensorStore.set('license_apps',[…])
 * / get; без стора журнал живёт в памяти процесса (как в numbering.js).
 *
 * Vanilla SPA: чистый window.*-ассайн, БЕЗ import/export/ES-модулей.
 * UI здесь НЕТ — это автономный слой данных/логики; вкладку (в licensing)
 * подключают в поздней волне через ctx.ui. Деградация: ничего не бросает в
 * jsdom — SensorStore может отсутствовать (тогда журнал живёт в памяти).
 *
 * Конечный автомат:
 *   Черновик → Сбор документов → Подано → На рассмотрении → Решение
 *   Решение  → Получена | Отказ           (терминальные ветки)
 *   На рассмотрении → Сбор документов      (возврат на доработку)
 * 'Получена' и 'Отказ' — терминальные (next() = []).
 *
 * API window.SensorLicenseStatus:
 *   states() -> [...]                 копия списка состояний в порядке прогресса
 *   can(from, to) -> bool             разрешён ли переход from→to
 *   next(from) -> [...]               список допустимых следующих состояний
 *   advance(entry, to) -> {ok, entry, msg}
 *     ЧИСТАЯ: НЕ мутирует вход; при легальном переходе возвращает НОВУЮ запись
 *     с обновлённым state и дописанной историей [{state, ts}]. Нелегальный
 *     переход / мусор → {ok:false, entry:<копия входа>, msg:'…'}.
 *   progressPct(state) -> 0..100      монотонный прогресс по индексу состояния
 *   STATES, TRANSITIONS, TERMINAL, INITIAL, STORE_KEY — константы/данные.
 *   journal: list()/save()/clear()    опциональный журнал заявок (license_apps).
 */
(function () {
  'use strict';

  var STORE_KEY = 'license_apps';

  // --- состояния в порядке прогресса (индекс → progressPct) ----------------
  var STATES = [
    'Черновик',
    'Сбор документов',
    'Подано',
    'На рассмотрении',
    'Решение',
    'Получена',
    'Отказ'
  ];
  var INITIAL = 'Черновик';
  // Терминальные ветки решения — дальше переходов нет.
  var TERMINAL = ['Получена', 'Отказ'];

  // --- разрешённые переходы (граф автомата) --------------------------------
  // Замораживаем массивы, чтобы next() не отдал мутируемую внутреннюю ссылку.
  var TRANSITIONS = {
    'Черновик': ['Сбор документов'],
    'Сбор документов': ['Подано'],
    'Подано': ['На рассмотрении'],
    // с рассмотрения можно либо к решению, либо вернуть на доработку
    'На рассмотрении': ['Решение', 'Сбор документов'],
    'Решение': ['Получена', 'Отказ'],
    'Получена': [],
    'Отказ': []
  };

  // --- безопасный доступ к хранилищу (без него — память процесса) ----------
  var mem = []; // фолбэк-журнал, если SensorStore недоступен
  function hasStore() {
    return typeof window !== 'undefined' && window.SensorStore &&
      typeof window.SensorStore.get === 'function' &&
      typeof window.SensorStore.set === 'function';
  }
  function loadApps() {
    if (hasStore()) {
      var v = window.SensorStore.get(STORE_KEY, null);
      return Array.isArray(v) ? v : [];
    }
    return mem.slice();
  }
  function saveApps(arr) {
    var list = Array.isArray(arr) ? arr : [];
    if (hasStore()) { window.SensorStore.set(STORE_KEY, list); }
    else { mem = list.slice(); }
  }

  // --- утилиты -------------------------------------------------------------
  function isState(s) { return typeof s === 'string' && STATES.indexOf(s) >= 0; }
  function idx(s) { return STATES.indexOf(s); }

  // ts по умолчанию — момент перехода. Это единственная точка чтения часов;
  // в тестах ts можно инъецировать параметром, чтобы переход был детерминирован.
  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  // --- states() ------------------------------------------------------------
  function states() { return STATES.slice(); }

  // --- can(from, to) -------------------------------------------------------
  function can(from, to) {
    if (!isState(from) || !isState(to)) return false;
    var allowed = TRANSITIONS[from];
    return Array.isArray(allowed) && allowed.indexOf(to) >= 0;
  }

  // --- next(from) ----------------------------------------------------------
  function next(from) {
    if (!isState(from)) return [];
    var allowed = TRANSITIONS[from];
    return Array.isArray(allowed) ? allowed.slice() : [];
  }

  // --- progressPct(state) -> 0..100 (монотонно неубывает по индексу) -------
  // 'Черновик' = 0%, последний шаг (терминал) = 100%. Терминальные ветки
  // ('Получена'/'Отказ') обе дают 100% — заявка завершена в любом исходе.
  function progressPct(state) {
    if (!isState(state)) return 0;
    var i = idx(state);
    // 'Получена' и 'Отказ' — параллельные терминалы; обе = 100%.
    // База шкалы — состояния до терминалов: Черновик..Решение (индексы 0..4).
    var lastNonTerminal = STATES.length - TERMINAL.length - 1; // индекс 'Решение'
    if (i >= lastNonTerminal && TERMINAL.indexOf(state) >= 0) return 100;
    if (lastNonTerminal <= 0) return 100;
    var pct = Math.round((i / lastNonTerminal) * 100);
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    return pct;
  }

  // --- advance(entry, to) -> {ok, entry, msg} (ЧИСТАЯ, не мутирует вход) ----
  // Копируем вход поверхностно + клонируем history, чтобы исходный объект и его
  // массив истории остались нетронутыми. Текущее состояние берём из entry.state
  // (если его нет — считаем INITIAL). Легальность проверяем через can().
  function cloneEntry(entry) {
    var src = (entry && typeof entry === 'object') ? entry : {};
    var copy = {};
    for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) copy[k] = src[k]; }
    // история — отдельный массив новых объектов (не делим ссылки с входом)
    var hist = Array.isArray(src.history) ? src.history : [];
    copy.history = hist.map(function (h) {
      return (h && typeof h === 'object') ? { state: h.state, ts: h.ts } : h;
    });
    return copy;
  }

  function advance(entry, to, ts) {
    var copy = cloneEntry(entry);
    var from = isState(copy.state) ? copy.state : INITIAL;
    if (!isState(to)) {
      return { ok: false, entry: copy, msg: 'Неизвестное целевое состояние: ' + String(to) };
    }
    if (!can(from, to)) {
      return {
        ok: false,
        entry: copy,
        msg: 'Недопустимый переход «' + from + '» → «' + to + '»'
      };
    }
    var when = (typeof ts === 'string' && ts) ? ts : nowIso();
    copy.state = to;
    // если истории ещё не было — зафиксируем и стартовое состояние
    if (!copy.history.length) {
      copy.history.push({ state: from, ts: when });
    }
    copy.history.push({ state: to, ts: when });
    return { ok: true, entry: copy, msg: 'Переход «' + from + '» → «' + to + '»' };
  }

  // --- опциональный журнал заявок (license_apps) ---------------------------
  function list() { return loadApps().slice(); }
  function save(apps) { saveApps(apps); }
  function clear() { saveApps([]); }

  window.SensorLicenseStatus = {
    STORE_KEY: STORE_KEY,
    STATES: STATES,
    TRANSITIONS: TRANSITIONS,
    TERMINAL: TERMINAL,
    INITIAL: INITIAL,
    states: states,
    can: can,
    next: next,
    advance: advance,
    progressPct: progressPct,
    list: list,
    save: save,
    clear: clear
  };
})();

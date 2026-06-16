/* ===========================================================================
   js/data/dedup.js — Дедупликация контрагентов / нечёткое сличение (Идея #6).

   Автономный модуль window.SensorDedup. Классический <script>, БЕЗ import/export —
   подключается обычным тегом в блоке js/data/* (после store.js, до app.js).

   Назначение: чистое сличение карточек контрагентов для поиска вероятных дублей.
     • ИНН сравнивается ТОЧНО (после очистки от нецифр) — это надёжный ключ.
     • Имя (название) сравнивается НЕЧЁТКО: нормализация (регистр, пробелы,
       кавычки, ОПФ-приставки ООО/АО/ИП и т.п.) + метрика похожести 0..1.

   Все функции:
     • чистые и детерминированные (один вход → один выход);
     • НЕ трогают DOM, не зависят от window.SensorUI/SensorStore (стор —
       только опционально и НИКОГДА не обязателен; модуль не бросает без него);
     • НЕ бросают исключений на пустом/мусорном входе (null/undefined/число/строка);
     • mergePreview НЕ мутирует входные карточки (возвращает новый объект);
     • тексты по-русски.

   API window.SensorDedup:
     normalizeName(s) -> строка
         нижний регистр, схлоп пробелов, снятие кавычек и ОПФ-приставок.
     similarity(a, b) -> число 0..1
         похожесть двух названий по нормализованной дистанции Левенштейна,
         симметрична, идентичные → 1, пустые/мусор → 0.
     findDuplicates(list, opts?) -> массив групп [{ key, reason, items:[...] }]
         группирует вероятные дубли по ИНН (точное) либо по имени (порог
         similarity, opts.threshold, по умолчанию DEFAULT_THRESHOLD).
     mergePreview(a, b) -> карточка | null
         предпросмотр объединённой карточки (без записи, без мутации входов).
     DEFAULT_THRESHOLD — порог нечёткого совпадения имён по умолчанию.
   =========================================================================== */
(function (global) {
  'use strict';

  var DEFAULT_THRESHOLD = 0.82; // порог similarity для признания имён дублями

  // --- утилиты ---------------------------------------------------------------

  function str(v) { return v == null ? '' : String(v); }

  // Только цифры (для точного сравнения ИНН: '7700-12 34 56' → '7700123456').
  function digitsOnly(v) { return str(v).replace(/\D/g, ''); }

  // Организационно-правовые формы и их вариации (рус + лат-омоглифы редки, но
  // учитываем распространённые написания). Снимаются как приставка/суффикс.
  // Список покрывает частые ОПФ: ООО, АО, ПАО, ОАО, ЗАО, НАО, ИП, ПК, НКО,
  // АНО, ФГУП, ГУП, МУП, ТСЖ, СНТ.
  var OPF = [
    'общество с ограниченной ответственностью',
    'публичное акционерное общество',
    'открытое акционерное общество',
    'закрытое акционерное общество',
    'непубличное акционерное общество',
    'акционерное общество',
    'индивидуальный предприниматель',
    'производственный кооператив',
    'некоммерческая организация',
    'автономная некоммерческая организация',
    'федеральное государственное унитарное предприятие',
    'государственное унитарное предприятие',
    'муниципальное унитарное предприятие',
    'товарищество собственников жилья',
    'садовое некоммерческое товарищество',
    'ооо', 'пао', 'оао', 'зао', 'нао', 'ао', 'ип', 'пк', 'нко', 'ано',
    'фгуп', 'гуп', 'муп', 'тсж', 'снт'
  ];

  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Готовим regex для снятия ОПФ как отдельного «слова» в начале или конце строки.
  // Длинные формы стоят раньше коротких в OPF — порядок альтернатив сохраняем,
  // чтобы 'акционерное общество' матчилось раньше 'ао'.
  var OPF_ALT = OPF.map(esc).join('|');
  // приставка в начале: <опф> <разделитель>
  var RE_OPF_PREFIX = new RegExp('^(?:' + OPF_ALT + ')(?:\\s+|$)');
  // суффикс в конце: <разделитель> <опф>
  var RE_OPF_SUFFIX = new RegExp('(?:^|\\s+)(?:' + OPF_ALT + ')$');

  // --- normalizeName(s) ------------------------------------------------------
  // Нижний регистр → ё→е → снятие кавычек всех видов → схлоп пробелов и пунктуации
  // в пробел → снятие ОПФ-приставки/суффикса → финальный trim/схлоп.
  function normalizeName(s) {
    var t = str(s).toLowerCase();
    if (!t.trim()) return '';
    t = t.replace(/ё/g, 'е'); // ё → е
    // снять кавычки и апострофы любых видов
    t = t.replace(/["'`«»“”„‹›‟]/g, ' ');
    // прочую пунктуацию/спецсимволы → пробел (точки, запятые, дефисы, слэши и т.п.)
    t = t.replace(/[.,;:!?()\[\]{}<>/\\|+*=_~№#@%^&]/g, ' ');
    // схлоп пробелов
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) return '';
    // снять ОПФ-приставку, затем (на остатке) суффикс — по одному разу каждую
    t = t.replace(RE_OPF_PREFIX, '').trim();
    t = t.replace(RE_OPF_SUFFIX, '').trim();
    // повторный схлоп после снятия
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  // --- расстояние Левенштейна (итеративно, O(n*m) памяти O(min)) -------------
  function levenshtein(a, b) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;
    // одна строка-буфер для предыдущей строки матрицы
    var prev = new Array(lb + 1);
    for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      var cur = new Array(lb + 1);
      cur[0] = i;
      var ca = a.charCodeAt(i - 1);
      for (var k = 1; k <= lb; k++) {
        var cost = (ca === b.charCodeAt(k - 1)) ? 0 : 1;
        var del = prev[k] + 1;
        var ins = cur[k - 1] + 1;
        var sub = prev[k - 1] + cost;
        var m = del < ins ? del : ins;
        cur[k] = m < sub ? m : sub;
      }
      prev = cur;
    }
    return prev[lb];
  }

  // --- similarity(a, b) -> 0..1 ----------------------------------------------
  // Сравниваем НОРМАЛИЗОВАННЫЕ названия. Метрика: 1 - dist/maxLen (нормализованная
  // дистанция Левенштейна). Симметрична. Идентичные → 1. Любой пустой вход → 0.
  function similarity(a, b) {
    var na = normalizeName(a);
    var nb = normalizeName(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    var maxLen = na.length > nb.length ? na.length : nb.length;
    if (maxLen === 0) return 0;
    var dist = levenshtein(na, nb);
    var sim = 1 - dist / maxLen;
    if (sim < 0) sim = 0;
    if (sim > 1) sim = 1;
    return sim;
  }

  // --- findDuplicates(list, opts?) -------------------------------------------
  // Возвращает массив групп вероятных дублей. Каждая группа:
  //   { key: <строка>, reason: 'inn'|'name', items: [<карточка>, ...] }
  // Алгоритм:
  //   1) Точная группировка по ИНН (digitsOnly, валидной длины 10/12) — самый
  //      надёжный ключ. Карточки с одинаковым ИНН → одна группа (reason 'inn').
  //   2) Среди оставшихся (без ИНН или с уникальным ИНН) — нечёткая кластеризация
  //      по имени: объединяем в группу, если similarity >= threshold.
  // Группой считается множество из ≥2 карточек. Порядок групп — по первому
  // вхождению. Мусор/пустой список → [].
  function findDuplicates(list, opts) {
    if (!Array.isArray(list) || list.length === 0) return [];
    opts = opts || {};
    var threshold = (typeof opts.threshold === 'number' && opts.threshold >= 0 && opts.threshold <= 1)
      ? opts.threshold : DEFAULT_THRESHOLD;

    // нормализуем индексы; отбрасываем не-объекты
    var rows = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c == null || typeof c !== 'object') continue;
      var inn = digitsOnly(c.inn != null ? c.inn : c.INN);
      rows.push({
        card: c,
        idx: i,
        inn: (inn.length === 10 || inn.length === 12) ? inn : '',
        used: false
      });
    }
    if (rows.length === 0) return [];

    var groups = [];

    // 1) группировка по ИНН (точная)
    var byInn = {};               // inn -> массив строк
    var innOrder = [];
    for (var a = 0; a < rows.length; a++) {
      if (!rows[a].inn) continue;
      var key = rows[a].inn;
      if (!byInn[key]) { byInn[key] = []; innOrder.push(key); }
      byInn[key].push(rows[a]);
    }
    for (var o = 0; o < innOrder.length; o++) {
      var bucket = byInn[innOrder[o]];
      if (bucket.length >= 2) {
        for (var b = 0; b < bucket.length; b++) bucket[b].used = true;
        groups.push({
          key: innOrder[o],
          reason: 'inn',
          items: bucket.map(function (r) { return r.card; })
        });
      }
    }

    // 2) нечёткая кластеризация по имени среди НЕиспользованных строк
    for (var p = 0; p < rows.length; p++) {
      if (rows[p].used) continue;
      var seedName = str(rows[p].card.name != null ? rows[p].card.name : rows[p].card.title);
      var normSeed = normalizeName(seedName);
      if (!normSeed) continue; // без имени нечётко сравнивать нечего
      var cluster = [rows[p]];
      rows[p].used = true;
      for (var q = p + 1; q < rows.length; q++) {
        if (rows[q].used) continue;
        var otherName = str(rows[q].card.name != null ? rows[q].card.name : rows[q].card.title);
        if (!normalizeName(otherName)) continue;
        if (similarity(seedName, otherName) >= threshold) {
          cluster.push(rows[q]);
          rows[q].used = true;
        }
      }
      if (cluster.length >= 2) {
        groups.push({
          key: normSeed,
          reason: 'name',
          items: cluster.map(function (r) { return r.card; })
        });
      }
    }

    return groups;
  }

  // --- mergePreview(a, b) -> объединённая карточка (без записи, без мутации) --
  // Предпросмотр слияния двух карточек. Базой берём `a`; для каждого поля
  // выбираем непустое значение, отдавая предпочтение `a`, а где у `a` пусто —
  // берём из `b`. Известные поля карточки контрагента перечислены явно, плюс
  // переносим любые дополнительные ключи из обоих объектов. Входы НЕ мутируются.
  function isEmpty(v) {
    if (v == null) return true;
    var s = String(v).trim();
    return s === '' || s === '—' || s === '-';
  }
  function pick(av, bv) { return isEmpty(av) ? (isEmpty(bv) ? (av != null ? av : bv) : bv) : av; }

  function mergePreview(a, b) {
    var oa = (a != null && typeof a === 'object') ? a : null;
    var ob = (b != null && typeof b === 'object') ? b : null;
    if (!oa && !ob) return null;
    if (!oa) return shallowCopy(ob);
    if (!ob) return shallowCopy(oa);

    var out = {};
    // собрать объединённое множество ключей (порядок: ключи a, затем новые из b)
    var keys = [];
    var seen = {};
    var k;
    for (k in oa) { if (Object.prototype.hasOwnProperty.call(oa, k) && !seen[k]) { seen[k] = true; keys.push(k); } }
    for (k in ob) { if (Object.prototype.hasOwnProperty.call(ob, k) && !seen[k]) { seen[k] = true; keys.push(k); } }

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      out[key] = pick(oa[key], ob[key]);
    }
    return out;
  }

  function shallowCopy(obj) {
    var out = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    }
    return out;
  }

  // --- экспорт ---------------------------------------------------------------
  var API = {
    DEFAULT_THRESHOLD: DEFAULT_THRESHOLD,
    normalizeName: normalizeName,
    similarity: similarity,
    findDuplicates: findDuplicates,
    mergePreview: mergePreview,
    // внутренний помощник открыт для повторного использования/тестов
    _levenshtein: levenshtein
  };

  global.SensorDedup = API;
})(typeof window !== 'undefined' ? window : this);

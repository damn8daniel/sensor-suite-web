/* ===========================================================================
   js/data/pipeline.js — Метрики воронки продаж по этапам (идея #5).

   Автономный модуль window.SensorPipeline. Классический <script>, БЕЗ
   import/export — подключается обычным тегом в блоке js/data/* (после store.js,
   до app.js). Паттерн один-в-один с js/data/numbering.js и validators.js.

   Все функции:
     • чистые и детерминированные (один и тот же вход → один и тот же выход);
     • НЕ трогают DOM, НЕ зависят от window.SensorUI;
     • от window.SensorStore зависят ТОЛЬКО опционально и НИКОГДА не бросают,
       если стора нет (метрики считаются из явно переданного массива сделок);
     • НЕ бросают исключений на null/undefined/мусоре — пустой/битый вход даёт
       нулевые агрегаты;
     • тексты по-русски.

   Модель сделки (поля минимальны и устойчивы к отсутствию):
     { stage:строка, amount:число, status:'won'|'lost'|'open', manager:строка }
   Любое поле может отсутствовать — применяется NaN-guard / нормализация.

   Публичный API window.SensorPipeline:
     STAGES — фиксированный порядок этапов воронки (массив строк).
     funnel(deals, stages?) -> [{stage, count, sum}]  по фиксированному порядку.
     conversion(deals, fromStage, toStage) -> {ok, msg, rate}  (rate 0..1;
       деление на ноль → ok:false).
     summary(deals) -> {total, won, lost, open, sum, avgCheck}
       инвариант: won + lost + open === total; sum === Σ amount.
     byManager(deals) -> [{manager, total, won, lost, open, sum, avgCheck}]
       агрегаты по ответственному (сортировка по убыванию sum, затем по имени).
   =========================================================================== */
(function (global) {
  'use strict';

  // --- фиксированный порядок этапов воронки --------------------------------
  // Канонические этапы CRM-воронки сверху вниз. funnel() всегда возвращает
  // строки в этом порядке (если не передан кастомный список этапов).
  var STAGES = [
    'Лид',          // первичный контакт
    'Квалификация', // подтверждение потребности/бюджета
    'Предложение',  // отправлено КП/смета
    'Переговоры',   // согласование условий
    'Договор',      // подписание/закрытие
    'Оплата'        // деньги получены
  ];

  // --- безопасные приведения (NaN-guard) -----------------------------------
  function str(v) { return v == null ? '' : String(v).trim(); }

  // Число суммы сделки: число → как есть (NaN/Infinity → 0); числовая строка
  // (с пробелами/запятой-разделителем дробной части) → парсится; иначе 0.
  function num(v) {
    if (typeof v === 'number') { return isFinite(v) ? v : 0; }
    if (typeof v === 'string') {
      var s = v.trim().replace(/\s+/g, '').replace(',', '.');
      if (!s) return 0;
      var n = Number(s);
      return isFinite(n) ? n : 0;
    }
    return 0;
  }

  // Нормализованный статус сделки. Принимаем варианты написания (рус/англ),
  // всё прочее (включая отсутствие) → 'open' (сделка в работе).
  function normStatus(v) {
    var s = str(v).toLowerCase();
    if (s === 'won' || s === 'выиграна' || s === 'выиграно' ||
        s === 'успех' || s === 'closed_won' || s === 'closedwon') return 'won';
    if (s === 'lost' || s === 'проиграна' || s === 'проиграно' ||
        s === 'отказ' || s === 'closed_lost' || s === 'closedlost') return 'lost';
    return 'open';
  }

  // Привести вход к массиву сделок (мусор → []).
  function asDeals(deals) { return Array.isArray(deals) ? deals : []; }

  // Округление денежного агрегата до копеек, чтобы убрать дрейф float.
  function round2(n) {
    if (!isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  // --- funnel(deals, stages?) ----------------------------------------------
  // Считает count и sum по каждому этапу из фиксированного (или переданного)
  // списка этапов. Этапы, которых нет среди сделок, дают нулевые агрегаты;
  // сделки с неизвестным этапом в результат не попадают (но видны в summary).
  function funnel(deals, stages) {
    var list = asDeals(deals);
    var order = Array.isArray(stages) && stages.length
      ? stages.map(str)
      : STAGES.slice();
    var acc = {};
    var i;
    for (i = 0; i < order.length; i++) {
      acc[order[i]] = { stage: order[i], count: 0, sum: 0 };
    }
    for (i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d) continue;
      var st = str(d.stage);
      if (!acc.hasOwnProperty(st)) continue; // неизвестный/пустой этап пропускаем
      acc[st].count += 1;
      acc[st].sum += num(d.amount);
    }
    var out = [];
    for (i = 0; i < order.length; i++) {
      var row = acc[order[i]];
      out.push({ stage: row.stage, count: row.count, sum: round2(row.sum) });
    }
    return out;
  }

  // --- conversion(deals, fromStage, toStage) -------------------------------
  // Доля сделок этапа toStage относительно fromStage по числу сделок (count).
  // rate в диапазоне 0..1. Если в fromStage нет сделок — деление на ноль →
  // ok:false (rate:0). Возвращает {ok, msg, rate}.
  function conversion(deals, fromStage, toStage) {
    var f = funnel(deals);
    var from = str(fromStage);
    var to = str(toStage);
    var byStage = {};
    for (var i = 0; i < f.length; i++) byStage[f[i].stage] = f[i];

    if (!byStage.hasOwnProperty(from)) {
      return { ok: false, msg: 'Этап-источник не из воронки: ' + (from || '(пусто)'), rate: 0 };
    }
    if (!byStage.hasOwnProperty(to)) {
      return { ok: false, msg: 'Целевой этап не из воронки: ' + (to || '(пусто)'), rate: 0 };
    }
    var base = byStage[from].count;
    if (base === 0) {
      return { ok: false, msg: 'Нет сделок на этапе «' + from + '» — конверсия не определена', rate: 0 };
    }
    var rate = byStage[to].count / base;
    return { ok: true, msg: 'Конверсия «' + from + '» → «' + to + '»', rate: rate };
  }

  // --- summary(deals) ------------------------------------------------------
  // Общие агрегаты. Инвариант: won + lost + open === total; sum === Σ amount.
  // avgCheck — средний чек по ВСЕМ сделкам (sum/total), пустой вход → 0.
  function summary(deals) {
    var list = asDeals(deals);
    var total = 0, won = 0, lost = 0, open = 0, sum = 0;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d) continue; // null/мусор в массиве не считаем сделкой
      total += 1;
      sum += num(d.amount);
      var s = normStatus(d.status);
      if (s === 'won') won += 1;
      else if (s === 'lost') lost += 1;
      else open += 1;
    }
    sum = round2(sum);
    return {
      total: total,
      won: won,
      lost: lost,
      open: open,
      sum: sum,
      avgCheck: total ? round2(sum / total) : 0
    };
  }

  // --- byManager(deals) ----------------------------------------------------
  // Агрегаты по ответственному менеджеру. Сделки без менеджера группируются
  // под меткой «(без ответственного)». Возвращает массив, отсортированный по
  // убыванию sum, затем по имени (для детерминизма).
  function byManager(deals) {
    var list = asDeals(deals);
    var NONE = '(без ответственного)';
    var map = {};
    var order = []; // порядок первого появления — для стабильности до сортировки
    var i;
    for (i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d) continue;
      var key = str(d.manager) || NONE;
      if (!map.hasOwnProperty(key)) {
        map[key] = { manager: key, total: 0, won: 0, lost: 0, open: 0, sum: 0 };
        order.push(key);
      }
      var row = map[key];
      row.total += 1;
      row.sum += num(d.amount);
      var s = normStatus(d.status);
      if (s === 'won') row.won += 1;
      else if (s === 'lost') row.lost += 1;
      else row.open += 1;
    }
    var out = [];
    for (i = 0; i < order.length; i++) {
      var r = map[order[i]];
      r.sum = round2(r.sum);
      r.avgCheck = r.total ? round2(r.sum / r.total) : 0;
      out.push(r);
    }
    out.sort(function (a, b) {
      if (b.sum !== a.sum) return b.sum - a.sum;       // больше выручки — выше
      return a.manager < b.manager ? -1 : (a.manager > b.manager ? 1 : 0);
    });
    return out;
  }

  // --- опциональная подгрузка сделок из стора (НИКОГДА не бросает) ----------
  // Удобный помощник: если есть SensorStore — вернёт сохранённый массив сделок
  // по ключу, иначе []. Сами метрики работают с любым явным массивом и от стора
  // не зависят.
  function fromStore(key) {
    var k = str(key) || 'pipeline_deals';
    try {
      if (global && global.SensorStore && typeof global.SensorStore.get === 'function') {
        var v = global.SensorStore.get(k, null);
        return Array.isArray(v) ? v : [];
      }
    } catch (e) { /* стор недоступен/битый — деградируем молча */ }
    return [];
  }

  // --- экспорт в глобальный реестр -----------------------------------------
  var API = {
    STAGES: STAGES.slice(),
    funnel: funnel,
    conversion: conversion,
    summary: summary,
    byManager: byManager,
    fromStore: fromStore
  };

  global.SensorPipeline = API;
})(typeof window !== 'undefined' ? window : this);

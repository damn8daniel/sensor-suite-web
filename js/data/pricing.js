/* ===========================================================================
   js/data/pricing.js — Прайс-движок госпошлин и тарифов (SensorPricing).

   Идея #2. Справочник тарифов и госпошлин услуг учебного центра
   (НОК — независимая оценка квалификации, НРС — национальный реестр
   специалистов, СРО, лицензия МЧС, АТТ ПР — аттестация по промбезопасности)
   как чистые КОНСТАНТЫ + детерминированные функции расчёта стоимости.

   ВНИМАНИЕ: все суммы здесь — ОБЕЗЛИЧЕННЫЕ СИНТЕТИЧЕСКИЕ ДЕМО-ТАРИФЫ для
   витрины/тестов, а НЕ реальные внутренние цены и НЕ актуальные размеры
   госпошлин из НК РФ. Перед использованием в продакшене значения должны быть
   заменены на выверенные из первоисточников. Цифры подобраны округлёнными,
   чтобы это было очевидно.

   Автономный модуль window.SensorPricing. Классический <script>, БЕЗ
   import/export — подключается обычным тегом в блок js/data/* в index.html.

   Все функции:
     • чистые и детерминированные (один вход → один выход, без чтения часов/сети);
     • НЕ трогают DOM, не зависят от window.SensorUI/SensorStore;
     • НЕ бросают исключений на пустом/мусорном входе (null/undefined/число/…);
     • возвращают { ok, msg, amount, breakdown:[{label, amount}] } для priceFor,
       число для govFee, массив описаний услуг для list().

   API window.SensorPricing:
     list() -> [{id, title, govFee, base}]   перечень доступных услуг (копия).
     govFee(serviceId) -> number              размер госпошлины (демо), 0 если
                                              у услуги пошлины нет, NaN если
                                              услуга неизвестна.
     priceFor(serviceId, opts) -> {ok, msg, amount, breakdown}
       Базовый тариф + госпошлина + опциональные надбавки:
         opts.qty        — количество (целое >=1, по умолчанию 1) — множит
                           базовый тариф и пошлину;
         opts.express    — срочное оформление: +EXPRESS_PCT% к базовому тарифу;
         opts.region     — региональный коэффициент (ключ REGION_COEF), множит
                           базовый тариф; неизвестный регион → коэффициент 1.
       ИНВАРИАНТ: amount === Σ breakdown[i].amount.
       Неизвестный serviceId / мусор → {ok:false, msg, amount:0, breakdown:[]}.
     SERVICES, REGION_COEF, EXPRESS_PCT, CURRENCY — константы/данные.
   =========================================================================== */
(function (global) {
  'use strict';

  var CURRENCY = 'RUB';          // валюта тарифов (демо)
  var EXPRESS_PCT = 30;          // надбавка за срочность, % к базовому тарифу

  // --- справочник услуг (СИНТЕТИЧЕСКИЕ демо-тарифы, не реальные цены) --------
  // base   — базовый тариф услуги (руб.);
  // govFee — демо-размер госпошлины (руб.), 0 если пошлины нет.
  var SERVICES = [
    {
      id: 'nok',
      title: 'Независимая оценка квалификации (НОК)',
      base: 15000,
      govFee: 0
    },
    {
      id: 'nrs',
      title: 'Внесение специалиста в НРС',
      base: 12000,
      govFee: 0
    },
    {
      id: 'sro',
      title: 'Вступление в СРО (сопровождение)',
      base: 40000,
      govFee: 0
    },
    {
      id: 'mchs_license',
      title: 'Лицензия МЧС (деятельность по тушению пожаров / монтаж СПЗ)',
      base: 60000,
      govFee: 7500   // демо-госпошлина за предоставление лицензии
    },
    {
      id: 'attpr',
      title: 'Аттестация по промышленной безопасности (АТТ ПР)',
      base: 8000,
      govFee: 1300   // демо-госпошлина за аттестацию
    }
  ];

  // --- региональные коэффициенты (демо) -------------------------------------
  // Неизвестный/непереданный регион → коэффициент 1 (без удорожания).
  var REGION_COEF = {
    'msk': 1.2,   // Москва
    'spb': 1.1,   // Санкт-Петербург
    'reg': 1.0    // прочие регионы
  };

  // --- утилиты ---------------------------------------------------------------
  function ok(extra) {
    var r = { ok: true, msg: 'Расчёт выполнен' };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
    return r;
  }
  function err(msg) {
    return { ok: false, msg: msg, amount: 0, breakdown: [] };
  }

  // Найти услугу по id (строгое сравнение строк, мусор → null).
  function findService(serviceId) {
    if (serviceId == null) return null;
    var id = String(serviceId);
    for (var i = 0; i < SERVICES.length; i++) {
      if (SERVICES[i].id === id) return SERVICES[i];
    }
    return null;
  }

  // Округление денег до целого рубля (детерминированно, без плавающего мусора).
  function money(n) {
    if (typeof n !== 'number' || !isFinite(n)) return 0;
    return Math.round(n);
  }

  // Безопасное целое количество >= 1.
  function qtyOf(opts) {
    if (!opts) return 1;
    var q = Number(opts.qty);
    if (!isFinite(q)) return 1;
    q = Math.floor(q);
    return q >= 1 ? q : 1;
  }

  // --- list() ----------------------------------------------------------------
  function list() {
    return SERVICES.map(function (s) {
      return { id: s.id, title: s.title, govFee: s.govFee, base: s.base };
    });
  }

  // --- govFee(serviceId) -----------------------------------------------------
  // Число (демо-пошлина). Неизвестная услуга → NaN (чтобы вызывающий мог
  // отличить «пошлины нет» (0) от «нет такой услуги» (NaN)).
  function govFee(serviceId) {
    var s = findService(serviceId);
    if (!s) return NaN;
    return s.govFee;
  }

  // --- priceFor(serviceId, opts) --------------------------------------------
  // base*regionCoef (+express%) и govFee, всё умноженное на qty.
  // Инвариант: amount === Σ breakdown[i].amount.
  function priceFor(serviceId, opts) {
    var s = findService(serviceId);
    if (!s) {
      return err('Неизвестная услуга: ' + (serviceId == null ? '(пусто)' : String(serviceId)));
    }
    opts = opts || {};
    var qty = qtyOf(opts);

    // региональный коэффициент (неизвестный регион → 1)
    var coef = 1;
    if (opts.region != null && REGION_COEF.hasOwnProperty(String(opts.region))) {
      coef = REGION_COEF[String(opts.region)];
    }

    var breakdown = [];

    // 1) базовый тариф (с учётом региона и количества)
    var baseTotal = money(s.base * coef * qty);
    breakdown.push({
      label: 'Базовый тариф' +
        (coef !== 1 ? ' (рег. коэф. ' + coef + ')' : '') +
        (qty > 1 ? ' ×' + qty : ''),
      amount: baseTotal
    });

    // 2) надбавка за срочность (% от базового тарифа)
    if (opts.express) {
      var expressTotal = money(baseTotal * EXPRESS_PCT / 100);
      breakdown.push({
        label: 'Срочное оформление (+' + EXPRESS_PCT + '%)',
        amount: expressTotal
      });
    }

    // 3) госпошлина (демо), если есть, тоже на количество
    if (s.govFee > 0) {
      breakdown.push({
        label: 'Госпошлина (демо)' + (qty > 1 ? ' ×' + qty : ''),
        amount: money(s.govFee * qty)
      });
    }

    // amount как сумма строк — гарантирует инвариант amount === Σ breakdown.
    var amount = 0;
    for (var i = 0; i < breakdown.length; i++) amount += breakdown[i].amount;

    return ok({
      msg: 'Расчёт стоимости услуги «' + s.title + '» (демо-тарифы)',
      amount: amount,
      currency: CURRENCY,
      breakdown: breakdown
    });
  }

  // --- экспорт в глобальный реестр ------------------------------------------
  global.SensorPricing = {
    CURRENCY: CURRENCY,
    EXPRESS_PCT: EXPRESS_PCT,
    SERVICES: SERVICES,
    REGION_COEF: REGION_COEF,
    list: list,
    govFee: govFee,
    priceFor: priceFor
  };
})(typeof window !== 'undefined' ? window : this);

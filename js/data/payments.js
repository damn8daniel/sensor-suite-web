/* ===========================================================================
   js/data/payments.js — Слой расчёта рассрочки / графика платежей.

   Идея #1. Автономный чистый слой window.SensorPayments: строит график
   платежей по счёту (рассрочка), деля ИТОГО на N равных долей с копеечной
   балансировкой так, чтобы Σ долей В ТОЧНОСТИ равнялась исходной сумме.

   Vanilla SPA: классический <script>, БЕЗ import/export/ES-модулей. Подключается
   обычным тегом среди чистых слоёв js/data/* (после license-status.js, до ui.js).

   Все функции:
     • чистые и детерминированные (один вход → один выход), копейка стабильна;
     • НЕ трогают DOM, НЕ зависят от window.SensorUI;
     • SensorStore этому слою НЕ НУЖЕН вовсе — но даже если стора нет, ничего
       не бросается (как в numbering.js/validators.js): слой автономен;
     • НЕ бросают исключений на null/undefined/мусоре/нуле/отрицательном — на
       плохом входе возвращают { ok:false, msg } (msg по-русски);
     • дата инъецируется параметром (как numbering.format) — скрытого Date.now нет.

   ───────────────────────── ИНВАРИАНТЫ (зафиксированы, менять только тут) ──────
   Деньги считаются в КОПЕЙКАХ (целые), наружу отдаются в рублях с 2 знаками.
     1) Сумма приводится к копейкам: cents = round2(total)*100 (через round half-up).
     2) base = floor(cents / parts) — равная доля вниз до копейки.
     3) rem  = cents − base*parts — нераспределённый остаток (0 ≤ rem < parts копеек).
        Остаток ДОБИРАЕТСЯ В ПОСЛЕДНИЙ платёж (инвариант баланса как в nok.calc):
        первые parts−1 долей = base, последняя = base + rem.
        ⇒ Σ amount === total ровно, до копейки, при любых total/parts.
     4) Даты: платёж n (1-based) = firstDate, сдвинутый на (n−1) период:
        'month'  → +(n−1) месяц (с зажимом конца месяца),
        'biweek' → +(n−1)·14 дней,
        'week'   → +(n−1)·7 дней.
        Дата нормализуется к ISO 'YYYY-MM-DD'. По умолчанию period='month'.

   ───────────────────────── ЮНИТ-ТЕСТЫ (мысленная проверка инвариантов) ────────
   Записаны как комментарии — прогоняются глазами при правках, защищают логику.

     T1. Ровное деление: split(120000, 12) → 12×10000; Σ=120000.                  ✔
     T2. Копеечная балансировка: split(100, 3) → [33.33,33.33,33.34]; Σ=100.00.   ✔
         (base=3333 коп., rem=1 коп. → в последнюю долю)
     T3. Остаток >1 копейки: split(100.01, 3) → [33.33,33.33,33.35]; Σ=100.01.    ✔
         (cents=10001, base=3333, rem=10001−9999=2 → последняя 3335 коп.)
     T4. parts=1: split(777.77,1) → [777.77]; schedule даёт одну строку n=1.       ✔
     T5. schedule баланс: Σ rows.amount === total до копейки при любом N.          ✔
     T6. Изоляция периодов по датам (firstDate=2026-01-15):
         month  → 2026-01-15, 2026-02-15, 2026-03-15 …
         biweek → 2026-01-15, 2026-01-29, 2026-02-12 …
         week   → 2026-01-15, 2026-01-22, 2026-01-29 …                             ✔
     T7. Зажим конца месяца: firstDate=2026-01-31, month, 2-й платёж → 2026-02-28
         (фев. короче — берём последний день месяца, без «перетекания» в март).   ✔
     T8. Мусор/0/отрицательное → { ok:false, msg }, НЕ бросает:
         schedule({total:'abc',parts:3}) → ok:false; parts:0 → ok:false;
         parts:-2 → ok:false; total:0 → ok:false (нечего рассрочивать).            ✔
     T9. Детерминизм: одинаковый вход → побитово одинаковый rows (дата явная).     ✔
    T10. formatPlan(rows) — текстовая сводка по-русски; на пустом/мусоре «—».      ✔
   =========================================================================== */
(function (global) {
  'use strict';

  var DEFAULT_PERIOD = 'month';
  var PERIODS = { month: 'month', biweek: 'biweek', week: 'week' };

  function err(msg) { return { ok: false, msg: msg }; }

  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  // Округление half-up до 2 знаков (как round2 в nok.calc), устойчивое к float.
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  // Привести вход к конечному числу или null (мусор/NaN/Infinity → null).
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string') {
      var s = v.trim().replace(',', '.'); // допускаем русскую запятую
      if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
      var n = Number(s);
      return isFinite(n) ? n : null;
    }
    return null;
  }

  // Привести parts к целому ≥ 1 или null.
  function intParts(v) {
    var n = num(v);
    if (n == null) return null;
    if (Math.floor(n) !== n) return null;   // только целое число долей
    if (n < 1) return null;                 // 0/отрицательное недопустимо
    return n;
  }

  // ── split(total, parts) → массив сумм (рубли, 2 знака) с балансировкой ──────
  // Возвращает массив длиной parts, Σ которого В ТОЧНОСТИ равна round2(total).
  // На плохом входе → null (НЕ бросает). Деньги делятся в копейках.
  function split(total, parts) {
    var t = num(total);
    var p = intParts(parts);
    if (t == null || p == null) return null;
    if (t < 0) return null;
    var cents = Math.round(round2(t) * 100);   // целые копейки
    var base = Math.floor(cents / p);          // равная доля вниз
    var rem = cents - base * p;                // остаток (0..p-1 копеек)
    var out = [];
    for (var i = 0; i < p; i++) {
      var c = (i === p - 1) ? (base + rem) : base; // остаток — в ПОСЛЕДНИЙ платёж
      out.push(round2(c / 100));
    }
    return out;
  }

  // ── работа с датами (чистая, дата инъецируется параметром) ──────────────────
  // Нормализуем вход в {Y,M,D}. Принимаем Date | 'YYYY-MM-DD'(-ish) | undefined.
  // undefined/мусор → null (для schedule это ошибка входа, не «сегодня»).
  function toParts(date) {
    if (date instanceof Date) {
      if (isNaN(date.getTime())) return null;
      return { Y: date.getFullYear(), M: date.getMonth() + 1, D: date.getDate() };
    }
    if (typeof date === 'string' && date.trim()) {
      var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date.trim());
      if (m) {
        var Y = +m[1], M = +m[2], D = +m[3];
        if (M < 1 || M > 12 || D < 1 || D > 31) return null;
        return { Y: Y, M: M, D: D };
      }
      var d = new Date(date.trim());
      if (isNaN(d.getTime())) return null;
      return { Y: d.getFullYear(), M: d.getMonth() + 1, D: d.getDate() };
    }
    return null;
  }

  // Кол-во дней в месяце (1-based month).
  function daysInMonth(Y, M) { return new Date(Y, M, 0).getDate(); }

  // ISO 'YYYY-MM-DD' из {Y,M,D}.
  function iso(p) { return p.Y + '-' + pad2(p.M) + '-' + pad2(p.D); }

  // Сдвиг даты на k периодов вперёд. Возвращает ISO-строку.
  //   month  → +k месяцев с зажимом дня к концу месяца (31→28/30 и т.п.);
  //   biweek → +k*14 дней; week → +k*7 дней.
  function shift(base, k, period) {
    if (k === 0) return iso(base);
    if (period === 'month') {
      var totalM = (base.Y * 12 + (base.M - 1)) + k;
      var Y = Math.floor(totalM / 12);
      var M = (totalM % 12) + 1;
      var D = Math.min(base.D, daysInMonth(Y, M)); // зажим конца месяца
      return iso({ Y: Y, M: M, D: D });
    }
    var days = (period === 'week') ? 7 * k : 14 * k; // biweek по умолчанию
    // Считаем через UTC, чтобы не зависеть от таймзоны/перевода часов.
    var dt = new Date(Date.UTC(base.Y, base.M - 1, base.D));
    dt.setUTCDate(dt.getUTCDate() + days);
    return iso({ Y: dt.getUTCFullYear(), M: dt.getUTCMonth() + 1, D: dt.getUTCDate() });
  }

  // ── schedule({total, parts, firstDate, period}) → {ok,msg,rows} ─────────────
  // rows: [{ n, date:'YYYY-MM-DD', amount:number }], Σ amount === total до копейки.
  function schedule(opts) {
    opts = opts || {};
    var t = num(opts.total);
    if (t == null) return err('Сумма: введите число');
    if (t <= 0) return err('Сумма: должна быть больше нуля');
    var p = intParts(opts.parts);
    if (p == null) return err('Число платежей: целое число ≥ 1');
    var base = toParts(opts.firstDate);
    if (!base) return err('Дата первого платежа: формат ГГГГ-ММ-ДД');
    var period = (opts.period != null && PERIODS[opts.period]) ? opts.period : DEFAULT_PERIOD;
    var amounts = split(t, p);
    if (!amounts) return err('Не удалось разбить сумму на платежи');
    var rows = [];
    for (var i = 0; i < p; i++) {
      rows.push({ n: i + 1, date: shift(base, i, period), amount: amounts[i] });
    }
    return { ok: true, msg: 'График из ' + p + ' платеж' + plural(p) + ' построен', rows: rows };
  }

  // Русская форма слова «платёж» для 1/2/5 (1 платёж, 2 платежа, 5 платежей).
  function plural(n) {
    n = Math.abs(n) % 100;
    var n1 = n % 10;
    if (n > 10 && n < 20) return 'ей';
    if (n1 > 1 && n1 < 5) return 'а';
    if (n1 === 1) return '';
    return 'ей';
  }

  // Денежный формат по-русски: «10 000,00 ₽» (пробел-разделитель тысяч, запятая).
  function rub(n) {
    var v = round2(num(n) || 0);
    var neg = v < 0;
    var s = Math.abs(v).toFixed(2);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' '); // неразрывный пробел
    return (neg ? '−' : '') + parts[0] + ',' + parts[1] + ' ₽';
  }

  // ── formatPlan(rows) → текстовая сводка по-русски ───────────────────────────
  // На пустом/мусорном входе → '—' (НЕ бросает).
  function formatPlan(rows) {
    if (!Array.isArray(rows) || !rows.length) return '—';
    var lines = [];
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var n = (r.n == null) ? (i + 1) : r.n;
      var date = (r.date == null) ? '—' : String(r.date);
      var amt = num(r.amount) || 0;
      total += amt;
      lines.push('Платёж ' + n + ' · ' + date + ' · ' + rub(amt));
    }
    lines.push('Итого: ' + rub(round2(total)) + ' (' + rows.length + ' платеж' + plural(rows.length) + ')');
    return lines.join('\n');
  }

  // ── экспорт в глобальный реестр ─────────────────────────────────────────────
  global.SensorPayments = {
    DEFAULT_PERIOD: DEFAULT_PERIOD,
    PERIODS: PERIODS,
    schedule: schedule,
    split: split,
    formatPlan: formatPlan,
    // внутренние помощники открыты для повторного использования/тестов
    _round2: round2,
    _shift: shift,
    _rub: rub,
  };
})(typeof window !== 'undefined' ? window : this);

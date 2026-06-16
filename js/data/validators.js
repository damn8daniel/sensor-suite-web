/* ===========================================================================
   js/data/validators.js — Библиотека валидаторов российских реквизитов.

   Автономный модуль window.SensorValidators. Классический <script>, БЕЗ
   import/export — подключается обычным тегом после store.js и до app.js.

   Все функции:
     • чистые и детерминированные (один и тот же вход → один и тот же выход);
     • НЕ трогают DOM, не зависят от window.SensorUI/SensorStore;
     • НЕ бросают исключений на пустом/мусорном входе (null/undefined/число/строка);
     • возвращают { ok:boolean, msg:string } — где msg по-русски поясняет результат.

   Эталоны контрольных сумм перенесены из js/modules/documents.js (innChecksum)
   и js/modules/licensing.js (ogrnChecksum). Эти модули НЕ изменяются — их
   интеграция с общей библиотекой запланирована на поздние волны.
   =========================================================================== */
(function (global) {
  'use strict';

  // --- утилиты ---------------------------------------------------------------

  // Безопасно привести любой вход к строке без хвостовых/ведущих пробелов.
  function str(v) {
    return v == null ? '' : String(v).trim();
  }

  // Массив цифр строки (предполагается, что строка уже проверена на /^\d+$/).
  function digits(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) - 48);
    return out;
  }

  // Взвешенная сумма по модулю 11, затем по модулю 10 (схема ИНН).
  function weighted(d, weights) {
    var sum = 0;
    for (var i = 0; i < weights.length; i++) sum += weights[i] * d[i];
    return (sum % 11) % 10;
  }

  function ok(msg) { return { ok: true, msg: msg }; }
  function err(msg) { return { ok: false, msg: msg }; }

  // --- ИНН -------------------------------------------------------------------
  // 10 цифр (юрлицо) или 12 цифр (ИП/физлицо), с контрольными разрядами.
  // Алгоритм — эталон из documents.js / licensing.js (innChecksum).
  function innChecksum(s) {
    var d = digits(s);
    if (s.length === 10) {
      return weighted(d, [2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
    }
    if (s.length === 12) {
      var n11 = weighted(d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
      var n12 = weighted(d, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
      return n11 === d[10] && n12 === d[11];
    }
    return false;
  }

  function inn(v) {
    var s = str(v);
    if (!s) return err('ИНН: пусто');
    if (!/^\d+$/.test(s)) return err('ИНН: только цифры');
    if (s.length !== 10 && s.length !== 12) {
      return err('ИНН: 10 цифр (юрлицо) или 12 (ИП), введено ' + s.length);
    }
    if (!innChecksum(s)) return err('ИНН: неверная контрольная сумма');
    return ok('ИНН корректен');
  }

  // --- ОГРН ------------------------------------------------------------------
  // 13 цифр. Контрольный разряд = (число из первых 12 цифр) mod 11, затем mod 10.
  // Эталон из licensing.js (ogrnChecksum, ветка 13).
  function ogrn(v) {
    var s = str(v);
    if (!s) return err('ОГРН: пусто');
    if (!/^\d+$/.test(s)) return err('ОГРН: только цифры');
    if (s.length !== 13) return err('ОГРН: 13 цифр, введено ' + s.length);
    var d = digits(s);
    // первые 12 цифр как число, по модулю 11, затем по модулю 10
    var head = Number(s.slice(0, 12));
    var ctrl = (head % 11) % 10;
    if (ctrl !== d[12]) return err('ОГРН: контрольный разряд не совпал');
    return ok('ОГРН корректен');
  }

  // --- ОГРНИП ----------------------------------------------------------------
  // 15 цифр. Контрольный разряд = (число из первых 14 цифр) mod 13, затем mod 10.
  // Эталон из licensing.js (ogrnChecksum, ветка 15). 14-значное число превышает
  // безопасный диапазон Number — считаем модуль по цифрам (метод Горнера).
  function modByDigits(s, m) {
    var r = 0;
    for (var i = 0; i < s.length; i++) {
      r = (r * 10 + (s.charCodeAt(i) - 48)) % m;
    }
    return r;
  }

  function ogrnip(v) {
    var s = str(v);
    if (!s) return err('ОГРНИП: пусто');
    if (!/^\d+$/.test(s)) return err('ОГРНИП: только цифры');
    if (s.length !== 15) return err('ОГРНИП: 15 цифр, введено ' + s.length);
    var d = digits(s);
    var ctrl = modByDigits(s.slice(0, 14), 13) % 10;
    if (ctrl !== d[14]) return err('ОГРНИП: контрольный разряд не совпал');
    return ok('ОГРНИП корректен');
  }

  // --- КПП -------------------------------------------------------------------
  // Формат NNNNPPNNN: 4 цифры (код налогового органа) + 2 знака причины
  // постановки (цифры или заглавные латинские A-Z) + 3 цифры. Только формат —
  // контрольной суммы у КПП нет.
  function kpp(v) {
    var s = str(v);
    if (!s) return err('КПП: пусто');
    if (!/^\d{4}[\dA-Z]{2}\d{3}$/.test(s)) {
      return err('КПП: формат NNNNPPNNN (9 знаков)');
    }
    return ok('КПП корректен');
  }

  // --- СНИЛС -----------------------------------------------------------------
  // Формат «XXX-XXX-XXX YY» (или сплошные 11 цифр). Контрольная сумма по первым
  // 9 цифрам с весами 9..1; правила: сумма<=100 → контроль = сумма%101 (т.е.
  // <100 как есть, ==100 → 00); ==101 → 00; иначе сумма%101 c повтором правил.
  function snilsChecksum(d9) {
    var sum = 0;
    for (var i = 0; i < 9; i++) sum += d9[i] * (9 - i); // веса 9,8,...,1
    if (sum < 100) return sum;
    if (sum === 100 || sum === 101) return 0;
    var mod = sum % 101;
    return (mod === 100) ? 0 : mod;
  }

  function snils(v) {
    var s = str(v);
    if (!s) return err('СНИЛС: пусто');
    // допускаем как форматированный «XXX-XXX-XXX YY», так и 11 сплошных цифр
    if (!/^\d{3}-\d{3}-\d{3}[ -]\d{2}$/.test(s) && !/^\d{11}$/.test(s)) {
      return err('СНИЛС: формат XXX-XXX-XXX YY (11 цифр)');
    }
    var dig = s.replace(/\D/g, '');
    if (dig.length !== 11) return err('СНИЛС: нужно 11 цифр');
    var d = digits(dig);
    var control = d[9] * 10 + d[10]; // двузначное контрольное число
    var expect = snilsChecksum(d.slice(0, 9));
    if (control !== expect) return err('СНИЛС: неверная контрольная сумма');
    return ok('СНИЛС корректен');
  }

  // --- ОКВЭД -----------------------------------------------------------------
  // Формат NN.NN или NN.NN.NN (классы/подклассы ОКВЭД2). Допускаем также NN и
  // NN.N как валидные «сокращённые» коды раздела/группы. Никакой семантики
  // (что именно за вид деятельности) НЕ выдумываем — только структура кода.
  function okved(v) {
    var s = str(v);
    if (!s) return err('ОКВЭД: пусто');
    if (!/^\d{2}(\.\d{1,2}){0,2}$/.test(s)) {
      return err('ОКВЭД: формат NN.NN или NN.NN.NN');
    }
    return ok('ОКВЭД корректен');
  }

  // --- экспорт в глобальный реестр ------------------------------------------
  var API = {
    inn: inn,
    ogrn: ogrn,
    ogrnip: ogrnip,
    kpp: kpp,
    snils: snils,
    okved: okved,
    // внутренние помощники открыты для повторного использования модулями
    _innChecksum: innChecksum,
  };

  global.SensorValidators = API;
})(typeof window !== 'undefined' ? window : this);

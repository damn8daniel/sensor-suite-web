/* ===========================================================================
   js/data/format-ru.js — Слой нормализации/форматирования РФ-реквизитов:
   телефоны, ФИО, адреса.

   Автономный модуль window.SensorFormatRu. Классический <script>, БЕЗ
   import/export — подключается обычным тегом после store.js и до app.js
   (рядом с validators.js, паттерн один в один).

   Все функции:
     • чистые и детерминированные (один и тот же вход → один и тот же выход);
     • НЕ трогают DOM, не зависят от window.SensorUI/SensorStore;
     • НЕ бросают исключений на пустом/мусорном входе (null/undefined/число/
       строка/объект/массив);
     • возвращают { ok:boolean, msg:string, ... } — где msg по-русски поясняет
       результат, а доп. поле (formatted / digits) несёт нормализованное
       значение. На невалидном входе formatted = исходно-приведённая строка
       (без выдумывания недостающих данных).

   Ничего не персистим и не логируем — это чистый слой данных. Любой вывод в
   DOM экранируется уже на стороне модулей через ctx.ui.escape.
   =========================================================================== */
(function (global) {
  'use strict';

  // --- утилиты ---------------------------------------------------------------

  // Безопасно привести любой вход к строке без хвостовых/ведущих пробелов.
  function str(v) {
    return v == null ? '' : String(v).trim();
  }

  // Оставить только цифры (нецифры отбрасываются).
  function onlyDigits(v) {
    return (v == null ? '' : String(v)).replace(/\D+/g, '');
  }

  function ok(msg, extra) {
    var r = { ok: true, msg: msg };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
    return r;
  }
  function err(msg, extra) {
    var r = { ok: false, msg: msg };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k];
    return r;
  }

  // --- ТЕЛЕФОН ---------------------------------------------------------------
  // Нормализация РФ-номера к виду «+7 (XXX) XXX-XX-XX».
  //   • отбрасываем все нецифры;
  //   • ведущая 8 → 7 (8XXXXXXXXXX → 7XXXXXXXXXX);
  //   • 10 цифр без кода страны → дополняем ведущей 7;
  //   • валидность: ровно 11 цифр, код страны 7, код оператора/региона
  //     (первая цифра после 7) в диапазоне 3..9 (РФ-коды: 3xx, 4xx, 8xx, 9xx —
  //     первая цифра не 0/1/2).
  // На невалидном входе formatted = сырые цифры (что распознали), ok:false.
  function normalizePhoneDigits(v) {
    var d = onlyDigits(v);
    if (!d) return '';
    // 8XXXXXXXXXX → 7XXXXXXXXXX
    if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
    // 10 цифр (национальный номер без кода страны) → подставляем 7
    else if (d.length === 10) d = '7' + d;
    return d;
  }

  function phone(v) {
    var s = str(v);
    if (!s) return err('Телефон: пусто', { formatted: '' });
    var d = normalizePhoneDigits(s);
    if (!d) return err('Телефон: нет цифр', { formatted: s });
    if (d.length !== 11) {
      return err('Телефон: ожидается 11 цифр, получено ' + d.length, { formatted: d });
    }
    if (d.charAt(0) !== '7') {
      return err('Телефон: код страны должен быть +7', { formatted: d });
    }
    var area0 = d.charAt(1);
    if (area0 === '0' || area0 === '1' || area0 === '2') {
      return err('Телефон: недопустимый код (после +7 ожидается 3–9)', { formatted: d });
    }
    var formatted = '+7 (' + d.slice(1, 4) + ') ' + d.slice(4, 7) +
      '-' + d.slice(7, 9) + '-' + d.slice(9, 11);
    return ok('Телефон корректен', { formatted: formatted, digits: d });
  }

  // Маска ввода: вернуть строку цифр (для пошаговой подсветки/маски в поле
  // ввода). Не валидирует — только нормализует «сырьё»: отбрасывает нецифры,
  // схлопывает ведущую 8→7, ограничивает 11 цифрами. Детерминирована, удобна
  // как oninput-помощник. Возвращает {ok, msg, digits, formatted}, где
  // formatted — частичная маска по уже введённым цифрам.
  function inputDigits(v) {
    var raw = onlyDigits(v);
    if (!raw) return ok('Пусто', { digits: '', formatted: '' });
    var d = raw;
    if (d.charAt(0) === '8') d = '7' + d.slice(1);
    else if (d.charAt(0) !== '7') d = '7' + d; // считаем введённое национальным номером
    if (d.length > 11) d = d.slice(0, 11);
    // частичная маска по уже набранным цифрам
    var body = d.slice(1); // до 10 цифр после кода страны
    var out = '+7';
    if (body.length) out += ' (' + body.slice(0, 3);
    if (body.length >= 3) out += ')';
    if (body.length > 3) out += ' ' + body.slice(3, 6);
    if (body.length > 6) out += '-' + body.slice(6, 8);
    if (body.length > 8) out += '-' + body.slice(8, 10);
    return ok('Маска ввода', { digits: d, formatted: out });
  }

  // --- ФИО -------------------------------------------------------------------
  // Тримминг, схлопывание пробелов, Капитализация Каждого Слова, корректная
  // обработка дефисных частей (Анна-Мария, Сухово-Кобылин). НЕ выдумываем
  // недостающие части (если введена одна «Иванов» — так и оставляем).
  // Регистр: первая буква каждого слова/дефисной части — заглавная, остальные
  // строчные. Возвращает {ok, msg, formatted}.
  function capWord(w) {
    if (!w) return w;
    // разбиваем по дефисам, капитализируем каждую часть, склеиваем обратно
    return w.split('-').map(function (part) {
      if (!part) return part;
      return part.charAt(0).toLocaleUpperCase('ru-RU') +
        part.slice(1).toLocaleLowerCase('ru-RU');
    }).join('-');
  }

  function fio(v) {
    var s = str(v);
    if (!s) return err('ФИО: пусто', { formatted: '' });
    // схлопываем любые пробельные последовательности до одного пробела
    var parts = s.replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!parts.length) return err('ФИО: пусто', { formatted: '' });
    var formatted = parts.map(capWord).join(' ');
    // мягкая валидность: формат норм, если хотя бы одно слово состоит из букв
    // (кириллица/латиница) и дефисов; цифры в ФИО недопустимы.
    var looksName = parts.every(function (w) {
      return /^[A-Za-zА-Яа-яЁё]+(-[A-Za-zА-Яа-яЁё]+)*$/.test(w);
    });
    if (!looksName) {
      return err('ФИО: допустимы только буквы и дефис', { formatted: formatted });
    }
    return ok('ФИО нормализовано', { formatted: formatted, parts: parts.length });
  }

  // --- АДРЕС -----------------------------------------------------------------
  // Нормализация пробелов и запятых; если найден 6-значный почтовый индекс —
  // выносим его в начало строки (как принято в РФ-адресации). НЕ дополняем
  // недостающие части адреса. Возвращает {ok, msg, formatted, index}.
  function address(v) {
    var s = str(v);
    if (!s) return err('Адрес: пусто', { formatted: '', index: '' });
    // 1) схлопнуть пробелы
    var t = s.replace(/\s+/g, ' ').trim();
    // 2) нормализовать запятые: «a ,b», «a,b», «a , b» → «a, b»; без дублей «,,»
    t = t.replace(/\s*,\s*/g, ', ').replace(/(,\s*){2,}/g, ', ');
    // обрезать ведущие/хвостовые запятые
    t = t.replace(/^(?:,\s*)+/, '').replace(/(?:,\s*)+$/, '').trim();
    // 3) найти 6-значный индекс (отдельным «словом», не часть более длинного числа)
    var idx = '';
    var m = t.match(/(?:^|[\s,])(\d{6})(?=$|[\s,])/);
    if (m) {
      idx = m[1];
      // вырезать первое вхождение индекса из строки
      var pos = t.indexOf(idx);
      var rest = (t.slice(0, pos) + t.slice(pos + idx.length));
      // подчистить осиротевшие запятые/пробелы после выреза
      rest = rest.replace(/\s+/g, ' ')
                 .replace(/\s*,\s*/g, ', ')
                 .replace(/^(?:,\s*)+/, '')
                 .replace(/(?:,\s*)+$/, '')
                 .replace(/(,\s*){2,}/g, ', ')
                 .trim();
      t = rest ? (idx + ', ' + rest) : idx;
    }
    return ok('Адрес нормализован', { formatted: t, index: idx });
  }

  // --- экспорт в глобальный реестр ------------------------------------------
  var API = {
    phone: phone,
    inputDigits: inputDigits,
    fio: fio,
    address: address,
    // внутренние помощники открыты для повторного использования
    _normalizePhoneDigits: normalizePhoneDigits,
  };

  global.SensorFormatRu = API;
})(typeof window !== 'undefined' ? window : this);

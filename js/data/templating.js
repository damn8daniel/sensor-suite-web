/* ===========================================================================
   js/data/templating.js — Идея #4. Движок подстановки/типографики шаблонов
   текста (window.SensorTemplating).

   Чистый рендер строковых шаблонов с плейсхолдерами {TOKEN}: подстановка
   значений по ключам, обнаружение полей, поиск незаполненных, плюс русская
   типографика (кавычки-«ёлочки», тире, неразрывные пробелы после коротких
   предлогов/союзов, опциональная «ё»).

   Vanilla SPA: классический <script>, БЕЗ import/export/ES-модулей; публичный
   API кладётся в window.SensorTemplating. Подключается обычным тегом в блоке
   js/data/* (рядом с format-ru.js).

   Все функции:
     • чистые и детерминированные (один вход → один выход);
     • НЕ трогают DOM, не зависят от window.SensorUI;
     • от SensorStore зависят ТОЛЬКО опционально (через if (global.SensorStore))
       и НИКОГДА не бросают, если стора нет (паттерн как в numbering.js/
       validators.js);
     • НЕ бросают исключений на пустом/мусорном входе (null/undefined/число/
       объект/массив);
     • работают только с текстом — никаких HTML-инъекций (экранирование вывода
       в DOM — забота вызывающих модулей через ctx.ui.escape).

   Плейсхолдер: {TOKEN}, где TOKEN — любые символы кроме { } < > (как в
   detectFields из wysiwyg.js), с обрезкой пробелов внутри скобок. Совпадение по
   нормализованному (trim) имени токена.

   API window.SensorTemplating:
     render(tmpl, data, opts?) -> строка
       Подстановка значений data[token] вместо {token}. Отсутствующие токены по
       умолчанию сохраняются как есть («{TOKEN}»); при opts.mark === true —
       помечаются обёрткой opts.markWith (по умолч. «[[…]]»), при opts.blank ===
       true — заменяются пустой строкой.
     fields(tmpl) -> [string]  — массив УНИКАЛЬНЫХ найденных токенов в порядке
       первого появления (как detectFields, но чистый и без DOM/подсчёта).
     missing(tmpl, data) -> [string]  — токены без значения в data (нет ключа
       либо значение null/undefined/пустая строка), уникальные, по порядку.
     typografRu(s, opts?) -> строка  — русская типографика, детерминированно и
       идемпотентно:
         • парные кавычки "…" → «…» (ёлочки), вложенные — без удвоения;
         • дефис/двойной дефис между пробелами → тире «—»;
         • неразрывный пробел (U+00A0) после коротких предлогов/союзов (в, и, к,
           с, о, у, я, а, до, по, на, за, из, от, об, то, не, ни, же, бы, ли…);
         • опц. opts.yo === true — НЕ трогает «ё» (по умолчанию тоже не трогаем;
           поле зарезервировано — мы НЕ заменяем е→ё, чтобы не угадывать).
       Мусор/null/undefined → '' без throw.
   =========================================================================== */
(function (global) {
  'use strict';

  // U+00A0 — неразрывный пробел. Держим как константу для читаемости.
  var NBSP = ' ';

  // --- утилиты --------------------------------------------------------------

  // Безопасно привести любой вход к строке (без trim — пробелы значимы для
  // типографики и для литералов шаблона).
  function asStr(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    // объекты/массивы не превращаем в "[object Object]"/"a,b" — это мусор,
    // считаем пустой строкой; примитивы (число/булево) приводим штатно.
    var t = typeof v;
    if (t === 'number' || t === 'boolean') return String(v);
    return '';
  }

  // Регэксп плейсхолдера: { + (что угодно кроме {}<>) + }. Совпадает с
  // detectFields() в wysiwyg.js, чтобы наборы полей были согласованы.
  var TOKEN_RE = /\{([^{}<>]+)\}/g;

  // --- fields(tmpl) ---------------------------------------------------------
  // Уникальные токены в порядке первого появления. Пустые (одни пробелы) токены
  // игнорируются.
  function fields(tmpl) {
    var s = asStr(tmpl);
    if (!s) return [];
    var seen = Object.create(null);
    var order = [];
    var m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(s)) !== null) {
      var tok = m[1].trim();
      if (!tok) continue;
      if (seen[tok] == null) { seen[tok] = true; order.push(tok); }
    }
    return order;
  }

  // Достать значение из data по имени токена (с учётом trim самого имени).
  // Возвращает undefined, если ключа нет; иначе — сырое значение.
  function lookup(data, token) {
    if (data == null || typeof data !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(data, token)) return data[token];
    return undefined;
  }

  // Считаем значение «заполненным», если оно не null/undefined и не пустая
  // (после trim) строка. Число 0 и false — это заполненные значения.
  function isFilled(v) {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    return true;
  }

  // --- render(tmpl, data, opts) ---------------------------------------------
  function render(tmpl, data, opts) {
    var s = asStr(tmpl);
    if (!s) return '';
    opts = opts || {};
    var mark = opts.mark === true;
    var blank = opts.blank === true;
    var markWith = (typeof opts.markWith === 'string' && opts.markWith) ? opts.markWith : '[[…]]';
    return s.replace(TOKEN_RE, function (whole, rawTok) {
      var token = rawTok.trim();
      if (!token) return whole; // «{}» / «{   }» — не плейсхолдер, оставляем как есть
      var v = lookup(data, token);
      if (isFilled(v)) {
        return asStr(v);
      }
      // Незаполненный токен.
      if (blank) return '';
      if (mark) {
        // помечаем: оборачиваем исходный «{TOKEN}» в markWith (вокруг, не внутрь)
        return markWith.replace('…', whole);
      }
      return whole; // по умолчанию — сохраняем «{TOKEN}» как есть
    });
  }

  // --- missing(tmpl, data) --------------------------------------------------
  // Токены без заполненного значения. Уникальные, по порядку появления.
  function missing(tmpl, data) {
    var toks = fields(tmpl);
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var v = lookup(data, toks[i]);
      if (!isFilled(v)) out.push(toks[i]);
    }
    return out;
  }

  // --- typografRu(s, opts) --------------------------------------------------
  // Короткие слова, после которых ставим неразрывный пробел (предлоги/союзы/
  // частицы). Один-два знака — типичная типографская практика РФ. Учитываем
  // регистр (В/в, И/и) через флаг 'i', но саму букву не меняем.
  var SHORT_WORDS = [
    'в', 'и', 'к', 'с', 'о', 'у', 'я', 'а',
    'до', 'по', 'на', 'за', 'из', 'от', 'об', 'то',
    'не', 'ни', 'же', 'бы', 'ли', 'во', 'со', 'ко', 'из-за', 'из-под'
  ];
  // Собираем чередование, длинные раньше коротких (из-за/из-под перед из).
  var SHORT_WORDS_SORTED = SHORT_WORDS.slice().sort(function (a, b) { return b.length - a.length; });
  var SHORT_ALT = SHORT_WORDS_SORTED.map(function (w) {
    return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|');
  // (^|пробел/нбсп/начало) (предлог) (один обычный пробел) (буква/цифра/кавычка)
  // Группа перед словом — граница: начало строки или пробельный символ. После
  // слова — ровно обычный пробел, который и заменяем на NBSP. Чтобы не цеплять
  // часть длинного слова («вот»), требуем перед словом не-букву.
  var SHORT_RE = new RegExp(
    '(^|[\\s' + NBSP + '(«"„\'\\-—])(' + SHORT_ALT + ') ',
    'gi'
  );

  function typografRu(s, opts) {
    var t = asStr(s);
    if (!t) return '';
    opts = opts || {};

    // 1) Кавычки-«ёлочки». Парные ASCII-кавычки "…" → «…». Жадности избегаем:
    //    открывающая — после начала/пробела/скобки/тире; закрывающая — перед
    //    концом/пробелом/знаком препинания. Делаем проходом по пьедесталу
    //    "открыта/закрыта", чтобы быть идемпотентными (уже «ёлочки» не трогаем).
    t = replaceQuotes(t);

    // 2) Тире. « - » или « -- » или « --- » (с пробелами вокруг) → « — »
    //    Также двойной/тройной дефис «--»/«---» внутри слов-связок → «—».
    //    Идемпотентно: уже стоящее « — » не дублируем.
    t = t.replace(/ (-{1,3}) (?=\S)/g, ' — ');           // « - » → « — »
    t = t.replace(/(^|[\s])(-{2,3})(?=[\s])/g, '$1—');   // «--» одиночное → «—»

    // 3) Неразрывные пробелы после коротких предлогов/союзов.
    //    Повторяем замену, т.к. соседние предлоги («и в дом») перекрывают
    //    регэксп-окна — двух проходов достаточно для типичных цепочек.
    t = applyNbsp(t);
    t = applyNbsp(t);

    return t;
  }

  // Замена парных ASCII-кавычек на ёлочки. Идемпотентно (ёлочки пропускаются).
  function replaceQuotes(t) {
    var out = '';
    var open = false; // ждём закрывающую?
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (ch === '"') {
        if (!open) {
          out += '«'; // «
          open = true;
        } else {
          out += '»'; // »
          open = false;
        }
      } else {
        out += ch;
      }
    }
    // Непарная кавычка осталась открытой — закрываем как открывающую (мы её уже
    // вывели как «); строку не ломаем. Это допустимый детерминированный исход.
    return out;
  }

  // Применить неразрывный пробел после коротких слов (один проход).
  function applyNbsp(t) {
    return t.replace(SHORT_RE, function (whole, pre, word) {
      return pre + word + NBSP;
    });
  }

  // --- экспорт в глобальный реестр ------------------------------------------
  var API = {
    NBSP: NBSP,
    SHORT_WORDS: SHORT_WORDS.slice(),
    render: render,
    fields: fields,
    missing: missing,
    typografRu: typografRu
  };

  global.SensorTemplating = API;
})(typeof window !== 'undefined' ? window : this);

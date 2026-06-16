/* ===========================================================================
   js/data/search.js — Лексический поиск/ранжирование по банку знаний.
   Идея #8 «SensorSearch».

   Автономный модуль window.SensorSearch. Классический <script>, БЕЗ
   import/export — подключается обычным тегом в блок js/data/* в index.html.

   Назначение: чистый лексический (термин-оверлап) движок ранжирования —
   фолбэк для RAG без эмбеддингов и фаззи-подсветки для будущих модулей.
   НЕ зависит от js/data/rag-index.js (это переиспользуемый низкоуровневый
   движок, а rag-index — отдельный банк данных).

   Все функции:
     • чистые и детерминированные (один и тот же вход → один и тот же выход);
     • НЕ трогают DOM, не зависят от window.SensorUI/SensorStore;
     • НЕ бросают исключений на пустом/мусорном входе (null/undefined/число/
       объект/массив) — деградируют в пустой результат / нормализованное
       значение;
     • тексты по-русски; кириллица и латиница равноправны.

   API window.SensorSearch:
     tokenize(s) -> string[]
        Нормализованные токены: нижний регистр, только буквы (кириллица/
        латиница) и цифры, пунктуация отброшена, стоп-слова отброшены.
        Мусор/пусто → [].
     score(query, text) -> number
        Детерминированная релевантность text относительно query:
        термин-оверлап (доля совпавших токенов запроса) + бонусы за точную
        фразу и за совпадение начала слова (префикс). 0 если нет пересечений
        или вход мусорный. Чем больше — тем релевантнее.
     search(query, docs, opts?) -> [{doc, score}]
        Отсортированный по убыванию score список. opts:
          { limit?:number, threshold?:number, getText?:fn(doc)->string }
        По умолчанию threshold > 0 (нерелевантное отсекается), limit без
        ограничения. Пустой query / не-массив docs → [].
     highlight(text, query) -> string
        Текст с маркерами вокруг совпавших токенов: «‹…›» (НЕ HTML —
        безопасно для любого вывода). Не падает на спецсимволах. Мусор → ''.
   =========================================================================== */
(function (global) {
  'use strict';

  // --- настройки/константы ---------------------------------------------------

  // Маркеры подсветки — НЕ HTML-теги, безопасны при любой вставке в текст.
  var MARK_OPEN = '‹';  // ‹
  var MARK_CLOSE = '›'; // ›

  // Вес бонусов в score() (детерминированные, без случайности).
  var PHRASE_BONUS = 0.5;  // запрос целиком встречается как подстрока в тексте
  var PREFIX_BONUS = 0.2;  // токен текста начинается с токена запроса (не точное)

  // Стоп-слова (рус + базовая латиница). Отбрасываются при токенизации, чтобы
  // частые служебные слова не раздували оверлап. Список намеренно компактный —
  // только заведомо несодержательные слова.
  var STOP_WORDS = (function () {
    var arr = [
      // русские предлоги/союзы/частицы/местоимения
      'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а',
      'то', 'все', 'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же',
      'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от',
      'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда', 'даже',
      'ну', 'вдруг', 'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него',
      'до', 'вас', 'нибудь', 'опять', 'уж', 'вам', 'ведь', 'там', 'потом',
      'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть', 'надо',
      'ней', 'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без',
      'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'ж', 'кто',
      'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь',
      'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'были', 'куда',
      'эту', 'ли', 'тогда', 'кому', 'это', 'эта', 'эти', 'при', 'об', 'про',
      // базовая латиница
      'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is',
      'are', 'was', 'were', 'be', 'by', 'at', 'as', 'it', 'this', 'that',
      'with', 'from', 'but', 'not', 'no'
    ];
    var set = {};
    for (var i = 0; i < arr.length; i++) set[arr[i]] = true;
    return set;
  })();

  // --- утилиты ---------------------------------------------------------------

  function asString(v) {
    return (typeof v === 'string') ? v : '';
  }

  // Разбиение на «слова»: всё, что НЕ буква (кириллица/латиница) и НЕ цифра —
  // разделитель. Ё/ё нормализуем к е, чтобы е/ё не расходились.
  // Юникод-классы недоступны в старом окружении — перечисляем диапазоны явно.
  var SPLIT_RE = /[^0-9a-zA-Zа-яёА-ЯЁ]+/;

  // tokenize(s) -> string[]
  function tokenize(s) {
    var str = asString(s);
    if (!str) return [];
    var lowered = str.toLowerCase().replace(/ё/g, 'е');
    var raw = lowered.split(SPLIT_RE);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var tk = raw[i];
      if (!tk) continue;                 // пустые куски от ведущих/двойных разделителей
      if (STOP_WORDS[tk]) continue;      // стоп-слова отбрасываем
      out.push(tk);
    }
    return out;
  }

  // Множество (как объект) уникальных токенов.
  function tokenSet(tokens) {
    var set = {};
    for (var i = 0; i < tokens.length; i++) set[tokens[i]] = true;
    return set;
  }

  // --- score(query, text) -> number ------------------------------------------
  // Детерминированная релевантность. Складывается из:
  //   • base   — доля уникальных токенов запроса, нашедших соответствие в
  //              тексте (точное ИЛИ префиксное совпадение слова), 0..1;
  //   • точные совпадения дают полный вес, префиксные — частичный (PREFIX_BONUS);
  //   • PHRASE_BONUS — если нормализованный запрос целиком встречается
  //              подстрокой в нормализованном тексте.
  // Точное совпадение всегда строго больше частичного, оба строго > 0.
  function score(query, text) {
    var qTokens = tokenize(query);
    var tTokens = tokenize(text);
    if (qTokens.length === 0 || tTokens.length === 0) return 0;

    var qUnique = tokenSet(qTokens);
    var tSet = tokenSet(tTokens);

    // Для префиксного сопоставления держим список уникальных токенов текста.
    var tList = [];
    for (var k in tSet) { if (tSet.hasOwnProperty(k)) tList.push(k); }

    var qKeys = [];
    for (var q in qUnique) { if (qUnique.hasOwnProperty(q)) qKeys.push(q); }
    if (qKeys.length === 0) return 0;

    var matched = 0; // сумма «качества» совпадений по токенам запроса
    for (var i = 0; i < qKeys.length; i++) {
      var qt = qKeys[i];
      if (tSet[qt]) {
        matched += 1;            // точное совпадение токена — полный вес
        continue;
      }
      // префиксное совпадение: какой-то токен текста начинается с токена
      // запроса (минимум 2 символа, чтобы не цеплять всё подряд)
      if (qt.length >= 2) {
        var hit = false;
        for (var j = 0; j < tList.length; j++) {
          if (tList[j].indexOf(qt) === 0) { hit = true; break; }
        }
        if (hit) matched += PREFIX_BONUS; // частичное совпадение — частичный вес
      }
    }

    var base = matched / qKeys.length; // 0..1
    if (base === 0) return 0;

    // Бонус за точное вхождение фразы запроса (по нормализованным токенам,
    // склеенным пробелом) в нормализованный текст.
    var phraseBonus = 0;
    if (qTokens.length >= 1) {
      var qPhrase = qTokens.join(' ');
      var tPhrase = tTokens.join(' ');
      if (qPhrase && tPhrase.indexOf(qPhrase) >= 0) phraseBonus = PHRASE_BONUS;
    }

    return base + phraseBonus;
  }

  // --- search(query, docs, opts?) -> [{doc, score}] --------------------------
  // Извлечение текста из документа: по умолчанию — сам doc (если строка) либо
  // частые поля (text/title/body/content/name). Можно переопределить
  // opts.getText.
  function defaultGetText(doc) {
    if (typeof doc === 'string') return doc;
    if (doc && typeof doc === 'object') {
      var parts = [];
      var fields = ['title', 'name', 'text', 'body', 'content'];
      for (var i = 0; i < fields.length; i++) {
        var v = doc[fields[i]];
        if (typeof v === 'string' && v) parts.push(v);
      }
      if (parts.length) return parts.join(' ');
    }
    return '';
  }

  function search(query, docs, opts) {
    if (!Array.isArray(docs) || docs.length === 0) return [];
    var qTokens = tokenize(query);
    if (qTokens.length === 0) return []; // пустой/мусорный запрос → пусто

    opts = (opts && typeof opts === 'object') ? opts : {};
    var getText = (typeof opts.getText === 'function') ? opts.getText : defaultGetText;
    var threshold = (typeof opts.threshold === 'number' && isFinite(opts.threshold))
      ? opts.threshold : 0; // строго больше порога; по умолчанию отсекаем 0
    var limit = (typeof opts.limit === 'number' && isFinite(opts.limit) && opts.limit >= 0)
      ? Math.floor(opts.limit) : null;

    var scored = [];
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var text = '';
      try { text = asString(getText(doc)); } catch (e) { text = ''; }
      var s = score(query, text);
      if (s > threshold) {
        scored.push({ doc: doc, score: s, _i: i });
      }
    }

    // Сортировка по убыванию score; при равенстве — стабильно по исходному
    // индексу (детерминированно, не зависит от движка сортировки).
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a._i - b._i;
    });

    var out = [];
    for (var j = 0; j < scored.length; j++) {
      if (limit != null && out.length >= limit) break;
      out.push({ doc: scored[j].doc, score: scored[j].score });
    }
    return out;
  }

  // --- highlight(text, query) -> string --------------------------------------
  // Оборачивает совпавшие фрагменты текста маркерами ‹…›. Совпадение —
  // вхождение токена запроса как начала слова в тексте (или точного слова).
  // Работаем по исходному тексту посимвольно, не теряя регистр/пунктуацию.
  // Безопасно для спецсимволов: токены экранируются перед сборкой regex.
  function escRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlight(text, query) {
    var str = asString(text);
    if (!str) return '';
    var qTokens = tokenize(query);
    if (qTokens.length === 0) return str; // нечего подсвечивать — текст как есть

    // Уникальные токены запроса длиной >= 2 (по убыванию длины, чтобы более
    // длинные совпадения имели приоритет при сборке альтернатив).
    var seen = {};
    var terms = [];
    for (var i = 0; i < qTokens.length; i++) {
      var t = qTokens[i];
      if (t.length < 2) continue;
      if (seen[t]) continue;
      seen[t] = true;
      terms.push(t);
    }
    if (terms.length === 0) return str;
    terms.sort(function (a, b) { return b.length - a.length; });

    var alts = [];
    for (var k = 0; k < terms.length; k++) alts.push(escRe(terms[k]));

    // Граница слова через класс «не-буква/не-цифра» (Unicode \b ненадёжен для
    // кириллицы). Совпадение начинается на границе слова, далее идёт токен и
    // продолжение слова до конца (буквы/цифры). Так подсвечивается всё слово,
    // начинающееся с термина запроса (префиксное совпадение).
    var re;
    try {
      // (^|нес-словарный)  (термин)(хвост слова)
      re = new RegExp(
        '(^|[^0-9a-zA-Zа-яёА-ЯЁ])((?:' + alts.join('|') + ')[0-9a-zA-Zа-яёА-ЯЁ]*)',
        'gi'
      );
    } catch (e) {
      return str; // на всякий случай — не падаем, отдаём исходный текст
    }

    return str.replace(re, function (whole, pre, word) {
      return pre + MARK_OPEN + word + MARK_CLOSE;
    });
  }

  // --- экспорт ---------------------------------------------------------------
  var API = {
    tokenize: tokenize,
    score: score,
    search: search,
    highlight: highlight,
    // открыто для повторного использования/тестов:
    STOP_WORDS: STOP_WORDS,
    MARK_OPEN: MARK_OPEN,
    MARK_CLOSE: MARK_CLOSE
  };

  global.SensorSearch = API;
})(typeof window !== 'undefined' ? window : this);

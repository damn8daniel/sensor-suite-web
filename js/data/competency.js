/* ===== Матрица компетенций специалистов под лицензии (SensorCompetency) =====
 * Идея #7. Чистый АГРЕГАТНЫЙ расчёт разрыва (gap) компетенций команды
 * специалистов относительно требований конкретной цели (МЧС / НОК / НРС / АТТПР).
 *
 * Это слой НАД набором команды: он не выносит вердикт по одному специалисту
 * (это делает справочник правил js/data/spec-rules.js и модуль «Продажи»),
 * а считает, какие требуемые ПОЗИЦИИ (роли/квалификации) команда в целом
 * закрывает, а какие — нет. Требования здесь — компактные КОНСТАНТЫ, опорные
 * для агрегата; детальные пороги (стаж, часы переподготовки и т.п.) живут в
 * SPEC_RULES и здесь не дублируются.
 *
 * Vanilla SPA: чистый window.*-ассайн, БЕЗ import/export/ES-модулей.
 * UI здесь НЕТ — это автономный слой данных/логики. НЕ зависит от SensorUI;
 * от SensorStore зависит ТОЛЬКО опционально (через if(global.SensorStore)) и
 * НИКОГДА не бросает, если стора нет (паттерн как в numbering.js / validators.js).
 *
 * Все функции детерминированы и НЕ бросают на null/undefined/мусоре. Тексты — по-русски.
 *
 * API window.SensorCompetency:
 *   targets() -> [...]                 копия списка кодов целей ('МЧС'…)
 *   requirements(target) -> {ok,msg,target,title,positions:[…]} | {ok:false,msg}
 *     Требуемый набор позиций (роль/квалификация) для цели. Неизвестная цель
 *     → {ok:false,msg}. positions[i] = {key,role,qualification,need,note}.
 *   gap(team, target) -> {ok,msg,target,covered:[],missing:[],ratio}
 *     Разрыв команды относительно цели. team — массив специалистов с навыками/
 *     квалификациями. Пустая/мусорная команда → всё в missing, ratio=0, без throw.
 *     Неизвестная цель → {ok:false,msg,covered:[],missing:[],ratio:0}.
 *     ratio = доля закрытых позиций (0..1); полная команда → missing=[], ratio=1.
 *   suggest(team, target) -> {ok,msg,target,items:[…]}
 *     Перечень недостающих позиций по-русски (человекочитаемые подсказки продажнику).
 *   TARGETS, REQUIREMENTS, STORE_KEY — константы/данные.
 */
(function (global) {
  'use strict';

  var STORE_KEY = 'competency_matrix';

  // --- безопасные приведения (ничего не бросают) ---------------------------
  function str(v) { return v == null ? '' : String(v); }
  function norm(v) { return str(v).trim().toLowerCase(); }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  // --- КОНСТАНТЫ: требуемые позиции по целям -------------------------------
  // Каждая позиция: key (стабильный код), role (роль/должность), qualification
  // (искомая квалификация), need (сколько человек закрывают позицию минимально),
  // match (набор синонимов-меток, по которым позиция «закрывается» специалистом),
  // note (короткая подсказка по-русски). Пороговые детали — в SPEC_RULES.
  var REQUIREMENTS = {
    'МЧС': {
      title: 'Лицензия МЧС',
      positions: [
        {
          key: 'mchs_responsible',
          role: 'Ответственный за пожарную безопасность',
          qualification: 'Профильное образование по ПБ (или профпереподготовка) + стаж ≥5 лет',
          need: 1,
          match: ['ответственный', 'ответственный за пб', 'responsible', 'mchs_responsible',
                  'руководитель работ по пб', 'пожарная безопасность'],
          note: 'Нужен 1 ответственный сотрудник с профильным образованием по ПБ ' +
                'и стажем ≥5 лет (только у одного лицензиата).'
        },
        {
          key: 'mchs_techspecs',
          role: 'Технические специалисты',
          qualification: 'Техническое образование (не ниже СПО), трудовой договор',
          need: 2,
          match: ['техспециалист', 'технический специалист', 'техник', 'инженер',
                  'techspec', 'mchs_techspecs', 'монтажник'],
          note: 'Минимум 2 техспециалиста на 1–2 вида работ (3 — на 3–4 вида, 5 — на 5+).'
        }
      ]
    },

    'АТТПР': {
      title: 'АТТПР — аттестация проектировщика',
      positions: [
        {
          key: 'attpr',
          role: 'Аттестованный проектировщик',
          qualification: 'Образование по ПБ/ТБ или СПО+ профпереподготовка; сдан экзамен МЧС',
          need: 1,
          match: ['проектировщик', 'аттестованный проектировщик', 'attpr',
                  'аттпр', 'аттестация проектировщика'],
          note: 'Нужен 1 проектировщик с действующим аттестатом МЧС (экзамен 40 вопросов, ' +
                'аттестат на 5 лет). Жёсткого ценза по стажу нет.'
        }
      ]
    },

    'НОК': {
      title: 'НОК — независимая оценка квалификации',
      positions: [
        {
          key: 'nok',
          role: 'Специалист с подтверждённой квалификацией (НОК)',
          qualification: 'Профильный диплом по профстандарту + опыт; сдан профэкзамен в ЦОК',
          need: 1,
          match: ['нок', 'nok', 'свидетельство нок', 'квалификация подтверждена',
                  'профэкзамен', 'независимая оценка квалификации'],
          note: 'Нужен ≥1 специалист со свидетельством о квалификации (НОК) по профстандарту ' +
                '(профильный диплом + опыт, профэкзамен в ЦОК).'
        }
      ]
    },

    'НРС': {
      title: 'НРС — национальный реестр специалистов',
      positions: [
        {
          key: 'nrs',
          role: 'Специалист в национальном реестре (НРС)',
          qualification: 'Профильный диплом + стаж ≥10 лет (≥3 на инженерных должностях), НОК',
          need: 1,
          match: ['нрс', 'nrs', 'национальный реестр', 'специалист нрс',
                  'реестр специалистов'],
          note: 'Нужен ≥1 специалист, внесённый в НРС: профильный диплом, общий стаж ≥10 лет ' +
                '(≥3 на инженерных должностях), подтверждённая квалификация (НОК).'
        }
      ]
    }
  };

  var TARGETS = Object.keys(REQUIREMENTS);

  // --- какие метки несёт специалист (роль, квалификации, навыки, признаки) --
  // Принимаем любой мусор: собираем нормализованные строки из типовых полей.
  function specLabels(member) {
    if (member == null || typeof member !== 'object') {
      // допускаем, что специалист задан просто строкой («проектировщик»)
      var s = norm(member);
      return s ? [s] : [];
    }
    var bag = [];
    var fields = ['role', 'position', 'должность', 'роль', 'qualification', 'квалификация',
                  'title', 'name'];
    for (var i = 0; i < fields.length; i++) {
      var val = member[fields[i]];
      if (val != null && typeof val !== 'object') {
        var n = norm(val);
        if (n) bag.push(n);
      }
    }
    // массивы навыков/квалификаций/тегов
    var lists = ['skills', 'навыки', 'qualifications', 'квалификации', 'tags', 'метки', 'roles'];
    for (var j = 0; j < lists.length; j++) {
      var arr = asArray(member[lists[j]]);
      for (var k = 0; k < arr.length; k++) {
        var nn = norm(arr[k]);
        if (nn) bag.push(nn);
      }
    }
    // булевы флаги вида { attpr:true, nok:true, nrs:true }
    var flags = ['attpr', 'аттпр', 'nok', 'нок', 'nrs', 'нрс', 'responsible', 'techspec'];
    for (var f = 0; f < flags.length; f++) {
      if (member[flags[f]] === true) bag.push(norm(flags[f]));
    }
    return bag;
  }

  // Закрывает ли специалист данную позицию? — если любая его метка ВКЛЮЧАЕТ
  // (как подстроку) любой из match-синонимов позиции (или совпадает с key/role).
  function memberCoversPosition(labels, position) {
    var needles = (position.match || []).slice();
    needles.push(norm(position.key));
    needles.push(norm(position.role));
    needles.push(norm(position.qualification));
    for (var i = 0; i < labels.length; i++) {
      var lab = labels[i];
      if (!lab) continue;
      for (var j = 0; j < needles.length; j++) {
        var nd = needles[j];
        if (!nd) continue;
        if (lab.indexOf(nd) >= 0 || nd.indexOf(lab) >= 0) return true;
      }
    }
    return false;
  }

  // --- targets() -----------------------------------------------------------
  function targets() { return TARGETS.slice(); }

  // --- requirements(target) ------------------------------------------------
  function requirements(target) {
    var req = REQUIREMENTS[str(target).trim()];
    if (!req) {
      return { ok: false, msg: 'Неизвестная цель лицензирования: «' + str(target) + '». ' +
        'Допустимые: ' + TARGETS.join(', ') + '.' };
    }
    // отдаём КОПИИ позиций, чтобы внешний код не мутировал константы
    var positions = req.positions.map(function (p) {
      return {
        key: p.key, role: p.role, qualification: p.qualification,
        need: p.need, note: p.note, match: p.match.slice()
      };
    });
    return { ok: true, msg: 'Требования для цели «' + target + '» (' + positions.length + ' поз.).',
      target: str(target).trim(), title: req.title, positions: positions };
  }

  // --- gap(team, target) ---------------------------------------------------
  // Считает, какие позиции команда закрывает (с учётом need — нужного числа
  // людей на позицию) и какие — нет. ratio = covered/total по позициям.
  function gap(team, target) {
    var key = str(target).trim();
    var req = REQUIREMENTS[key];
    if (!req) {
      return { ok: false, msg: 'Неизвестная цель лицензирования: «' + str(target) + '». ' +
        'Допустимые: ' + TARGETS.join(', ') + '.',
        target: key, covered: [], missing: [], ratio: 0 };
    }

    var members = asArray(team);
    var labelsByMember = members.map(specLabels);

    var covered = [];
    var missing = [];

    for (var p = 0; p < req.positions.length; p++) {
      var pos = req.positions[p];
      var have = 0;
      for (var m = 0; m < labelsByMember.length; m++) {
        if (memberCoversPosition(labelsByMember[m], pos)) have++;
      }
      var need = pos.need || 1;
      var entry = {
        key: pos.key, role: pos.role, qualification: pos.qualification,
        need: need, have: have, note: pos.note
      };
      if (have >= need) {
        covered.push(entry);
      } else {
        entry.shortfall = need - have; // скольких не хватает
        missing.push(entry);
      }
    }

    var total = req.positions.length;
    var ratio = total === 0 ? 1 : covered.length / total;

    var msg;
    if (missing.length === 0) {
      msg = 'Команда полностью закрывает требования цели «' + key + '» (' +
        covered.length + '/' + total + ').';
    } else {
      msg = 'Команда закрывает ' + covered.length + ' из ' + total +
        ' позиций цели «' + key + '»; не хватает ' + missing.length + '.';
    }

    return { ok: true, msg: msg, target: key, covered: covered, missing: missing, ratio: ratio };
  }

  // --- suggest(team, target) ----------------------------------------------
  // Человекочитаемый перечень недостающих позиций (для подсказки в продаже).
  function suggest(team, target) {
    var g = gap(team, target);
    if (!g.ok) {
      return { ok: false, msg: g.msg, target: g.target, items: [] };
    }
    var items = g.missing.map(function (m) {
      var howMany = (m.shortfall && m.shortfall > 1)
        ? ('Добавить специалистов: ' + m.shortfall + ' × ')
        : 'Добавить специалиста: ';
      var text = howMany + m.role + ' (' + m.qualification + ').';
      if (m.note) text += ' ' + m.note;
      return { key: m.key, role: m.role, shortfall: m.shortfall || (m.need - m.have), text: text };
    });
    var msg = items.length === 0
      ? 'Команда укомплектована под цель «' + g.target + '» — добирать никого не нужно.'
      : 'Для цели «' + g.target + '» не хватает ' + items.length + ' позиц.: ' +
        items.map(function (i) { return i.role; }).join('; ') + '.';
    return { ok: true, msg: msg, target: g.target, items: items };
  }

  // --- опциональный персист в SensorStore (никогда не бросает) -------------
  function hasStore() {
    return global && global.SensorStore &&
      typeof global.SensorStore.get === 'function' &&
      typeof global.SensorStore.set === 'function';
  }
  function save(matrix) {
    if (hasStore()) {
      try { global.SensorStore.set(STORE_KEY, matrix == null ? null : matrix); } catch (e) { /* no-op */ }
    }
    return matrix;
  }
  function load() {
    if (hasStore()) {
      try { return global.SensorStore.get(STORE_KEY, null); } catch (e) { return null; }
    }
    return null;
  }

  global.SensorCompetency = {
    STORE_KEY: STORE_KEY,
    TARGETS: TARGETS,
    REQUIREMENTS: REQUIREMENTS,
    targets: targets,
    requirements: requirements,
    gap: gap,
    suggest: suggest,
    // опциональный персист (используется поздними UI-волнами, не обязателен)
    save: save,
    load: load
  };
})(typeof window !== 'undefined' ? window : this);

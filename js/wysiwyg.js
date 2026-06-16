/* P19: WYSIWYG-движок предпросмотра .docx (docx-preview + подсветка полей + типографика → .docx). window.SensorDocx
 * ----------------------------------------------------------------------------
 * Публичный СТАБИЛЬНЫЙ API (его зовут licensing.js / documents.js):
 *   SensorDocx.available()                 -> { preview:boolean, build:boolean }
 *   SensorDocx.detectFields(b64)           -> [{ token, count }]
 *   SensorDocx.renderPreview(opts)         -> Promise<handle{ update, destroy }>
 *   SensorDocx.buildDocx(opts)             -> Promise<Blob>
 *   SensorDocx.FONTS                       -> string[]
 *   SensorDocx.SIZES                       -> number[] (pt)
 *   SensorDocx._applyGlobalToStylesXml(xml, global) -> xml   (чистая, для node-тестов)
 *   SensorDocx._applyFieldRunProps(documentXml, perField) -> xml (чистая)
 *
 * Деградация: НИ ОДИН метод не бросает в jsdom (нет window.docx / JSZip / DOM).
 * available() честно сообщает, что доступно. Реальный визуальный рендер
 * проверяется Playwright (chromium) — здесь движок просто не должен падать.
 *
 * Строго локально: используются только вендорные window.* (docx, JSZip, PizZip,
 * docxtemplater). Никаких внешних запросов/CDN.
 * ============================================================================ */
(function (root) {
  'use strict';

  var win = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : root);
  var SD = (win.SensorDocx = win.SensorDocx || {});

  /* ---------------------------------------------------------------------------
   * 5) Справочники типографики (UI читает их для селекторов).
   * ------------------------------------------------------------------------- */
  SD.FONTS = [
    'Times New Roman',
    'Arial',
    'Calibri',
    'PT Astra Serif',
    'PT Astra Sans',
    'Verdana',
    'Tahoma',
    'Georgia',
    'Courier New'
  ];
  SD.SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18];

  /* ---------------------------------------------------------------------------
   * Утилиты.
   * ------------------------------------------------------------------------- */
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // Экранирование строки для вставки в RegExp.
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // pt → OOXML half-points (целое).
  function halfPt(pt) { var n = Number(pt); return (isFinite(n) && n > 0) ? Math.round(n * 2) : null; }
  // Нормализация цвета к hex без '#': '#1A2B3C' / '1a2b3c' → '1A2B3C'. Иначе null.
  function hex6(c) {
    if (c == null) return null;
    var s = String(c).trim().replace(/^#/, '');
    return /^[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : null;
  }

  // Получить ссылки на вендорные библиотеки (в jsdom их может не быть).
  function lib(name) { try { return win[name]; } catch (e) { return undefined; } }

  /* ===========================================================================
   * 1) available() — что реально доступно в текущей среде.
   *    preview: нужен window.docx (docx-preview) + JSZip (его зависимость) + DOM.
   *    build:   нужен PizZip + docxtemplater.
   * ========================================================================= */
  SD.available = function available() {
    var hasDoc = !!lib('docx');
    var hasJSZip = !!lib('JSZip');
    var hasDOM = (typeof document !== 'undefined') && !!document.createElement;
    var hasPizZip = !!lib('PizZip');
    var hasTpl = !!lib('docxtemplater');
    return {
      preview: !!(hasDoc && hasJSZip && hasDOM),
      build: !!(hasPizZip && hasTpl)
    };
  };

  /* ===========================================================================
   * 2) detectFields(b64) -> [{ token, count }]
   *    Распаковать .docx (PizZip), из word/document.xml (а также header/footer xml)
   *    склеить текст по параграфам (токен может быть разбит на несколько w:t-ранов),
   *    вытащить плейсхолдеры {TOKEN}. Возвращаем УНИКАЛЬНЫЕ с подсчётом вхождений.
   *    Деградация: нет PizZip / битый b64 → [].
   * ========================================================================= */
  SD.detectFields = function detectFields(b64) {
    var PizZip = lib('PizZip');
    if (!PizZip || !b64) return [];
    try {
      var zip = new PizZip(String(b64), { base64: true });
      var parts = zip.file(/word\/(document|header\d+|footer\d+)\.xml/) || [];
      var counts = Object.create(null);
      var order = [];
      parts.forEach(function (p) {
        var xml;
        try { xml = p.asText(); } catch (e) { return; }
        // Склеиваем текст ПО ПАРАГРАФАМ: внутри <w:p>…</w:p> убираем все теги,
        // тогда {TOK}, разбитый на w:t-раны, снова становится цельным.
        var segments = xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g);
        if (!segments || !segments.length) segments = [xml];
        segments.forEach(function (seg) {
          var text = seg.replace(/<[^>]+>/g, '');
          var mm = text.match(/\{[^{}<>]+\}/g);
          if (!mm) return;
          mm.forEach(function (raw) {
            var tok = raw.slice(1, -1).trim();
            if (!tok) return;
            if (counts[tok] == null) { counts[tok] = 0; order.push(tok); }
            counts[tok] += 1;
          });
        });
      });
      return order.map(function (t) { return { token: t, count: counts[t] }; });
    } catch (e) {
      return [];
    }
  };

  /* ===========================================================================
   * 3) renderPreview(opts) -> Promise<handle>
   *    opts = { b64, container, values:{token:value},
   *             typography:{ global:{font,sizePt,bold,italic},
   *                          perField:{token:{font,sizePt,bold,italic,color}} },
   *             onField(token) }
   *
   *    Нет preview-возможностей → НЕ падать: очистить container, показать заметку,
   *    вернуть handle-заглушку (no-op update/destroy).
   *    Иначе: b64→Blob→docx.renderAsync(...) на лист А4, ПОСТ-ОБРАБОТКА DOM:
   *      - текстовые узлы с {TOKEN} оборачиваются в <span class="sd-field" …>;
   *      - подстановка values[token] как textContent (escape!), либо «{TOKEN}» если пусто;
   *      - click/Enter → onField(token).
   *    Типографика: global → стиль на корень .docxp; perField → инлайн-стиль на span.
   *    handle.update({values,typography}) — без полного ре-рендера; handle.destroy().
   * ========================================================================= */
  SD.renderPreview = function renderPreview(opts) {
    opts = opts || {};
    var container = opts.container || null;
    var avail = SD.available();

    // Заглушка-handle на случай деградации/ошибок.
    function stubHandle(note) {
      try {
        if (container) {
          container.innerHTML = '';
          var p = (typeof document !== 'undefined' && document.createElement)
            ? document.createElement('div') : null;
          if (p) {
            p.className = 'sd-note';
            p.setAttribute('role', 'note');
            p.textContent = note || 'Предпросмотр недоступен (нет docx-preview/тестовая среда)';
            container.appendChild(p);
          }
        }
      } catch (e) { /* no-op */ }
      return {
        update: function () { return this; },
        destroy: function () {},
        rerender: function () { return Promise.resolve(this); },
        _stub: true
      };
    }

    if (!avail.preview || !container) {
      return Promise.resolve(stubHandle());
    }

    var docx = lib('docx');
    try {
      injectStyleOnce();
      ensureFieldStyleVisible(container);
      container.innerHTML = '';

      // base64 → Blob.
      var blob = b64ToBlob(
        opts.b64,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      var renderOpts = {
        className: 'docxp',
        inWrapper: true,
        breakPages: true,
        ignoreWidth: false,
        ignoreHeight: false,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true
      };

      var p = docx.renderAsync(blob, container, null, renderOpts);
      if (!p || typeof p.then !== 'function') p = Promise.resolve();

      return p.then(function () {
        return buildLiveHandle(container, opts);
      }).catch(function (err) {
        return stubHandle('Не удалось отрисовать предпросмотр: ' + (err && err.message || err));
      });
    } catch (err) {
      return Promise.resolve(stubHandle('Не удалось отрисовать предпросмотр: ' + (err && err.message || err)));
    }
  };

  /* --- Живой handle: подсветка полей, подстановка значений, типографика, события.
   *     Использует ДЕЛЕГИРОВАНИЕ событий (один слушатель на корне) → destroy() без
   *     утечек. update() меняет textContent/инлайн-стиль БЕЗ повторного renderAsync. */
  function buildLiveHandle(container, opts) {
    var state = {
      values: assign({}, opts.values),
      typography: cloneTypo(opts.typography),
      onField: typeof opts.onField === 'function' ? opts.onField : null,
      fields: []        // [{ token, span }]
    };

    var rootEl = container.querySelector('.docxp') || container;

    // 0) Картинки бланка (герб/логотип в колонтитулах .docx) — декоративные.
    //    docx-preview эмитит <img> без alt → axe image-alt (critical). Помечаем
    //    их как презентационные, чтобы предпросмотр оставался доступным (a11y=0).
    decorateImages(rootEl);

    // 1) Обернуть {TOKEN} в span.sd-field (по текстовым узлам).
    wrapTokens(rootEl, state);

    // 2) Применить значения + типографику.
    applyGlobalTypoToRoot(rootEl, state.typography && state.typography.global);
    state.fields.forEach(function (f) { paintField(f, state); });

    // 3) Делегированные обработчики (click + Enter/Space).
    function onClick(ev) {
      var span = closestField(ev.target, rootEl);
      if (!span) return;
      ev.preventDefault();
      fire(span);
    }
    function onKey(ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
      var span = closestField(ev.target, rootEl);
      if (!span) return;
      ev.preventDefault();
      fire(span);
    }
    function fire(span) {
      if (state.onField) {
        try { state.onField(span.getAttribute('data-token')); } catch (e) { /* no-op */ }
      }
    }
    try {
      rootEl.addEventListener('click', onClick);
      rootEl.addEventListener('keydown', onKey);
    } catch (e) { /* no-op */ }

    var destroyed = false;
    return {
      // update({ values, typography }) — без ре-рендера.
      update: function (patch) {
        if (destroyed || !patch) return this;
        try {
          if (patch.values) {
            assign(state.values, patch.values);
          }
          if (patch.typography) {
            state.typography = cloneTypo(patch.typography);
            applyGlobalTypoToRoot(rootEl, state.typography && state.typography.global);
          }
          state.fields.forEach(function (f) { paintField(f, state); });
        } catch (e) { /* no-op */ }
        return this;
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        try {
          rootEl.removeEventListener('click', onClick);
          rootEl.removeEventListener('keydown', onKey);
        } catch (e) { /* no-op */ }
      },
      rerender: function () {
        // Полный ре-рендер делает вызывающий код (новый renderPreview).
        return Promise.resolve(this);
      },
      _root: rootEl,
      _fields: state.fields
    };
  }

  // Найти ближайший span.sd-field вверх по дереву (в пределах rootEl).
  function closestField(node, rootEl) {
    var el = node;
    while (el && el !== rootEl) {
      if (el.nodeType === 1 && el.classList && el.classList.contains('sd-field')) return el;
      el = el.parentNode;
    }
    return null;
  }

  // Декоративные картинки бланка (герб/логотип) → alt="" + role=presentation.
  // Снимает axe image-alt (critical) при автопредпросмотре, контракты не трогает.
  function decorateImages(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
    var imgs;
    try { imgs = rootEl.querySelectorAll('img'); } catch (e) { return; }
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (!im.hasAttribute('alt')) im.setAttribute('alt', '');
      if (!im.getAttribute('role')) im.setAttribute('role', 'presentation');
    }
  }

  // Обход текстовых узлов и обёртка {TOKEN} в span.sd-field.
  function wrapTokens(rootEl, state) {
    if (!rootEl || typeof document === 'undefined') return;
    var doc = rootEl.ownerDocument || document;
    var walker;
    try {
      walker = doc.createTreeWalker(rootEl, 4 /* NodeFilter.SHOW_TEXT */, null, false);
    } catch (e) { return; }

    var textNodes = [];
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && /\{[^{}]+\}/.test(n.nodeValue)) textNodes.push(n);
    }

    textNodes.forEach(function (textNode) {
      var parent = textNode.parentNode;
      if (!parent) return;
      // Не оборачивать дважды (если узел уже внутри sd-field — пропускаем).
      if (closestField(parent, rootEl)) return;

      var str = textNode.nodeValue;
      var re = /\{([^{}]+)\}/g;
      var frag = doc.createDocumentFragment();
      var last = 0, m;
      while ((m = re.exec(str))) {
        if (m.index > last) frag.appendChild(doc.createTextNode(str.slice(last, m.index)));
        var token = m[1].trim();
        var span = doc.createElement('span');
        span.className = 'sd-field';
        span.setAttribute('data-token', token);
        span.setAttribute('tabindex', '0');
        span.setAttribute('role', 'button');
        span.setAttribute('aria-label', 'Поле ' + token);
        frag.appendChild(span);
        state.fields.push({ token: token, span: span });
        last = re.lastIndex;
      }
      if (last < str.length) frag.appendChild(doc.createTextNode(str.slice(last)));
      parent.replaceChild(frag, textNode);
    });
  }

  // Заполнить span значением (escape!) или плейсхолдером, навесить per-field стиль.
  function paintField(f, state) {
    var span = f.span;
    if (!span || !span.parentNode) return;
    var val = state.values ? state.values[f.token] : undefined;
    var hasVal = (val != null && String(val).length > 0);
    // textContent — безопасная подстановка (НЕ innerHTML).
    span.textContent = hasVal ? String(val) : ('{' + f.token + '}');
    if (hasVal) span.classList.add('sd-field--filled');
    else span.classList.remove('sd-field--filled');
    span.setAttribute('aria-label', 'Поле ' + f.token + (hasVal ? ': ' + String(val) : ' (не заполнено)'));

    // Инлайновая типографика поля.
    var pf = state.typography && state.typography.perField && state.typography.perField[f.token];
    applyInlineTypoToSpan(span, pf);
  }

  function applyInlineTypoToSpan(span, t) {
    // Сбрасываем управляемые свойства, затем выставляем заданные.
    span.style.fontFamily = '';
    span.style.fontSize = '';
    span.style.fontWeight = '';
    span.style.fontStyle = '';
    span.style.color = '';
    if (!t) return;
    if (t.font) span.style.fontFamily = '"' + String(t.font).replace(/"/g, '') + '"';
    if (t.sizePt) span.style.fontSize = Number(t.sizePt) + 'pt';
    if (t.bold != null) span.style.fontWeight = t.bold ? '700' : '400';
    if (t.italic != null) span.style.fontStyle = t.italic ? 'italic' : 'normal';
    var hc = hex6(t.color);
    if (hc) span.style.color = '#' + hc;
  }

  function applyGlobalTypoToRoot(rootEl, g) {
    if (!rootEl || !rootEl.style) return;
    rootEl.style.fontFamily = '';
    rootEl.style.fontSize = '';
    rootEl.style.fontWeight = '';
    rootEl.style.fontStyle = '';
    if (!g) return;
    if (g.font) rootEl.style.fontFamily = '"' + String(g.font).replace(/"/g, '') + '"';
    if (g.sizePt) rootEl.style.fontSize = Number(g.sizePt) + 'pt';
    if (g.bold != null) rootEl.style.fontWeight = g.bold ? '700' : '400';
    if (g.italic != null) rootEl.style.fontStyle = g.italic ? 'italic' : 'normal';
  }

  // base64 → Blob (без fetch/data-url; чистая бинарная сборка).
  function b64ToBlob(b64, mime) {
    var bin = atobSafe(String(b64 || ''));
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }
  function atobSafe(s) {
    if (typeof atob === 'function') return atob(s);
    if (typeof win.atob === 'function') return win.atob(s);
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('binary');
    return '';
  }

  // Один раз внедрить базовый стиль подсветки полей (мы владеем только wysiwyg.js,
  // index.html/css не трогаем — поэтому стиль аккуратно инжектится отсюда).
  var styleInjected = false;
  function injectStyleOnce() {
    if (styleInjected || typeof document === 'undefined' || !document.head) return;
    if (document.getElementById('sd-style')) { styleInjected = true; return; }
    var st = document.createElement('style');
    st.id = 'sd-style';
    st.textContent =
      '.sd-field{background:rgba(96,165,250,.18);outline:1px dashed rgba(59,130,246,.55);' +
      'border-radius:2px;padding:0 1px;cursor:pointer;transition:background .12s ease;}' +
      '.sd-field:hover{background:rgba(96,165,250,.32);}' +
      '.sd-field:focus{outline:2px solid #2563eb;outline-offset:1px;}' +
      '.sd-field--filled{background:rgba(34,197,94,.16);outline-color:rgba(22,163,74,.5);}' +
      '.sd-note{padding:16px;color:#64748b;font:14px/1.5 system-ui,sans-serif;text-align:center;}';
    document.head.appendChild(st);
    styleInjected = true;
  }
  // Гарантировать, что стиль не «съест» лишнюю высоту листа (no-op хук на будущее).
  function ensureFieldStyleVisible() { /* зарезервировано */ }

  /* ===========================================================================
   * 4) buildDocx(opts) -> Promise<Blob>
   *    opts = { b64, values, typography }
   *    ТИПОГРАФИКА ПОПАДАЕТ В ФАЙЛ:
   *      - ГЛОБАЛЬНО: правка word/styles.xml (docDefaults/rPrDefault/rPr) —
   *        чистая функция _applyGlobalToStylesXml.
   *      - ПО-ПОЛЬНО: ПРЕД-ПАСС word/document.xml ДО docxtemplater — переопределяем
   *        w:rPr рунов, содержащих {TOKEN} — чистая функция _applyFieldRunProps.
   *        После заполнения docxtemplater сохраняет rPr, значение наследует стиль.
   *      - Затем docxtemplater (delimiters {start:'{',end:'}'}, paragraphLoop:true,
   *        linebreaks:true, nullGetter:()=>'') → render(values) → generate(blob).
   *    Деградация: нет build-библиотек / ошибка → reject (вызывающий ловит).
   * ========================================================================= */
  SD.buildDocx = function buildDocx(opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var PizZip = lib('PizZip');
      var Docxtemplater = lib('docxtemplater');
      if (!PizZip || !Docxtemplater) {
        reject(new Error('Библиотеки PizZip/docxtemplater недоступны'));
        return;
      }
      try {
        var typo = opts.typography || {};
        var values = opts.values || {};

        var zip = new PizZip(String(opts.b64 || ''), { base64: true });

        // --- ГЛОБАЛЬНО: styles.xml ---
        if (typo.global) {
          var stFile = zip.file('word/styles.xml');
          if (stFile) {
            var newStyles = SD._applyGlobalToStylesXml(stFile.asText(), typo.global);
            if (newStyles) zip.file('word/styles.xml', newStyles);
          }
        }

        // --- ПО-ПОЛЬНО: ПРЕД-ПАСС document.xml (rPr рунов с токенами) ---
        if (typo.perField && Object.keys(typo.perField).length) {
          var docFile = zip.file('word/document.xml');
          if (docFile) {
            var newDoc = SD._applyFieldRunProps(docFile.asText(), typo.perField);
            if (newDoc) zip.file('word/document.xml', newDoc);
          }
        }

        // --- Заполнение docxtemplater (на том же zip, что мы уже подправили) ---
        var doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: '{', end: '}' },
          nullGetter: function () { return ''; }
        });
        doc.render(values);
        var out = doc.getZip().generate({
          type: 'blob',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
        resolve(out);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  };

  /* ===========================================================================
   * ЧИСТЫЕ функции (строка → строка, без DOM / PizZip) — для node-тестов.
   * ========================================================================= */

  /* _applyGlobalToStylesXml(xml, global) -> xml
   * Правит w:docDefaults/w:rPrDefault/w:rPr: w:rFonts(ascii/hAnsi/cs=font),
   * w:sz/w:szCs(=sizePt*2), w:b/w:i. Создаёт недостающие узлы с соблюдением
   * валидного порядка элементов OOXML (rFonts → b → i → sz → szCs).
   */
  SD._applyGlobalToStylesXml = function _applyGlobalToStylesXml(xml, global) {
    if (!xml || !global) return xml;
    var src = String(xml);

    var font = global.font ? String(global.font) : null;
    var sz = halfPt(global.sizePt);
    var bold = (global.bold === true || global.bold === false) ? global.bold : null;
    var italic = (global.italic === true || global.italic === false) ? global.italic : null;

    // 1) Гарантировать наличие docDefaults/rPrDefault/rPr.
    if (!/<w:docDefaults\b/.test(src)) {
      // Вставляем сразу после открывающего <w:styles ...>.
      src = src.replace(/(<w:styles\b[^>]*>)/,
        '$1<w:docDefaults><w:rPrDefault><w:rPr></w:rPr></w:rPrDefault></w:docDefaults>');
    } else if (!/<w:rPrDefault\b/.test(src)) {
      src = src.replace(/(<w:docDefaults\b[^>]*>)/,
        '$1<w:rPrDefault><w:rPr></w:rPr></w:rPrDefault>');
    } else if (!/<w:rPrDefault\b[^>]*>[\s\S]*?<w:rPr\b/.test(src)) {
      // rPrDefault есть, но без rPr — добавим пустой rPr (учитываем самозакрытие).
      src = src
        .replace(/<w:rPrDefault\s*\/>/, '<w:rPrDefault><w:rPr></w:rPr></w:rPrDefault>')
        .replace(/(<w:rPrDefault\b[^>]*>)(?![\s\S]*?<w:rPr\b)/, '$1<w:rPr></w:rPr>');
    }

    // 2) Найти rPr внутри rPrDefault и переписать его содержимое.
    var rPrRe = /(<w:rPrDefault\b[^>]*>\s*)(<w:rPr\b[^>]*>)([\s\S]*?)(<\/w:rPr>)/;
    var selfClose = /(<w:rPrDefault\b[^>]*>\s*)(<w:rPr\b[^>]*\/>)/;

    var inner = '';
    if (rPrRe.test(src)) {
      src = src.replace(rPrRe, function (whole, pre, open, body, close) {
        inner = mergeRunProps(body, font, sz, bold, italic);
        return pre + '<w:rPr>' + inner + '</w:rPr>';
      });
    } else if (selfClose.test(src)) {
      src = src.replace(selfClose, function (whole, pre) {
        inner = mergeRunProps('', font, sz, bold, italic);
        return pre + '<w:rPr>' + inner + '</w:rPr>';
      });
    }
    return src;
  };

  /* _applyFieldRunProps(documentXml, perField) -> xml
   * Для каждого токена perField находит ВСЕ раны <w:r>…{TOKEN}…</w:r> и
   * выставляет/переопределяет их w:rPr (rFonts/sz/szCs/b/i/color).
   * Токены здесь — цельные в одном w:t (как в бланках «Спарты»); если токен
   * разбит на несколько ранов, правится тот ран, в котором лежит '{'.
   */
  SD._applyFieldRunProps = function _applyFieldRunProps(documentXml, perField) {
    if (!documentXml || !perField) return documentXml;
    var src = String(documentXml);

    Object.keys(perField).forEach(function (token) {
      var t = perField[token];
      if (!t) return;
      var font = t.font ? String(t.font) : null;
      var sz = halfPt(t.sizePt);
      var bold = (t.bold === true || t.bold === false) ? t.bold : null;
      var italic = (t.italic === true || t.italic === false) ? t.italic : null;
      var color = hex6(t.color);
      if (font == null && sz == null && bold == null && italic == null && color == null) return;

      // Раны вида <w:r ...> ... <w:t...>{TOKEN}...</w:t> ... </w:r>.
      // Сопоставляем непрожорливо до ближайшего </w:r>, проверяя наличие {TOKEN}.
      var litToken = '{' + token + '}';
      var runRe = /<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/g;
      src = src.replace(runRe, function (whole, attrs, body) {
        if (body.indexOf(litToken) === -1) return whole;
        var newBody;
        var rPrRe = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>|<w:rPr\b[^>]*\/>/;
        if (rPrRe.test(body)) {
          newBody = body.replace(rPrRe, function (rpr) {
            var inner = '';
            var mm = rpr.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/);
            if (mm) inner = mm[1];
            return '<w:rPr>' + mergeRunProps(inner, font, sz, bold, italic, color) + '</w:rPr>';
          });
        } else {
          // rPr нет — добавляем в начало рана (rPr идёт первым в w:r).
          newBody = '<w:rPr>' + mergeRunProps('', font, sz, bold, italic, color) + '</w:rPr>' + body;
        }
        return '<w:r' + attrs + '>' + newBody + '</w:r>';
      });
    });
    return src;
  };

  /* Собрать содержимое <w:rPr> из старого inner, переопределив заданные свойства.
   * Соблюдаем валидный порядок дочерних: rFonts → b → i → color → sz → szCs.
   * Незаданные (null) свойства сохраняются из исходного inner. */
  function mergeRunProps(inner, font, sz, bold, italic, color) {
    inner = String(inner || '');

    // rFonts
    var rFonts = null;
    var mF = inner.match(/<w:rFonts\b[^>]*\/?>/);
    if (font != null) {
      rFonts = '<w:rFonts w:ascii="' + escXml(font) + '" w:hAnsi="' + escXml(font) +
               '" w:cs="' + escXml(font) + '" w:eastAsia="' + escXml(font) + '"/>';
    } else if (mF) {
      rFonts = mF[0];
    }

    // b
    var bEl = null;
    if (bold === true) bEl = '<w:b/>';
    else if (bold === false) bEl = null; // явное снятие
    else if (/<w:b\b(?![A-Za-z])[^>]*\/?>/.test(inner)) bEl = (inner.match(/<w:b\b(?![A-Za-z])[^>]*\/?>/) || [null])[0];

    // i
    var iEl = null;
    if (italic === true) iEl = '<w:i/>';
    else if (italic === false) iEl = null;
    else if (/<w:i\b(?![A-Za-z])[^>]*\/?>/.test(inner)) iEl = (inner.match(/<w:i\b(?![A-Za-z])[^>]*\/?>/) || [null])[0];

    // color
    var colorEl = null;
    if (color != null) colorEl = '<w:color w:val="' + color + '"/>';
    else {
      var mC = inner.match(/<w:color\b[^>]*\/?>/);
      if (mC) colorEl = mC[0];
    }

    // sz / szCs
    var szEl = null, szCsEl = null;
    if (sz != null) { szEl = '<w:sz w:val="' + sz + '"/>'; szCsEl = '<w:szCs w:val="' + sz + '"/>'; }
    else {
      var mS = inner.match(/<w:sz\b[^>]*\/?>/);
      var mSC = inner.match(/<w:szCs\b[^>]*\/?>/);
      if (mS) szEl = mS[0];
      if (mSC) szCsEl = mSC[0];
    }

    // Сохранить прочие дочерние rPr (highlight, u, lang, …), которые мы не трогаем,
    // вырезав управляемые нами элементы из исходного inner.
    var rest = inner
      .replace(/<w:rFonts\b[^>]*\/?>/g, '')
      .replace(/<w:b\b(?![A-Za-z])[^>]*\/?>/g, '')
      .replace(/<w:i\b(?![A-Za-z])[^>]*\/?>/g, '')
      .replace(/<w:color\b[^>]*\/?>/g, '')
      .replace(/<w:sz\b[^>]*\/?>/g, '')
      .replace(/<w:szCs\b[^>]*\/?>/g, '')
      .trim();

    var parts = [];
    if (rFonts) parts.push(rFonts);
    if (bEl) parts.push(bEl);
    if (iEl) parts.push(iEl);
    if (colorEl) parts.push(colorEl);
    if (szEl) parts.push(szEl);
    if (szCsEl) parts.push(szCsEl);
    if (rest) parts.push(rest); // прочие свойства — в конце (некритично для Word)
    return parts.join('');
  }

  /* --- мелкие helpers --- */
  function assign(target) {
    target = target || {};
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (!s) continue;
      for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) target[k] = s[k];
    }
    return target;
  }
  function cloneTypo(t) {
    t = t || {};
    var out = { global: assign({}, t.global), perField: {} };
    if (t.perField) {
      for (var k in t.perField) if (Object.prototype.hasOwnProperty.call(t.perField, k)) {
        out.perField[k] = assign({}, t.perField[k]);
      }
    }
    return out;
  }

  // Зарезервированные ссылки на helpers (на случай внешнего теста чистых частей).
  SD._util = { escHtml: escHtml, escXml: escXml, halfPt: halfPt, hex6: hex6, mergeRunProps: mergeRunProps };

})(typeof globalThis !== 'undefined' ? globalThis : this);

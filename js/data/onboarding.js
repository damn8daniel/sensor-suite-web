/* ===== Контент приветственного тура (онбординг) =====
   Подключается ДО app.js (как остальные js/data/*). Чистые данные: шаги тура,
   тексты, какой шаг интерактивен. app.js рендерит это в переиспользуемой модалке.

   Каждый шаг:
     id        — стабильный идентификатор шага
     title     — заголовок шага
     icon      — эмодзи в шапке
     kind      — 'info' (текст) | 'role' (выбор роли прямо в туре)
     body(ctx) — функция, возвращающая HTML тела шага. Получает мини-ctx:
                 { esc, role, roleLabels, roleOrder, modulesByDept, integrations, env }
                 чтобы текст подстраивался под реальную сборку/режим.

   Никаких внешних запросов — только локальные данные и хелперы. */
window.SUITE_ONBOARDING = window.SUITE_ONBOARDING || (function () {

  // Список интеграций для шага 4 (если в сборке их нет — текст это учитывает).
  function intLine(integrations, esc) {
    const names = (integrations || []).map(function (d) { return d.title || d.id; });
    return names.length ? names.map(esc).join(' · ') : '';
  }

  // Сгруппированный обзор модулей по отделам для шага 3.
  function deptList(modulesByDept, esc) {
    const depts = Object.keys(modulesByDept || {});
    if (!depts.length) return '';
    return depts.map(function (dept) {
      const mods = modulesByDept[dept].map(function (m) { return m.title; });
      return '<li><strong>' + esc(dept) + '</strong> — ' + esc(mods.join(', ')) + '</li>';
    }).join('');
  }

  const steps = [
    {
      id: 'welcome', title: 'Добро пожаловать в Сенсор Suite', icon: '👋', kind: 'info',
      body: function (c) {
        const esc = c.esc;
        return '' +
          '<p class="ob-lead">Сенсор Suite — единое рабочее приложение для всех отделов учебного центра: ' +
          'документооборот, лицензирование, продажи, управление и работа с контрагентами в одном окне.</p>' +
          '<div class="ob-twocol">' +
            '<div class="ob-mini"><div class="ob-mini-ic" aria-hidden="true">🌐</div>' +
              '<div class="ob-mini-t">Обезличенное демо</div>' +
              '<div class="ob-mini-s">Веб-версия работает на демо-данных без реальных ключей и без персональных данных обучающихся.</div></div>' +
            '<div class="ob-mini"><div class="ob-mini-ic" aria-hidden="true">💻</div>' +
              '<div class="ob-mini-t">Локальная версия</div>' +
              '<div class="ob-mini-s">Десктоп-сборка (' + esc(c.env === 'desktop' ? 'этот режим' : 'Electron') +
              ') обращается к сервисам напрямую — нужны ключи в Настройках.</div></div>' +
          '</div>' +
          '<p class="ob-note">Пройдём пять коротких шагов: режим работы, обзор модулей, интеграции и горячие клавиши. Это займёт минуту.</p>';
      }
    },
    {
      id: 'role', title: 'Выберите режим работы', icon: '🎛️', kind: 'role',
      body: function (c) {
        const esc = c.esc;
        // сегмент-контрол ролей рендерит app.js (нужны живые обработчики);
        // здесь — только вводный текст. Маркер вставки — #ob-role-slot.
        const cur = (c.roleLabels && c.roleLabels[c.role]) || c.role;
        return '' +
          '<p class="ob-lead">От режима зависит набор доступных разделов. Его всегда можно сменить в Настройках → Оформление.</p>' +
          '<div id="ob-role-slot" class="ob-role-slot"></div>' +
          '<p class="ob-note">Сейчас выбран режим: <strong id="ob-role-current">' + esc(cur) + '</strong>. ' +
          'Руководителю доступны все модули, оператору — операционные (без руководительской аналитики).</p>';
      }
    },
    {
      id: 'modules', title: 'Модули по отделам', icon: '🧭', kind: 'info',
      body: function (c) {
        const esc = c.esc;
        const list = deptList(c.modulesByDept, esc);
        return '' +
          '<p class="ob-lead">Слева — навигация по отделам. В текущем режиме доступны:</p>' +
          (list ? '<ul class="ob-list">' + list + '</ul>'
                : '<p class="ob-note">Модули появятся в левой панели после загрузки.</p>') +
          '<div class="ob-dept-grid">' +
            '<div class="ob-dept"><span class="ob-dept-ic" aria-hidden="true">📄</span><b>Документооборот</b><span>шаблоны и генерация .docx</span></div>' +
            '<div class="ob-dept"><span class="ob-dept-ic" aria-hidden="true">🎓</span><b>УЦ / Лицензирование</b><span>пакеты документов, специалисты</span></div>' +
            '<div class="ob-dept"><span class="ob-dept-ic" aria-hidden="true">📞</span><b>Продажи</b><span>контроль звонков, AI-ассистент</span></div>' +
            '<div class="ob-dept"><span class="ob-dept-ic" aria-hidden="true">📊</span><b>Управление</b><span>РНП-дашборд, аналитика</span></div>' +
            '<div class="ob-dept"><span class="ob-dept-ic" aria-hidden="true">🏢</span><b>Контрагенты</b><span>пробив по ИНН, реестр</span></div>' +
          '</div>';
      }
    },
    {
      id: 'integrations', title: 'Интеграции и ключи доступа', icon: '🔌', kind: 'info',
      body: function (c) {
        const esc = c.esc;
        const line = intLine(c.integrations, esc);
        return '' +
          '<p class="ob-lead">Внешние сервисы подключаются ключами в разделе <strong>Настройки → Интеграции</strong>. ' +
          'Всё хранится только в этом браузере и никуда не отправляется.</p>' +
          '<ul class="ob-list">' +
            '<li><strong>DaData</strong> — пробив контрагентов по ИНН / ОГРН / названию.</li>' +
            '<li><strong>Google Sheets</strong> — чтение диапазонов таблиц.</li>' +
            '<li><strong>amoCRM</strong> — сделки, воронки и контакты.</li>' +
            '<li><strong>СПАРК</strong> — должная осмотрительность по контрагентам.</li>' +
          '</ul>' +
          (line ? '<p class="ob-note">В этой сборке доступны: ' + line + '.</p>' : '') +
          '<div class="ob-callout"><span class="ob-callout-ic" aria-hidden="true">🧪</span>' +
            '<span><strong>Без ключей всё работает.</strong> Модули показывают реалистичные демо-данные ' +
            '(mock-режим). Индикатор «демо-данные» в шапке подскажет, где нужны ключи.</span></div>';
      }
    },
    {
      id: 'shortcuts', title: 'Горячие клавиши — и готово', icon: '⌨️', kind: 'info',
      body: function (c) {
        const esc = c.esc;
        const kbd = function (s) { return '<span class="kbd">' + esc(s) + '</span>'; };
        return '' +
          '<p class="ob-lead">Несколько сочетаний ускорят работу:</p>' +
          '<div class="ob-keys">' +
            '<div class="ob-key-row"><div class="ob-key-keys">' + kbd('⌘ K') + '<span class="ob-or">или</span>' + kbd('Ctrl K') +
              '</div><div class="ob-key-label">Командная палитра — быстрый переход к модулю или действию</div></div>' +
            '<div class="ob-key-row"><div class="ob-key-keys">' + kbd('?') +
              '</div><div class="ob-key-label">Эта шпаргалка горячих клавиш в любой момент</div></div>' +
            '<div class="ob-key-row"><div class="ob-key-keys">' + kbd('◐ Тема') +
              '</div><div class="ob-key-label">Тумблер темы в левой панели · режим (светлая/тёмная/системная) — в Настройках</div></div>' +
            '<div class="ob-key-row"><div class="ob-key-keys">' + kbd('Esc') +
              '</div><div class="ob-key-label">Закрыть палитру, окно или этот тур</div></div>' +
          '</div>' +
          '<p class="ob-note">Готово! Тур можно пройти заново в любое время: Настройки → Оформление → «Пройти тур заново».</p>';
      }
    }
  ];

  return { storeKey: 'onboarded', version: 1, steps: steps };
})();

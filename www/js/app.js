// Точка входа фронта. Подменить тело под бизнес-логику проекта.
//
// Что уже работает:
//  - window.APP_SESSION — токен сессии (инжектится index.php после admin-gate)
//  - window.BX24       — Б24 JS SDK (подгружен через template.html)
//
// Внизу пара helper'ов для типового кейса «дёрнуть наш api-endpoint с токеном».

(function () {
  'use strict';

  var bx24State = document.getElementById('bx24-state');
  var sessionState = document.getElementById('session-state');

  if (sessionState) {
    sessionState.textContent = window.APP_SESSION ? 'OK' : 'нет — открой через Б24';
    sessionState.className = window.APP_SESSION ? 'ok' : 'muted-tag';
  }

  if (window.BX24) {
    BX24.init(function () {
      if (bx24State) {
        bx24State.textContent = 'OK';
        bx24State.className = 'ok';
      }
      // Здесь можно дёргать BX24.callMethod, BX24.placement.info() и т.д.
    });
  } else if (bx24State) {
    bx24State.textContent = 'не загружен (открыто вне Б24?)';
    bx24State.className = 'muted-tag';
  }

  // Helper для вызовов нашего бэкенда с прикреплённым session-token.
  // Использовать: api('GET', 'api/my-endpoint.php').then(data => ...).
  window.api = function (method, path, body) {
    return fetch(path, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-App-Session': window.APP_SESSION || '',
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.error || ('HTTP ' + r.status));
        });
      }
      return r.json();
    });
  };

  // ── доступ к приложению (админ-настройка) ───────────────────────────────────
  // Переключатель режима: по отделам / персонально / всем. Действует один режим;
  // списки других режимов сохраняются, но не учитываются (см. accessAllows() в session.php,
  // /projects/docs/rules-b24/rule-b24-department-based-access.md).

  var $ = function (id) { return document.getElementById(id); };
  var accessBtn = $('access-btn');
  var overlay = $('access-modal-overlay');
  var deptList = $('access-dept-list');
  var usersList = $('access-users-list');
  var userSearch = $('access-user-search');
  var usersCount = $('access-users-count');
  var errBox = $('access-modal-error');
  var saveBtn = $('access-modal-save');
  var sections = {
    departments: $('access-section-departments'),
    users: $('access-section-users'),
    all: $('access-section-all'),
  };

  // Состояние окна: выбранные id держим в Set, а не только в DOM — список людей
  // подгружается лениво и фильтруется поиском.
  var st = null;

  function showError(msg) { errBox.textContent = msg; errBox.hidden = !msg; }

  function currentMode() {
    var r = document.querySelector('input[name="access-mode"]:checked');
    return r ? r.value : 'departments';
  }

  function showMode(mode) {
    Object.keys(sections).forEach(function (k) { sections[k].hidden = (k !== mode); });
    if (mode === 'users') loadUsers();
  }

  function renderDepartments(departments) {
    deptList.innerHTML = '';
    departments.forEach(function (d) {
      var row = document.createElement('div');
      row.className = 'dept-check-row';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = 'dept-' + d.id; cb.value = d.id;
      cb.checked = st.depts.has(d.id);
      cb.addEventListener('change', function () { cb.checked ? st.depts.add(d.id) : st.depts.delete(d.id); });
      var label = document.createElement('label');
      label.htmlFor = cb.id; label.textContent = d.name;
      row.appendChild(cb); row.appendChild(label);
      deptList.appendChild(row);
    });
  }

  function updateUsersCount() {
    usersCount.textContent = st.users.size ? ('Отмечено: ' + st.users.size) : 'Никто не отмечен';
  }

  function renderUsers(users) {
    var collator = new Intl.Collator('ru');
    users.sort(function (a, b) { return collator.compare(a.name, b.name); });
    usersList.innerHTML = '';
    users.forEach(function (u) {
      var row = document.createElement('label');
      row.className = 'user-check-row';
      row.dataset.search = (u.name + ' ' + u.email + ' ' + u.id).toLowerCase();
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = u.id;
      cb.checked = st.users.has(u.id);
      cb.addEventListener('change', function () {
        cb.checked ? st.users.add(u.id) : st.users.delete(u.id);
        updateUsersCount();
      });
      var name = document.createElement('span');
      name.className = 'user-check-name'; name.textContent = u.name;
      var email = document.createElement('span');
      email.className = 'user-check-email'; email.textContent = u.email; email.title = u.email;
      var id = document.createElement('span');
      id.className = 'user-check-id'; id.textContent = '#' + u.id;
      row.appendChild(cb); row.appendChild(name); row.appendChild(email); row.appendChild(id);
      usersList.appendChild(row);
    });
    if (!users.length) usersList.innerHTML = '<div class="muted" style="padding:10px">Пользователи не найдены</div>';
    updateUsersCount();
  }

  function loadUsers() {
    if (st.usersLoaded || st.usersLoading) return;
    st.usersLoading = true;
    usersList.innerHTML = '<div class="muted" style="padding:10px">Загрузка списка сотрудников…</div>';
    window.api('GET', 'api/access.php?list=users').then(function (res) {
      st.usersLoaded = true;
      renderUsers(res.users || []);
    }).catch(function (err) {
      usersList.innerHTML = '';
      showError(err.message);
    }).finally(function () { st.usersLoading = false; });
  }

  function filterUsers() {
    var q = userSearch.value.trim().toLowerCase();
    Array.prototype.forEach.call(usersList.children, function (row) {
      row.hidden = !!q && (row.dataset.search || '').indexOf(q) === -1;
    });
  }

  function openAccessModal() {
    showError('');
    st = { depts: new Set(), users: new Set(), usersLoaded: false, usersLoading: false };
    userSearch.value = '';
    deptList.innerHTML = '<div class="muted">Загрузка…</div>';
    usersList.innerHTML = '';
    overlay.hidden = false;

    window.api('GET', 'api/access.php').then(function (res) {
      st.depts = new Set(res.allowedDepartments || []);
      st.users = new Set((res.allowedUsers || []).map(String));
      var radio = document.querySelector('input[name="access-mode"][value="' + res.mode + '"]');
      if (radio) radio.checked = true;
      renderDepartments(res.departments || []);
      showMode(currentMode());
    }).catch(function (err) {
      deptList.innerHTML = '';
      showError(err.message);
    });
  }

  function closeAccessModal() { overlay.hidden = true; }

  function saveAccess() {
    var mode = currentMode();
    var payload = { mode: mode, allowedDepartments: Array.from(st.depts) };
    // Список людей отправляем, только если его открывали: иначе сохранённый не трогаем.
    if (st.usersLoaded) payload.allowedUsers = Array.from(st.users);
    saveBtn.disabled = true;
    showError('');
    window.api('POST', 'api/access.php', payload).then(closeAccessModal).catch(function (err) {
      showError(err.message);
    }).finally(function () { saveBtn.disabled = false; });
  }

  if (accessBtn) {
    if (window.APP_IS_ADMIN) accessBtn.hidden = false;
    accessBtn.addEventListener('click', openAccessModal);
    $('access-modal-cancel').addEventListener('click', closeAccessModal);
    saveBtn.addEventListener('click', saveAccess);
    userSearch.addEventListener('input', filterUsers);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="access-mode"]'), function (r) {
      r.addEventListener('change', function () { showMode(currentMode()); });
    });
  }

  // ── дебаг-кнопка (админ) ─────────────────────────────────────────────────────
  // Показывает результат api/probe-task.php; админ копирует текст и отдаёт ассистенту в чат.
  // Механизм описан в README («Дебаг-кнопка»).
  var debugBtn = $('debug-btn');
  if (debugBtn) {
    var debugOverlay = $('debug-modal-overlay');
    var debugOut = $('debug-output');
    var debugStatus = $('debug-status');

    var runDebug = function () {
      debugOut.value = 'Выполняю…';
      debugStatus.textContent = '';
      window.api('GET', 'api/probe.php').then(function (res) {
        debugOut.value = res.text;
        debugStatus.textContent = (res.ok ? 'Готово' : 'Ошибка в задаче') + ' · ' + res.ms + ' мс · ' + res.text.length + ' симв.';
      }).catch(function (err) {
        debugOut.value = 'Ошибка запроса: ' + err.message;
      });
    };

    var copyDebug = function () {
      var done = function () { debugStatus.textContent = 'Скопировано в буфер обмена'; };
      var fallback = function () {
        debugOut.focus(); debugOut.select();
        try { document.execCommand('copy') ? done() : (debugStatus.textContent = 'Не удалось — выдели текст и нажми Ctrl+C'); }
        catch (e) { debugStatus.textContent = 'Не удалось — выдели текст и нажми Ctrl+C'; }
      };
      // В iframe Б24 Clipboard API может быть запрещён — тогда запасной путь через execCommand.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(debugOut.value).then(done, fallback);
      } else { fallback(); }
    };

    if (window.APP_IS_ADMIN) debugBtn.hidden = false;
    debugBtn.addEventListener('click', function () { debugOverlay.hidden = false; runDebug(); });
    $('debug-modal-rerun').addEventListener('click', runDebug);
    $('debug-modal-copy').addEventListener('click', copyDebug);
    $('debug-modal-close').addEventListener('click', function () { debugOverlay.hidden = true; });
  }
})();

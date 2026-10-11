// График модулей: таблица этапов→модулей + Гант + режимы правки (B4).
// Данные — из api/graph.php (стадии/цвета считаются на сервере), правки копятся
// локально и отправляются одним POST action=save.
//
// Каркас шаблона сохранён: сессия (window.APP_SESSION), окно «Доступ», дебаг-кнопка.

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  }); };

  // Helper для вызовов нашего бэкенда с прикреплённым session-token.
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

  // ── кнопка «Плейсменты» (админ): привязать вкладку карточки смарт-процесса ───
  var bindBtn = $('bind-btn');
  if (bindBtn) {
    if (window.APP_IS_ADMIN) bindBtn.hidden = false;
    bindBtn.addEventListener('click', function () {
      bindBtn.disabled = true;
      var old = bindBtn.textContent;
      bindBtn.textContent = 'Привязываю…';
      window.api('GET', 'api/bind.php?format=json').then(function (res) {
        var lines = [];
        var okAll = res.ok !== false;
        Object.keys(res.results || {}).forEach(function (code) {
          var r = res.results[code];
          lines.push(code + ': ' + (r.ok ? 'привязан' : 'ОШИБКА ' + (r.error || '')));
          if (!r.ok) okAll = false;
        });
        showToast(okAll ? 'Плейсменты привязаны — открой карточку сделки' : 'Ошибка привязки: ' + lines.join('; '));
      }).catch(function (err) {
        showToast('Ошибка запроса: ' + err.message);
      }).then(function () {
        bindBtn.disabled = false;
        bindBtn.textContent = old;
      });
    });
  }

  // ── График модулей ──────────────────────────────────────────────────────────

  var parseD = function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  var fmtD = function (d) { return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2); };
  var fmtDyy = function (d) { return fmtD(d) + '.' + String(d.getFullYear()).slice(-2); };
  /* дд.мм.гг → ISO; null, если неполно или неверная дата. */
  function parseDyy(s) {
    var m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec((s || '').trim());
    if (!m) return null;
    var iso = '20' + m[3] + '-' + m[2] + '-' + m[1];
    var d = parseD(iso);
    return (d.getDate() === +m[1] && d.getMonth() + 1 === +m[2]) ? iso : null;
  }
  /* Подпись года для верхней полосы календаря (год на первой колонке года). */
  function yearLabels(cols) {
    return cols.map(function (iso, i) {
      var y = parseD(iso).getFullYear(), prev = i ? parseD(cols[i - 1]).getFullYear() : null;
      return (i === 0 || prev !== y) ? String(y) : '';
    });
  }
  var MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var DAY_MS = 24 * 3600 * 1000;

  /* ── Чистая логика (перенос из макета) ───────────────────────────────── */

  /* Длительность разработки «Р»: datediff(check, create) + 1 дней. */
  function runDays(m) {
    if (!m.check || !m.create) return '';
    return Math.round((parseD(m.create) - parseD(m.check)) / DAY_MS) + 1;
  }

  function cellValue(m, key) {
    if (key === 'title') return m.title;
    if (key === 'check' || key === 'create') return m[key] ? fmtD(parseD(m[key])) : '—';
    if (key === 'run') return runDays(m) === '' ? '—' : runDays(m);
    return (m.check && m.create) ? String(m[key]) : '—';
  }

  function sortKey(m, key) {
    if (key === 'title') return m.title;
    if (key === 'status') return STATUS_ORDER.indexOf(m.status);
    if (key === 'check' || key === 'create') return m[key] || null;
    if (key === 'run') { var r = runDays(m); return r === '' ? null : r; }
    return (m.check && m.create) ? m[key] : null;
  }

  function sortModules(mods, key, dir) {
    var mul = dir === -1 ? -1 : 1;
    return mods.slice().sort(function (a, b) {
      var va = sortKey(a, key), vb = sortKey(b, key);
      var ea = (va === null), eb = (vb === null);
      if (ea !== eb) return ea ? 1 : -1;
      if (ea && eb) return 0;
      if (va < vb) return -1 * mul;
      if (va > vb) return 1 * mul;
      return 0;
    });
  }

  function tableRows(stages, modules, collapsedSet) {
    var rows = [];
    stages.forEach(function (stg) {
      rows.push({ type: 'stage', stage: stg, open: !collapsedSet.has(stg.id) });
      if (!collapsedSet.has(stg.id)) {
        sortModules(modules.filter(function (m) { return m.parentStageId === stg.id; }), sortState.key, sortState.dir)
          .forEach(function (m) { rows.push({ type: 'module', module: m, stage: stg }); });
      }
    });
    return rows;
  }

  /* ── Гант: масштаб, сетка, полосы ────────────────────────────────────── */

  var STEP_MAP = { '1d': 1, '1w': 7, '2w': 14, '3w': 21, '4w': 28 };
  /* Порядок стадий воронки (для сортировки по статусу); аббревиатуры — с сервера. */
  var STATUS_ORDER = ['Зап', 'Расм', 'Разр', 'Корр', 'Ожид', 'Согл', 'Завр', 'Анну'];
  /* Завершённые стадии (низкий акцент); тёмный фон плашки — белый текст. */
  var STATUS_COMPLETED = ['Завр', 'Анну'];
  var STATUS_DARK_BG = ['Зап'];

  function stepDaysOf(step) { return STEP_MAP[step] || 7; }

  var isoOf = function (d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  };
  function addDaysIso(iso, n) { var d = parseD(iso); d.setDate(d.getDate() + n); return isoOf(d); }
  function daysBetween(isoA, isoB) { return Math.round((parseD(isoB) - parseD(isoA)) / DAY_MS); }

  function defaultOffsetIso(minIso, step) {
    if (!minIso) return null;
    return addDaysIso(minIso, -stepDaysOf(step));
  }

  function buildCols(offsetIso, step, lastIso) {
    var sd = stepDaysOf(step);
    var span = Math.max(0, daysBetween(offsetIso, lastIso || offsetIso));
    var n = Math.max(6, Math.ceil((span + 1) / sd));
    var cols = [];
    for (var i = 0; i < n; i++) cols.push(addDaysIso(offsetIso, i * sd));
    return cols;
  }

  function barColumns(offsetIso, step, nCols, startIso, endIso) {
    var sd = stepDaysOf(step);
    if (daysBetween(offsetIso, endIso) < 0) return { start: 0, width: 0, visible: false };
    var start = Math.floor(daysBetween(offsetIso, startIso) / sd);
    var end = Math.floor(daysBetween(offsetIso, endIso) / sd);
    var clippedLeft = start < 0;
    start = Math.max(0, start);
    end = Math.min(nCols - 1, end);
    var width = Math.max(1, end - start + 1);
    return { start: start, width: width, visible: true, clippedLeft: clippedLeft };
  }

  /* 6 диапазонов стадий модуля (правила из ТЗ):
     Запуск: dstart этапа → runD; Рассмотрение: runD → check; Разработка: check → create;
     Корректировка: create → +dayEdit; Ожидание: → +dayWait; Согласование: → +dayApprove.
     runD: хранимый m.runD; если dayRun правлен (или runD пуст) — из dstart + dayRun. */
  function barsForModule(m, stages, editsMap) {
    var stg = (stages || []).find(function (s) { return s.id === (m.parentStageId || m.stageId); });
    var dstart = stg && stg.dstart;
    var dayRunEdited = editsMap && editsMap[m.id] && Object.prototype.hasOwnProperty.call(editsMap[m.id], 'dayRun');
    var runD = (dstart && (dayRunEdited || !m.runD)) ? addDaysIso(dstart, m.dayRun || 0) : (m.runD || null);
    if (!m.check || !m.create) {
      var noDates = [];
      if (dstart && runD) noDates.push({ key: 'run', kind: 'secondary', title: 'Запуск', start: dstart, end: runD });
      return noDates;
    }
    var out = [];
    if (runD) out.push({ key: 'run', kind: 'secondary', title: 'Запуск', start: dstart, end: runD });
    if (runD && runD <= m.check) out.push({ key: 'ras', kind: 'secondary', title: 'Рассмотрение', start: runD, end: m.check });
    out.push({ key: 'main', kind: 'accent', title: 'Разработка', start: m.check, end: m.create });
    var editEnd = addDaysIso(m.create, Number(m.dayEdit) || 0);
    if (Number(m.dayEdit) > 0) out.push({ key: 'edit', kind: 'secondary', title: 'Корректировка', start: m.create, end: editEnd });
    var waitEnd = addDaysIso(editEnd, Number(m.dayWait) || 0);
    if (Number(m.dayWait) > 0) out.push({ key: 'wait', kind: 'secondary', title: 'Ожидание', start: editEnd, end: waitEnd });
    var apprEnd = addDaysIso(waitEnd, Number(m.dayApprove) || 0);
    if (Number(m.dayApprove) > 0) out.push({ key: 'approve', kind: 'secondary', title: 'Согласование', start: waitEnd, end: apprEnd });
    return out;
  }

  function moduleDateBounds(mods, stages, editsMap) {
    var min = null, max = null;
    mods.forEach(function (m) {
      barsForModule(m, stages, editsMap).forEach(function (b) {
        if (!min || b.start < min) min = b.start;
        if (!max || b.end > max) max = b.end;
      });
    });
    return { min: min, max: max };
  }

  function monthLabels(cols) {
    return cols.map(function (iso, i) {
      var d = parseD(iso), prev = i ? parseD(cols[i - 1]) : null;
      return (i === 0 || prev.getMonth() !== d.getMonth()) ? MONTHS[d.getMonth()] : '';
    });
  }

  function todayIndex(cols, step) {
    var sd = stepDaysOf(step), today = isoOf(new Date());
    for (var i = 0; i < cols.length; i++) {
      if (daysBetween(cols[i], today) >= 0 && daysBetween(today, addDaysIso(cols[i], sd)) > 0) return i;
    }
    return -1;
  }

  /* ── Режимы правки: карта правок ─────────────────────────────────────── */

  var edits = {};

  function effModule(m, editsMap) {
    return Object.assign({}, m, editsMap[m.id] || {});
  }

  function effValue(m, editsMap, key) {
    return effModule(m, editsMap)[key];
  }

  function setEdit(m, editsMap, key, value) {
    var src = m[key];
    var srcEmpty = src === undefined || src === null || src === '';
    var vEmpty = value === undefined || value === null || value === '';
    var drop = function () {
      if (!editsMap[m.id]) return;
      delete editsMap[m.id][key];
      if (!Object.keys(editsMap[m.id]).length) delete editsMap[m.id];
    };
    if (vEmpty) {
      if (srcEmpty) drop();
      else { if (!editsMap[m.id]) editsMap[m.id] = {}; editsMap[m.id][key] = ''; }
    } else if (String(value) === String(src)) {
      drop();
    } else {
      if (!editsMap[m.id]) editsMap[m.id] = {};
      editsMap[m.id][key] = value;
    }
    return editsMap;
  }

  function countPending(editsMap) { return Object.keys(editsMap).length; }

  function applyGroup(mods, editsMap, winValues) {
    var filled = {};
    Object.keys(winValues).forEach(function (k) {
      var v = winValues[k];
      if (v !== '' && v !== null && v !== undefined) filled[k] = v;
    });
    if (!Object.keys(filled).length) return editsMap;
    mods.forEach(function (m) {
      Object.keys(filled).forEach(function (k) { setEdit(m, editsMap, k, filled[k]); });
    });
    return editsMap;
  }

  function stageCheckState(stage, mods) {
    var list = mods.filter(function (m) { return m.parentStageId === stage.id; });
    var n = list.filter(function (m) { return m._checked; }).length;
    if (n === 0) return 'none';
    if (n === list.length) return 'all';
    return 'partial';
  }

  function stageSetChecked(stage, mods, checkedSet, on) {
    mods.filter(function (m) { return m.parentStageId === stage.id; })
      .forEach(function (m) { if (on) checkedSet.add(m.id); else checkedSet.delete(m.id); });
  }

  function checkedCount(checkedSet) { return checkedSet.size; }

  /* ── Валидация перед отправкой ───────────────────────────────────────── */

  var DUR_KEYS = ['dayRun', 'dayEdit', 'dayWait', 'dayApprove'];

  function validateEdits(dealData, editsMap) {
    var errs = [];
    dealData.modules.forEach(function (m) {
      var ed = editsMap[m.id];
      if (!ed || !Object.keys(ed).length) return;
      var eff = Object.assign({}, m, ed);
      if (eff.check && eff.create && daysBetween(eff.check, eff.create) < 0) {
        errs.push({ moduleId: m.id, field: 'check', msg: 'Рассмотрение позже Разработки' });
        errs.push({ moduleId: m.id, field: 'create', msg: 'Разработка раньше Рассмотрения' });
      }
      DUR_KEYS.forEach(function (k) {
        var v = eff[k];
        if (v === undefined || v === null || v === '') {
          errs.push({ moduleId: m.id, field: k, msg: 'Длительность не задана' });
        } else if (typeof v !== 'number' || !isFinite(v)) {
          errs.push({ moduleId: m.id, field: k, msg: 'Не число' });
        } else if (v < 0) {
          errs.push({ moduleId: m.id, field: k, msg: 'Отрицательная длительность' });
        }
      });
    });
    return errs;
  }

  function clearEdits(editsMap) {
    Object.keys(editsMap).forEach(function (id) { delete editsMap[id]; });
    return editsMap;
  }

  /* ── Состояние и данные ──────────────────────────────────────────────── */

  var sortState = { key: 'title', dir: 1 };
  var collapsed = new Set();

  /* dealId из placement-контекста: B24 передаёт параметры placement в URL iframe
     (ID / dealId / PARAMS[ID] — URI-закодированный JSON). */
  function getDealId() {
    // 1) placement-контекст: index.php распарсил POST PLACEMENT_OPTIONS (ID)
    if (window.APP_DEAL_ID && /^\d{1,12}$/.test(String(window.APP_DEAL_ID))) return String(window.APP_DEAL_ID);
    // 2) query-параметры (открытие с ?dealId=…)
    var q = new URLSearchParams(location.search);
    var id = q.get('dealId') || q.get('ID') || '';
    if (!id) {
      var raw = q.get('PARAMS') || '';
      if (raw) {
        try {
          var p = JSON.parse(raw);
          id = p && (p.ID || p.id) || '';
        } catch (e) { id = ''; }
      }
    }
    return /^\d{1,12}$/.test(String(id).trim()) ? String(id).trim() : null;
  }

  var dealId = getDealId();
  var deal = { stages: [], modules: [] };
  var loadPanel = $('loadPanel'), loadMsg = $('loadMsg');

  /* Модуль ответа сервера → нормализованный объект (id-этап строкой, даты ISO,
     длительности — числа; пустые UF — ''). */
  function normDate(v) { return v ? String(v).slice(0, 10) : ''; }
  function normDur(v) {
    if (v === '' || v === null || v === undefined) return '';
    var n = Number(v);
    return isFinite(n) ? n : '';
  }
  function normalizeModule(m) {
    var stageId = m.stageId === null || m.stageId === undefined ? '' : String(m.stageId);
    return {
      id: String(m.id),
      title: m.title || '',
      num: m.num || '',
      sname: m.sname || '',
      stageId: stageId,
      parentStageId: stageId,
      status: m.status || '',
      statusColor: m.statusColor || '#ccc',
      check: normDate(m.check),
      create: normDate(m.create),
      runD: normDate(m.runD),
      editD: normDate(m.editD),
      waitD: normDate(m.waitD),
      approveD: normDate(m.approveD),
      dayRun: normDur(m.dayRun),
      dayEdit: normDur(m.dayEdit),
      dayWait: normDur(m.dayWait),
      dayApprove: normDur(m.dayApprove),
    };
  }

  function showLoad(msg) {
    loadMsg.textContent = msg;
    loadPanel.hidden = false;
    showToast(msg);
  }

  function loadDeal() {
    loadPanel.hidden = true;
    $('errorPanel').hidden = true;
    if (!dealId) {
      $('dealTitle').textContent = 'Сделка не определена';
      showLoad('Не удалось определить сделку — открой приложение из карточки смарт-процесса.');
      return;
    }
    $('chartBody').innerHTML = '<div class="row data"><div class="name">Загрузка…</div></div>';
    window.api('GET', 'api/graph.php?dealId=' + encodeURIComponent(dealId)).then(function (res) {
      if (!res || res.ok === false) {
        throw new Error(res && res.error === 'access' ? 'Нет доступа' : 'Ошибка загрузки данных');
      }
      deal.stages = (res.stages || []).map(function (s) {
        return { id: String(s.id), title: s.title || '', dstart: normDate(s.dstart), dfinish: normDate(s.dfinish) };
      });
      deal.modules = (res.modules || []).map(normalizeModule);
      clearEdits(edits);
      state.checked.clear();
      hScrolledByUser = false;
      $('dealTitle').textContent = 'Сделка #' + dealId;
      var empty = deal.modules.length === 0;
      $('emptyNote').hidden = !empty;
      $('chart').hidden = empty;
      render();
    }).catch(function (err) {
      $('chart').hidden = true;
      $('emptyNote').hidden = true;
      showLoad(err.message === 'access' ? 'Нет доступа' : 'Ошибка загрузки: ' + err.message);
    });
  }

  /* ── DOM: рендер (перенос из макета) ─────────────────────────────────── */

  var COL_W = 36;
  var state = {
    step: '1w', offset: null,
    mode: 'single',
    checked: new Set()
  };

  var EDIT_FIELDS = [
    { key: 'dayRun', type: 'number' },
    { key: 'check', type: 'date' },
    { key: 'create', type: 'date' },
    { key: 'dayEdit', type: 'number' },
    { key: 'dayWait', type: 'number' },
    { key: 'dayApprove', type: 'number' }
  ];

  function setGridCols(nCols) {
    var lead = state.mode === 'group' ? '30px ' : '';
    document.documentElement.style.setProperty('--grid-cols',
      lead + 'minmax(170px, 210px) 46px 36px 84px 84px 84px 34px 34px 34px repeat(' + nCols + ', ' + COL_W + 'px)');
  }

  function editCell(m, f) {
    var v = effValue(m, edits, f.key);
    var val = (v === undefined || v === null) ? '' : v;
    var ro = state.mode === 'group' ? ' readonly' : '';
    var edited = edits[m.id] && Object.prototype.hasOwnProperty.call(edits[m.id], f.key);
    if (f.type === 'date') {
      var shown = val ? fmtDyy(parseD(val)) : '';
      return '<div class="cell-edit' + (edited ? ' is-edited' : '') + '">' +
        '<input class="cell-input date-input" type="text" inputmode="numeric" maxlength="8" placeholder="дд.мм.гг"' +
        ' data-module="' + esc(m.id) + '" data-field="' + f.key + '" data-type="date"' +
        ' value="' + esc(shown) + '"' + ro + '></div>';
    }
    return '<div class="' + (f.type === 'number' ? 'num ' : '') + 'cell-edit' + (edited ? ' is-edited' : '') + '">' +
      '<input class="cell-input" type="' + f.type + '" data-module="' + esc(m.id) + '" data-field="' + f.key + '"' +
      ' value="' + esc(val) + '"' + ro + '></div>';
  }

  function isDoneStatus(m) { return STATUS_COMPLETED.indexOf(m.status) !== -1; }

  function barsFor(m, offsetIso, cols, dim, withFlag, icon) {
    var bars = barsForModule(m, deal.stages, edits);
    var html = bars.map(function (b) {
      var p = barColumns(offsetIso, state.step, cols.length, b.start, b.end);
      if (!p.visible) return '';
      return '<div class="gantt-bar ' + b.kind + (dim ? ' dimmed' : '') + '" style="left:' + (p.start * COL_W) + 'px;width:' +
        (p.width * COL_W - 2) + 'px" title="' + esc(b.title) + '"></div>';
    }).join('');
    var flag = '';
    if (withFlag && bars.length) {
      var last = bars[bars.length - 1];
      var pf = barColumns(offsetIso, state.step, cols.length, last.start, last.end);
      flag = pf.visible ? '<div class="gantt-flag" style="left:' + (pf.start * COL_W + pf.width * COL_W) + 'px" title="' + (icon === '🗑️' ? 'Работы аннулированы' : 'Все модули завершены') + '">' + icon + '</div>' : '';
    }
    return html + flag;
  }

  function ganttCells(cols, offsetIso, barsHtml) {
    var ti = todayIndex(cols, state.step);
    var out = '<div class="gantt-track" style="grid-column: span ' + cols.length + '; width:' + (cols.length * COL_W) + 'px">';
    cols.forEach(function (_, i) { out += '<div class="gantt-cell" style="left:' + (i * COL_W) + 'px;width:' + COL_W + 'px"></div>'; });
    if (ti >= 0) out += '<div class="gantt-today" style="left:' + (ti * COL_W + COL_W / 2) + 'px" title="Сегодня"></div>';
    out += barsHtml || '';
    return out + '</div>';
  }

  function ganttHeadCells(cls, cols) {
    var isYears = cls === 'h-year', isMonths = cls === 'h-month';
    var labels = isYears ? yearLabels(cols) : (isMonths ? monthLabels(cols) : null);
    var out = '<div class="' + cls + ' gantt-track" style="grid-column: span ' + cols.length + '; width:' + (cols.length * COL_W) + 'px">';
    if (labels) {
      for (var i = 0; i < cols.length; i++) {
        if (!labels[i]) continue;
        var span = 1;
        while (i + span < cols.length && !labels[i + span]) span++;
        out += '<div style="position:absolute;left:' + (i * COL_W) + 'px;width:' + (span * COL_W - 4) + 'px;overflow:hidden;white-space:nowrap">' + esc(labels[i]) + '</div>';
      }
    } else {
      cols.forEach(function (iso, i) {
        out += '<div style="position:absolute;left:' + (i * COL_W) + 'px;width:' + COL_W + 'px;overflow:hidden;white-space:nowrap;text-align:center;box-sizing:border-box;border-left:1px solid var(--border)">' + parseD(iso).getDate() + '</div>';
      });
    }
    return out + '</div>';
  }

  var HEAD_COLS = [
    { label: 'Статус', cls: '', key: 'status', title: 'Стадия модуля по воронке (цвета — из Б24)' },
    { label: 'З', cls: 'num', key: 'dayRun', title: 'Запуск — рабочих дней от старта до начала Рассмотрения' },
    { label: 'Рассмотр.', cls: '', key: 'check', title: 'Дата начала Рассмотрения (стадия модуля)' },
    { label: 'Разработка', cls: '', key: 'create', title: 'Дата завершения Разработки — конец работ по модулю' },
    { label: 'К', cls: 'num', key: 'dayEdit', title: 'Корректировка — рабочих дней после Разработки' },
    { label: 'О', cls: 'num', key: 'dayWait', title: 'Ожидание — рабочих дней после Корректировки' },
    { label: 'С', cls: 'num', key: 'dayApprove', title: 'Согласование — рабочих дней после Ожидания' },
    { label: 'Р', cls: 'num', key: 'run', title: 'Длительность разработки — календарных дней от Рассмотрения до Разработки' }
  ];
  var NAME_TITLE = 'Название модуля: код объекта, номер, шифр раздела. Сортировка — клик по заголовку колонки.';

  function renderHead(cols) {
    var ind = function (k) { return sortState.key === k ? (sortState.dir === 1 ? ' ↑' : ' ↓') : ''; };
    var chk = state.mode === 'group' ? '<div class="h-cell chk-cell"></div>' : '';
    $('chartHead').innerHTML =
      '<div class="row head">' +
        chk +
        '<div class="h-cell h-year name"></div>' +
        HEAD_COLS.map(function () { return '<div class="h-cell h-year"></div>'; }).join('') +
        ganttHeadCells('h-year', cols) +
      '</div>' +
      '<div class="row head">' +
        chk +
        '<div class="h-cell h-month name"></div>' +
        HEAD_COLS.map(function () { return '<div class="h-cell h-month"></div>'; }).join('') +
        ganttHeadCells('h-month', cols) +
      '</div>' +
      '<div class="row head">' +
        chk +
        '<div class="h-cell h-title name" title="' + NAME_TITLE + '">Этап / модуль</div>' +
        HEAD_COLS.map(function (c) {
          return '<div class="h-cell h-title ' + c.cls + ' sort-btn" data-sort="' + c.key + '" title="' + c.title + '. Сортировать">' +
          c.label + ind(c.key) + '</div>';
        }).join('') +
        ganttHeadCells('h-title', cols) +
      '</div>';
  }

  function stageCheckbox(stg) {
    var st8 = stageCheckState(stg, deal.modules);
    var attr = st8 === 'all' ? ' checked' : '';
    var ind = st8 === 'partial' ? ' data-ind="1"' : '';
    return '<div class="chk-cell"><input type="checkbox" class="stage-chk" data-stage="' + esc(stg.id) + '"' + attr + ind + '></div>';
  }

  function moduleEmphasis() {
    var anyAnnul = deal.modules.some(function (m) { return m.status === 'Анну'; });
    var activeIdx = deal.modules.findIndex(function (m) { return !isDoneStatus(m); });
    var allDone = activeIdx === -1;
    var flagId = null;
    if (allDone) {
      var maxEnd = null;
      deal.modules.forEach(function (m) {
        barsForModule(m, deal.stages, edits).forEach(function (b) {
          if (maxEnd === null || b.end > maxEnd) { maxEnd = b.end; flagId = m.id; }
        });
      });
    }
    return {
      allDone: allDone, flagId: flagId, icon: anyAnnul ? '🗑️' : '🏁',
      dimmedById: function (id) {
        var m = deal.modules.find(function (x) { return x.id === id; });
        return m ? isDoneStatus(m) : false;
      }
    };
  }

  /* Статус и цвет — из ответа сервера (status/statusColor), не локальная карта. */
  function statusBadge(m) {
    var fg = STATUS_DARK_BG.indexOf(m.status) !== -1 ? '#fff' : '#10233b';
    return '<div class="st-cell" title="Стадия модуля по воронке"><span class="st-badge" style="background:' + esc(m.statusColor) + ';color:' + fg + '">' + esc(m.status) + '</span></div>';
  }

  function renderBody(cols, offsetIso) {
    var html = '';
    var em = moduleEmphasis();
    tableRows(deal.stages, deal.modules, collapsed).forEach(function (r) {
      if (r.type === 'stage') {
        var df = r.stage.dfinish;
        var chk = state.mode === 'group' ? stageCheckbox(r.stage) : '';
        html += '<div class="row data stage" data-stage="' + esc(r.stage.id) + '" title="Свернуть/развернуть модули">' +
          chk +
          '<div class="name stage-name"><span class="stage-toggle">' + (r.open ? '▾' : '▸') + '</span> ' + esc(r.stage.title) + '</div>' +
          '<div class="st-cell"></div>' +
          '<div class="num muted-note"></div><div></div><div></div>' +
          '<div class="kp-note">по КП: ' + esc(df ? fmtDyy(parseD(df)) : '—') + '</div><div></div><div></div><div></div>' +
          ganttCells(cols, offsetIso) + '</div>';
      } else {
        var m = effModule(r.module, edits);
        var chk2 = state.mode === 'group'
          ? '<div class="chk-cell"><input type="checkbox" class="mod-chk" data-module="' + esc(m.id) + '"' +
            (state.checked.has(m.id) ? ' checked' : '') + '></div>'
          : '';
        var dim = em.dimmedById(m.id);
        var withFlag = em.allDone && em.flagId === m.id;
        html += '<div class="row data module' + (dim ? ' is-done' : '') + '" data-module="' + esc(m.id) + '">' +
          chk2 +
          '<div class="name" title="' + esc(m.title) + '">' + esc(m.num) + ' · ' + esc(m.sname) + '</div>' +
          statusBadge(m) +
          EDIT_FIELDS.map(function (f) { return editCell(m, f); }).join('') +
          '<div class="num run-cell">' + esc(cellValue(m, 'run')) + '</div>' +
          ganttCells(cols, offsetIso, barsFor(m, offsetIso, cols, dim, withFlag, em.icon)) + '</div>';
      }
    });
    $('chartBody').innerHTML = html;
    document.querySelectorAll('.stage-chk[data-ind]').forEach(function (el) { el.indeterminate = true; });
  }

  function updateGroupBar() {
    var n = checkedCount(state.checked);
    $('gwApply').textContent = 'Применить к отмеченным (' + n + ')';
    $('gwApply').disabled = n < 1;
  }

  function updateChangesCounter() {
    var n = countPending(edits);
    $('changesCounter').textContent = 'Изменений: ' + n;
    updateOver99();
    updateValidation(n);
  }

  function updateValidation(n) {
    var errs = validateEdits(deal, edits);
    var badMods = new Set(errs.map(function (e) { return e.moduleId; }));
    var badCells = new Set(errs.map(function (e) { return e.moduleId + '|' + e.field; }));
    document.querySelectorAll('#chartBody .row.module').forEach(function (row) {
      row.classList.toggle('is-error', badMods.has(row.dataset.module));
      row.querySelectorAll('.cell-edit .cell-input').forEach(function (inp) {
        inp.closest('.cell-edit').classList.toggle('is-error',
          badCells.has(row.dataset.module + '|' + inp.dataset.field));
      });
    });
    var panel = $('errorPanel');
    panel.hidden = !errs.length;
    panel.innerHTML = errs.length
      ? '<b>Ошибки валидации — отправка заблокирована:</b><ul>' + errs.map(function (e) {
          var m = deal.modules.find(function (x) { return x.id === e.moduleId; });
          return '<li>' + esc(m ? (m.num + ' · ' + m.sname) : e.moduleId) + ' — ' +
            esc(e.field) + ': ' + esc(e.msg) + '</li>';
        }).join('') + '</ul>'
      : '';
    $('sendBtn').disabled = n < 1 || errs.length > 0;
    $('cancelBtn').disabled = n < 1;
  }

  function updateGantt() {
    var bounds = moduleDateBounds(deal.modules.map(function (m) { return effModule(m, edits); }), deal.stages, edits);
    var input = $('offsetInput').value;
    var offsetIso = input || defaultOffsetIso(bounds.min, state.step) || isoOf(new Date());
    if (!input) $('offsetInput').value = offsetIso;
    var cols = buildCols(offsetIso, state.step, bounds.max);
    setGridCols(cols.length);
    renderHead(cols);
    var em = moduleEmphasis();
    document.querySelectorAll('#chartBody .row.module, #chartBody .row.stage').forEach(function (row) {
      row.querySelectorAll('.gantt-track, .gantt-bar, .gantt-flag').forEach(function (el) { el.remove(); });
      if (row.classList.contains('stage')) {
        row.insertAdjacentHTML('beforeend', ganttCells(cols, offsetIso));
        return;
      }
      var raw = deal.modules.find(function (x) { return x.id === row.dataset.module; });
      if (!raw) return;
      var m = effModule(raw, edits);
      var withFlag = em.allDone && em.flagId === m.id;
      row.insertAdjacentHTML('beforeend', ganttCells(cols, offsetIso, barsFor(m, offsetIso, cols, em.dimmedById(m.id), withFlag, em.icon)));
      var run = row.querySelector('.run-cell');
      if (run) run.textContent = cellValue(m, 'run');
    });
    updateChangesCounter();
  }

  function render() {
    var bounds = moduleDateBounds(deal.modules.map(function (m) { return effModule(m, edits); }), deal.stages, edits);
    var input = $('offsetInput').value;
    var offsetIso = input || defaultOffsetIso(bounds.min, state.step) || isoOf(new Date());
    if (!input) $('offsetInput').value = offsetIso;
    var cols = buildCols(offsetIso, state.step, bounds.max);
    setGridCols(cols.length);
    renderHead(cols);
    renderBody(cols, offsetIso);
    updateGroupBar();
    updateChangesCounter();
    ensureBarsVisible(bounds);
  }

  var hScrolledByUser = false;
  function ensureBarsVisible(bounds) {
    if (hScrolledByUser || !bounds.min) return;
    var chart = $('chart');
    var track = document.querySelector('#chartBody .row.data .gantt-track');
    if (!track) return;
    var ganttStart = track.offsetLeft;
    var stepDays = stepDaysOf(state.step);
    var firstCol = Math.max(0, Math.floor(daysBetween(bounds.min, $('offsetInput').value || bounds.min) / stepDays));
    var barX = ganttStart + firstCol * COL_W;
    chart.scrollLeft = barX > chart.clientWidth ? Math.min(barX - 250, chart.scrollWidth - chart.clientWidth) : 0;
  }
  $('chart').addEventListener('scroll', function () {
    if ($('chart').scrollLeft > 4) hScrolledByUser = true;
  }, { passive: true });

  $('chartHead').addEventListener('click', function (e) {
    var btn = e.target.closest('.sort-btn');
    if (!btn) return;
    var key = btn.dataset.sort;
    if (sortState.key === key) sortState.dir = -sortState.dir;
    else { sortState.key = key; sortState.dir = 1; }
    render();
  });
  $('chartBody').addEventListener('click', function (e) {
    if (e.target.closest('.stage-chk, input[type=checkbox]')) return;
    var row = e.target.closest('.row.stage');
    if (!row) return;
    var id = row.dataset.stage;
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    render();
  });

  document.querySelectorAll('.scale-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.step = btn.dataset.step;
      hScrolledByUser = false;
      document.querySelectorAll('.scale-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      render();
    });
  });

  $('offsetInput').addEventListener('change', function () { hScrolledByUser = false; render(); });

  /* ── Режимы правки ───────────────────────────────────────────────────── */

  document.querySelectorAll('.mode-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var mode = btn.dataset.mode;
      if (mode === state.mode) return;
      state.mode = mode;
      document.querySelectorAll('.mode-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      $('groupEntry').hidden = mode !== 'group';
      $('chartInner').classList.toggle('group-mode', mode === 'group');
      render();
    });
  });

  $('chartBody').addEventListener('input', function (e) {
    var inp = e.target;
    if (inp.classList.contains('cell-input')) {
      var m = deal.modules.find(function (x) { return x.id === inp.dataset.module; });
      var key = inp.dataset.field;
      if (!m) return;
      if (inp.dataset.type === 'date') {
        var iso = parseDyy(inp.value);
        if (inp.value.trim() === '') setEdit(m, edits, key, '');
        else if (iso) setEdit(m, edits, key, iso);
        else return;
      } else {
        var v = inp.type === 'number' && inp.value !== '' ? Number(inp.value) : inp.value;
        setEdit(m, edits, key, v);
      }
      var cell = inp.closest('.cell-edit');
      if (cell) cell.classList.toggle('is-edited',
        !!(edits[m.id] && Object.prototype.hasOwnProperty.call(edits[m.id], key)));
      updateGantt();
      return;
    }
    if (inp.classList.contains('mod-chk')) {
      var id = inp.dataset.module;
      if (inp.checked) state.checked.add(id); else state.checked.delete(id);
      render();
      return;
    }
    if (inp.classList.contains('stage-chk')) {
      var stg = deal.stages.find(function (s) { return s.id === inp.dataset.stage; });
      var on = stageCheckState(stg, deal.modules) !== 'all';
      stageSetChecked(stg, deal.modules, state.checked, on);
      render();
    }
  });

  $('chartBody').addEventListener('focusout', function (e) {
    var inp = e.target;
    if (!inp.classList || !inp.classList.contains('date-input')) return;
    var m = deal.modules.find(function (x) { return x.id === inp.dataset.module; });
    if (!m) return;
    var iso = effValue(m, edits, inp.dataset.field);
    inp.value = iso ? fmtDyy(parseD(iso)) : '';
  });

  function updateOver99() {
    var bad = new Set();
    deal.modules.forEach(function (m) {
      var eff = effModule(m, edits);
      DUR_KEYS.forEach(function (k) { if (typeof eff[k] === 'number' && eff[k] > 99) bad.add(m.id + '|' + k); });
    });
    document.querySelectorAll('#chartBody .row.module').forEach(function (row) {
      row.querySelectorAll('.cell-edit .cell-input').forEach(function (inp) {
        inp.closest('.cell-edit').classList.toggle('is-over99',
          bad.has(row.dataset.module + '|' + inp.dataset.field));
      });
    });
    DUR_KEYS.forEach(function (k) {
      var el = $('gw-' + k);
      if (el) el.classList.toggle('is-over99', Number(el.value) > 99);
    });
  }

  $('gwApply').addEventListener('click', function () {
    var win = {};
    EDIT_FIELDS.forEach(function (f) {
      var el = $('gw-' + f.key);
      if (!el || el.value === '') return;
      if (f.type === 'date') { var iso = parseDyy(el.value); if (iso) win[f.key] = iso; }
      else win[f.key] = Number(el.value);
    });
    var targets = deal.modules.filter(function (m) { return state.checked.has(m.id); });
    applyGroup(targets, edits, win);
    EDIT_FIELDS.forEach(function (f) { var el = $('gw-' + f.key); if (el) el.value = ''; });
    render();
  });
  $('groupEntry').addEventListener('input', function (e) {
    if (e.target.classList.contains('cell-input') || e.target.tagName === 'INPUT') updateOver99();
  });

  /* ── Отправка / отмена ───────────────────────────────────────────────── */

  /* Диалог подтверждения (самодельный, как в макете). */
  function confirmAsk(title, text, onYes) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-overlay').hidden = false;
    $('confirm-yes').onclick = function () { $('confirm-overlay').hidden = true; onYes(); };
  }
  $('confirm-no').onclick = function () { $('confirm-overlay').hidden = true; };
  $('confirm-overlay').addEventListener('click', function (e) {
    if (e.target === $('confirm-overlay')) $('confirm-overlay').hidden = true;
  });

  var toastTimer = null;
  function showToast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2500);
  }

  /* Правки → UF-поля: check→UF_CRM_14_MOD_CHECK, create→…_CREATE,
     dayRun→…_DAY2_RUN, dayEdit/dayWait/dayApprove→…_DAY2_*. Даты — ISO,
     пустые — '' (очистка поля). */
  var FIELD_MAP = {
    check: 'UF_CRM_14_MOD_CHECK',
    create: 'UF_CRM_14_MOD_CREATE',
    dayRun: 'UF_CRM_14_MOD_DAY2_RUN',
    dayEdit: 'UF_CRM_14_MOD_DAY2_EDIT',
    dayWait: 'UF_CRM_14_MOD_DAY2_WAIT',
    dayApprove: 'UF_CRM_14_MOD_DAY2_APPROVE',
  };

  $('sendBtn').addEventListener('click', function () {
    var n = countPending(edits);
    if (n < 1 || validateEdits(deal, edits).length) return;
    confirmAsk('Отправить изменения', 'Отправить ' + n + ' изменений в Б24?', function () {
      var updates = Object.keys(edits).map(function (id) {
        var fields = {};
        Object.keys(edits[id]).forEach(function (k) {
          if (FIELD_MAP[k]) fields[FIELD_MAP[k]] = edits[id][k];
        });
        return { id: id, fields: fields };
      });
      $('sendBtn').disabled = true;
      window.api('POST', 'api/graph.php?action=save&dealId=' + encodeURIComponent(dealId), { updates: updates })
        .then(function (res) {
          if (res && res.ok && (!res.errors || !res.errors.length)) {
            showToast('Сохранено: ' + (res.saved != null ? res.saved : n) + ' модулей');
            loadDeal();                      // перезагрузка данных с портала
          } else {
            var msg = res && res.errors && res.errors.length
              ? res.errors.map(function (e) { return '#' + e.id + ': ' + e.error; }).join('; ')
              : 'сервер вернул ошибку';
            showToast('Ошибка сохранения — ' + msg);
            updateChangesCounter();          // снимаем блокировку кнопки
          }
        })
        .catch(function (err) {
          showToast(err.message === 'access' ? 'Нет доступа' : 'Ошибка сохранения: ' + err.message);
          updateChangesCounter();
        });
    });
  });

  $('cancelBtn').addEventListener('click', function () {
    var n = countPending(edits);
    if (n < 1) return;
    confirmAsk('Отменить изменения', 'Сбросить ' + n + ' изменений?', function () {
      clearEdits(edits);
      loadDeal();                          // полный перезапрос данных с портала
    });
  });

  $('reloadBtn').addEventListener('click', loadDeal);

  loadDeal();
})();

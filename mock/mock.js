'use strict';
/* Макет (M4): таблица этапов→модулей + Ганта с масштабами из MOCK_DATA.
   Чистая логика (сортировка, сворачивание, масштаб Ганта, полосы) — в функциях
   блока PURE, экспортируется для node-проверки. DOM-часть — только в браузере. */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const parseD = s => { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
const fmtD = d => ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2);
const fmtDyy = d => fmtD(d) + '.' + String(d.getFullYear()).slice(-2);
/* дд.мм.гг → ISO; null, если неполно или неверная дата. */
function parseDyy(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec((s || '').trim());
  if (!m) return null;
  const iso = '20' + m[3] + '-' + m[2] + '-' + m[1];
  const d = parseD(iso);
  return (d.getDate() === +m[1] && d.getMonth() + 1 === +m[2]) ? iso : null;
}
/* Подпись года для верхней полосы календаря (год на первой колонке года). */
function yearLabels(cols) {
  return cols.map((iso, i) => {
    const y = parseD(iso).getFullYear(), prev = i ? parseD(cols[i - 1]).getFullYear() : null;
    return (i === 0 || prev !== y) ? String(y) : '';
  });
}
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DAY_MS = 24 * 3600 * 1000;

/* ── PURE: чистая логика M3/M4 (без DOM, тестируется node-скриптом) ──── */

/* Длительность разработки «Р»: datediff(check, create) + 1 дней; пусто, если дат нет. */
function runDays(m) {
  if (!m.check || !m.create) return '';
  return Math.round((parseD(m.create) - parseD(m.check)) / DAY_MS) + 1;
}

/* Значение ячейки; пустые значения (модуль без дат) — «—». */
function cellValue(m, key) {
  if (key === 'title') return m.title;
  if (key === 'check' || key === 'create') return m[key] ? fmtD(parseD(m[key])) : '—';
  if (key === 'run') return runDays(m) === '' ? '—' : runDays(m);
  return (m.check && m.create) ? String(m[key]) : '—';
}

/* Ключ сортировки: сырое значение (даты ISO, длительности числа) или null, если пусто. */
function sortKey(m, key) {
  if (key === 'title') return m.title;
  if (key === 'status') return STATUS_ORDER.indexOf(m.status);
  if (key === 'check' || key === 'create') return m[key] || null;
  if (key === 'run') { const r = runDays(m); return r === '' ? null : r; }
  return (m.check && m.create) ? m[key] : null;
}

/* Сортировка плоского списка модулей одного этапа. Пустые значения («—») — в конец.
   dir: 1 = asc, -1 = desc. По умолчанию — title asc. */
function sortModules(mods, key, dir) {
  const mul = dir === -1 ? -1 : 1;
  return mods.slice().sort((a, b) => {
    const va = sortKey(a, key), vb = sortKey(b, key);
    const ea = (va === null), eb = (vb === null);
    if (ea !== eb) return ea ? 1 : -1;            /* пустые всегда внизу */
    if (ea && eb) return 0;
    if (va < vb) return -1 * mul;
    if (va > vb) return 1 * mul;
    return 0;
  });
}

/* Строки для отрисовки: этап + его модули (модули этапа скрыты, если свёрнут).
   Возвращает плоский список: [{type:'stage', stage}, {type:'module', module, stage}]. */
function tableRows(stages, modules, collapsed) {
  const rows = [];
  stages.forEach(st => {
    rows.push({ type: 'stage', stage: st, open: !collapsed.has(st.id) });
    if (!collapsed.has(st.id)) {
      sortModules(modules.filter(m => m.parentStageId === st.id), sortState.key, sortState.dir)
        .forEach(m => rows.push({ type: 'module', module: m, stage: st }));
    }
  });
  return rows;
}

/* ── PURE: Гант (M4) — масштаб, сетка, полосы ────────────────────────── */

/* Шаг масштаба → число дней в колонке. */
const STEP_MAP = { '1d': 1, '1w': 7, '2w': 14, '3w': 21, '4w': 28 };
/* Порядок стадий воронки (для сортировки по статусу). */
const STATUS_ORDER = ['Зап', 'Расм', 'Разр', 'Корр', 'Ожид', 'Согл', 'Заверш'];
function stepDaysOf(step) { return STEP_MAP[step] || 7; }

const isoOf = d => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
function addDaysIso(iso, n) { const d = parseD(iso); d.setDate(d.getDate() + n); return isoOf(d); }
function daysBetween(isoA, isoB) { return Math.round((parseD(isoB) - parseD(isoA)) / DAY_MS); }

/* Дефолтное смещение (первая дата календаря) = самая ранняя дата полос − один шаг. */
function defaultOffsetIso(minIso, step) {
  if (!minIso) return null;
  return addDaysIso(minIso, -stepDaysOf(step));
}

/* Сетка колонок от смещения: начало каждого шага. Число колонок подбирается так,
   чтобы покрыть диапазон до lastIso (пересчёт при смене масштаба: диапазон тот же,
   число колонок меняется). */
function buildCols(offsetIso, step, lastIso) {
  const sd = stepDaysOf(step);
  const span = Math.max(0, daysBetween(offsetIso, lastIso || offsetIso));
  const n = Math.max(6, Math.ceil((span + 1) / sd));
  const cols = [];
  for (let i = 0; i < n; i++) cols.push(addDaysIso(offsetIso, i * sd));
  return cols;
}

/* Позиция и ширина полосы в колонках. Работа занимает колонки, пересекающие
   [startIso..endIso] (даты включительно); длительность меньше шага или даты равны →
   минимум 1 ячейка (не пропадает).
   Модули левее смещения — обрезаем по левому краю (частично видны, начиная
   с колонки 0); полностью левее смещения — не рисуем; правее — обрезаем по
   последней колонке. */
function barColumns(offsetIso, step, nCols, startIso, endIso) {
  const sd = stepDaysOf(step);
  if (daysBetween(offsetIso, endIso) < 0) return { start: 0, width: 0, visible: false };
  let start = Math.floor(daysBetween(offsetIso, startIso) / sd);
  let end = Math.floor(daysBetween(offsetIso, endIso) / sd);
  const clippedLeft = start < 0;
  start = Math.max(0, start);
  end = Math.min(nCols - 1, end);
  const width = Math.max(1, end - start + 1);
  return { start, width, visible: true, clippedLeft };
}

/* Полосы модуля: акцентная Рассмотрение→Разработка; вторичные (в другом акценте):
   Запуск (check−dayRun → check), Корректировка (create → +dayEdit),
   Ожидание (после корректировки → +dayWait), Согласование (→ +dayApprove).
   Модуль без дат — полос нет. */
function barsForModule(m) {
  if (!m.check || !m.create) return [];
  const out = [{ key: 'run', kind: 'secondary', title: 'Запуск', start: addDaysIso(m.check, -m.dayRun), end: m.check }];
  out.push({ key: 'main', kind: 'accent', title: 'Рассмотрение → Разработка', start: m.check, end: m.create });
  const editEnd = addDaysIso(m.create, m.dayEdit);
  if (m.dayEdit > 0) out.push({ key: 'edit', kind: 'secondary', title: 'Корректировка', start: m.create, end: editEnd });
  const waitEnd = addDaysIso(editEnd, m.dayWait);
  if (m.dayWait > 0) out.push({ key: 'wait', kind: 'secondary', title: 'Ожидание', start: editEnd, end: waitEnd });
  const apprEnd = addDaysIso(waitEnd, m.dayApprove);
  if (m.dayApprove > 0) out.push({ key: 'approve', kind: 'secondary', title: 'Согласование', start: waitEnd, end: apprEnd });
  return out;
}

/* Мин/макс дат всех полос списка модулей (для дефолтного смещения и ширины сетки).
   null, если дат нет ни у одного модуля. */
function moduleDateBounds(mods) {
  let min = null, max = null;
  mods.forEach(m => barsForModule(m).forEach(b => {
    if (!min || b.start < min) min = b.start;
    if (!max || b.end > max) max = b.end;
  }));
  return { min, max };
}

/* Уровень 1 шапки: имя месяца в первой колонке шага, попавшей в новый месяц.
   Возвращает массив подписей ('' — продолжение месяца). */
function monthLabels(cols) {
  return cols.map((iso, i) => {
    const d = parseD(iso), prev = i ? parseD(cols[i - 1]) : null;
    return (i === 0 || prev.getMonth() !== d.getMonth())
      ? MONTHS[d.getMonth()] : '';
  });
}

/* Индекс колонки, содержащей «сегодня» (для вертикального маркера), или −1. */
function todayIndex(cols, step) {
  const sd = stepDaysOf(step), today = isoOf(new Date());
  for (let i = 0; i < cols.length; i++) {
    if (daysBetween(cols[i], today) >= 0 && daysBetween(today, addDaysIso(cols[i], sd)) > 0) return i;
  }
  return -1;
}

/* ── PURE: режимы правки (M5) ────────────────────────────────────────── */

/* Состояние ввода (фундамент M6): правки по модулю → поле → значение.
   Даты — ISO «YYYY-MM-DD», длительности — числа. Пусто = нет правки. */
const edits = {};

/* Модуль с правками поверх исходных данных (показ, сортировка, Гант читают это).
   Правка подставляется КАК ЕСТЬ — включая '' (очистка непустого поля). */
function effModule(m, editsMap) {
  return Object.assign({}, m, editsMap[m.id] || {});
}

/* Эффективное значение поля: правка поверх исходных данных (для показа,
   сортировки, Ганта). Возвращает значение правки как есть, включая ''. */
function effValue(m, editsMap, key) {
  return effModule(m, editsMap)[key];
}

/* setEdit (M6): записать/убрать одну правку. Возврат к исходному значению
   (в т.ч. пустая дата/пустая строка, если исходное было пустым) УДАЛЯЕТ правку
   из карты; пустой модуль в карте удаляется целиком. Возвращает editsMap. */
function setEdit(m, editsMap, key, value) {
  const src = m[key];
  const srcEmpty = src === undefined || src === null || src === '';
  const vEmpty = value === undefined || value === null || value === '';
  const drop = () => {
    if (!editsMap[m.id]) return;
    delete editsMap[m.id][key];
    if (!Object.keys(editsMap[m.id]).length) delete editsMap[m.id];
  };
  if (vEmpty) {
    /* Очистка поля: исходное было пустым → правки нет; иначе правка «сделать пустым». */
    if (srcEmpty) drop();
    else { if (!editsMap[m.id]) editsMap[m.id] = {}; editsMap[m.id][key] = ''; }
  } else if (String(value) === String(src)) {
    drop();                                   /* возврат к исходному удаляет правку */
  } else {
    if (!editsMap[m.id]) editsMap[m.id] = {};
    editsMap[m.id][key] = value;
  }
  return editsMap;
}

/* Счётчик правок (M6): число МОДУЛЕЙ в карте (не полей). */
function countPending(editsMap) { return Object.keys(editsMap).length; }

/* Групповое применение (M5): только заполненные поля окна записываются во все
   отмеченные модули — и только те пары, что реально отличаются от исходных
   (запись идёт через setEdit, возврат к исходному правку не создаёт).
   Пустые поля окна ничего не меняют. */
function applyGroup(mods, editsMap, winValues) {
  const filled = {};
  Object.keys(winValues).forEach(k => {
    const v = winValues[k];
    if (v !== '' && v !== null && v !== undefined) filled[k] = v;
  });
  if (!Object.keys(filled).length) return editsMap;
  mods.forEach(m => {
    Object.keys(filled).forEach(k => { setEdit(m, editsMap, k, filled[k]); });
  });
  return editsMap;
}

/* Трит-стейт чекбокса этапа: 'all' | 'none' | 'partial'. */
function stageCheckState(stage, mods) {
  const list = mods.filter(m => m.parentStageId === stage.id || m.stageId === stage.id);
  const n = list.filter(m => m._checked).length;
  if (n === 0) return 'none';
  if (n === list.length) return 'all';
  return 'partial';
}

/* Отметить/снять все модули этапа (в наборе отмеченных id). */
function stageSetChecked(stage, mods, checkedSet, on) {
  mods.filter(m => m.parentStageId === stage.id || m.stageId === stage.id)
    .forEach(m => { if (on) checkedSet.add(m.id); else checkedSet.delete(m.id); });
}

function checkedCount(checkedSet) { return checkedSet.size; }

/* ── PURE: отправка/отмена (M7) ──────────────────────────────────────── */

const DUR_KEYS = ['dayRun', 'dayEdit', 'dayWait', 'dayApprove'];

/* Валидация перед отправкой (M7): только модули с правками, по ЭФФЕКТИВНЫМ
   значениям (исходное + правка). Правила: Рассмотрение (check) ≤ Разработка
   (create); все 4 длительности — числа ≥ 0 (пустая длительность — ошибка).
   Возвращает [{moduleId, field, msg}]. */
function validateEdits(deal, editsMap) {
  const errs = [];
  deal.modules.forEach(m => {
    const ed = editsMap[m.id];
    if (!ed || !Object.keys(ed).length) return;
    const eff = Object.assign({}, m, ed);
    if (eff.check && eff.create && daysBetween(eff.check, eff.create) < 0) {
      errs.push({ moduleId: m.id, field: 'check', msg: 'Рассмотрение позже Разработки' });
      errs.push({ moduleId: m.id, field: 'create', msg: 'Разработка раньше Рассмотрения' });
    }
    DUR_KEYS.forEach(k => {
      const v = eff[k];
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

/* Фиксация правок (M7, в макете — эквивалент ответа портала): значения пишутся
   в исходные объекты (Object.assign), карта правок полностью очищается.
   Возвращает число применённых модулей. */
function applyEdits(deal, editsMap) {
  const ids = Object.keys(editsMap);
  ids.forEach(id => {
    const m = deal.modules.find(x => x.id === id);
    if (m) Object.assign(m, editsMap[id]);
    delete editsMap[id];
  });
  return ids.length;
}

/* Полный сброс карты правок (M7, «Отменить изменения»: в макете — эквивалент
   перезапроса данных с портала). Мутация editsMap. */
function clearEdits(editsMap) {
  Object.keys(editsMap).forEach(id => { delete editsMap[id]; });
  return editsMap;
}

/* Состояние сортировки/сворачивания — глобально для отрисовки (в node не используется). */
const sortState = { key: 'title', dir: 1 };
const collapsed = new Set();

/* ── DOM: всё ниже — только в браузере ───────────────────────────────── */
if (typeof document !== 'undefined') (function () {

  /* Ширина колонки календаря фиксированная (px); масштаб = дней в колонке. */
  const COL_W = 36;
  const deal = MOCK_DATA.deals[0];
  const state = {
    step: '1w', offset: null,        /* offset — ISO-строка «Смещение» */
    mode: 'single',                  /* 'single' | 'group' — режим правки (M5) */
    checked: new Set()               /* отмеченные модули в групповом режиме */
  };

  /* 6 редактируемых полей: тип input и подпись (Р «Р» — производное, не редактируется). */
  const EDIT_FIELDS = [
    { key: 'dayRun', type: 'number' },
    { key: 'check', type: 'date' },
    { key: 'create', type: 'date' },
    { key: 'dayEdit', type: 'number' },
    { key: 'dayWait', type: 'number' },
    { key: 'dayApprove', type: 'number' }
  ];

  /* Модуль с правками — чистая effModule выше; DOM-копии больше нет. */

  function setGridCols(nCols) {
    const lead = state.mode === 'group' ? '30px ' : '';
    document.documentElement.style.setProperty('--grid-cols',
      lead + 'minmax(170px, 210px) 64px 36px 84px 84px 84px 34px 34px 34px repeat(' + nCols + ', ' + COL_W + 'px)');
  }

  /* Ячейка редактируемого поля: input в единичном режиме (даты — текст дд.мм.гг,
     дни — number без спиннеров); в групповом — тот же input, но readonly. */
  function editCell(m, f) {
    const v = effValue(m, edits, f.key);
    const val = (v === undefined || v === null) ? '' : v;
    const ro = state.mode === 'group' ? ' readonly' : '';
    /* M6: ячейка с непустой правкой подсвечена жёлтым */
    const edited = edits[m.id] && Object.prototype.hasOwnProperty.call(edits[m.id], f.key);
    if (f.type === 'date') {
      const shown = val ? fmtDyy(parseD(val)) : '';
      return '<div class="cell-edit' + (edited ? ' is-edited' : '') + '">' +
        '<input class="cell-input date-input" type="text" inputmode="numeric" maxlength="8" placeholder="дд.мм.гг"' +
        ' data-module="' + esc(m.id) + '" data-field="' + f.key + '" data-type="date"' +
        ' value="' + esc(shown) + '"' + ro + '></div>';
    }
    return '<div class="' + (f.type === 'number' ? 'num ' : '') + 'cell-edit' + (edited ? ' is-edited' : '') + '">' +
      '<input class="cell-input" type="' + f.type + '" data-module="' + esc(m.id) + '" data-field="' + f.key + '"' +
      ' value="' + esc(val) + '"' + ro + '></div>';
  }

  /* Завершён ли модуль: стадия из STATUS_COMPLETED (пока «Заверш»). */
  function isDoneStatus(m) { return STATUS_COMPLETED.indexOf(m.status) !== -1; }

  /* Полоса модуля в px: позиция/ширина от чистой barColumns.
     dim — завершённый (до первого незавершённого или все завершены): светлее.
     withFlag — все модули завершены и у этого правый конец: флаг 🏁. */
  function barsFor(m, offsetIso, cols, dim, withFlag) {
    const html = barsForModule(m).map(b => {
      const p = barColumns(offsetIso, state.step, cols.length, b.start, b.end);
      if (!p.visible) return '';
      return '<div class="gantt-bar ' + b.kind + (dim ? ' dimmed' : '') + '" style="left:' + (p.start * COL_W) + 'px;width:' +
        (p.width * COL_W - 2) + 'px" title="' + esc(b.title) + '"></div>';
    }).join('');
    const flag = withFlag && barsForModule(m).length
      ? (() => {
          const bars = barsForModule(m);
          const last = bars[bars.length - 1];
          const p = barColumns(offsetIso, state.step, cols.length, last.start, last.end);
          return p.visible ? '<div class="gantt-flag" style="left:' + (p.start * COL_W + p.width * COL_W) + 'px" title="Все модули завершены">🏁</div>' : '';
        })()
      : '';
    return html + flag;
  }

  /* Трек Ганта — ОДИН grid-элемент, который должен занимать ВСЕ колонки
     календаря (grid-column: span N). Без span он встаёт в первую колонку
     48px, а полосы (position:absolute) выпадают из строки. barsHtml —
     полосы модуля, они рисуются ВНУТРИ трека (position:relative). */
  function ganttCells(cols, offsetIso, barsHtml) {
    const ti = todayIndex(cols, state.step);
    let out = '<div class="gantt-track" style="grid-column: span ' + cols.length + '; width:' + (cols.length * COL_W) + 'px">';
    cols.forEach((_, i) => { out += '<div class="gantt-cell" style="left:' + (i * COL_W) + 'px;width:' + COL_W + 'px"></div>'; });
    if (ti >= 0) out += '<div class="gantt-today" style="left:' + (ti * COL_W + COL_W / 2) + 'px" title="Сегодня"></div>';
    out += barsHtml || '';
    return out + '</div>';
  }

  function ganttHeadCells(cls, cols) {
    /* h-year — верхняя полоса годов; h-month — короткие месяцы; иначе дни */
    const isYears = cls === 'h-year', isMonths = cls === 'h-month';
    const labels = isYears ? yearLabels(cols) : (isMonths ? monthLabels(cols) : null);
    let out = '<div class="' + cls + ' gantt-track" style="grid-column: span ' + cols.length + '; width:' + (cols.length * COL_W) + 'px">';
    if (labels) {
      /* Подпись тянется на все свои колонки — не наезжает на соседнюю */
      for (let i = 0; i < cols.length; i++) {
        if (!labels[i]) continue;
        let span = 1;
        while (i + span < cols.length && !labels[i + span]) span++;
        out += '<div style="position:absolute;left:' + (i * COL_W) + 'px;width:' + (span * COL_W - 4) + 'px;overflow:hidden;white-space:nowrap">' + esc(labels[i]) + '</div>';
      }
    } else {
      /* В колонках календаря — только день: месяц и год видны выше */
      cols.forEach((iso, i) => {
        out += '<div style="position:absolute;left:' + (i * COL_W) + 'px;width:' + COL_W + 'px;overflow:hidden;white-space:nowrap;text-align:center;box-sizing:border-box;border-left:1px solid var(--border)">' + parseD(iso).getDate() + '</div>';
      });
    }
    return out + '</div>';
  }

  /* Заголовки колонок таблицы: data-sort — ключ сортировки; title — подсказка. */
  const HEAD_COLS = [
    { label: 'Статус', cls: '', key: 'status', title: 'Стадия модуля по воронке (цвета — из Б24)' },
    { label: 'З', cls: 'num', key: 'dayRun', title: 'Запуск — рабочих дней от старта до начала Рассмотрения' },
    { label: 'Рассмотр.', cls: '', key: 'check', title: 'Дата начала Рассмотрения (стадия модуля)' },
    { label: 'Разработка', cls: '', key: 'create', title: 'Дата завершения Разработки — конец работ по модулю' },
    { label: 'К', cls: 'num', key: 'dayEdit', title: 'Корректировка — рабочих дней после Разработки' },
    { label: 'О', cls: 'num', key: 'dayWait', title: 'Ожидание — рабочих дней после Корректировки' },
    { label: 'С', cls: 'num', key: 'dayApprove', title: 'Согласование — рабочих дней после Ожидания' },
    { label: 'Р', cls: 'num', key: 'run', title: 'Длительность разработки — календарных дней от Рассмотрения до Разработки' }
  ];
  const NAME_TITLE = 'Название модуля: код объекта, номер, шифр раздела. Сортировка — клик по заголовку колонки.';

  function renderHead(cols) {
    const ind = k => sortState.key === k ? (sortState.dir === 1 ? ' ↑' : ' ↓') : '';
    const chk = state.mode === 'group' ? '<div class="h-cell chk-cell"></div>' : '';
    /* Шапка из 3 sticky-строк: год / месяц / заголовки таблицы + дни.
       В строках года и месяца над таблицей — пустые sticky-ячейки фона. */
    $('chartHead').innerHTML =
      '<div class="row head">' +
        chk +
        '<div class="h-cell h-year name"></div>' +
        HEAD_COLS.map(() => '<div class="h-cell h-year"></div>').join('') +
        ganttHeadCells('h-year', cols) +
      '</div>' +
      '<div class="row head">' +
        chk +
        '<div class="h-cell h-month name"></div>' +
        HEAD_COLS.map(() => '<div class="h-cell h-month"></div>').join('') +
        ganttHeadCells('h-month', cols) +
      '</div>' +
      '<div class="row head">' +
        chk +
        '<div class="h-cell h-title name" title="' + NAME_TITLE + '">Этап / модуль</div>' +
        HEAD_COLS.map(c =>
          '<div class="h-cell h-title ' + c.cls + ' sort-btn" data-sort="' + c.key + '" title="' + c.title + '. Сортировать">' +
          c.label + ind(c.key) + '</div>').join('') +
        ganttHeadCells('h-title', cols) +
      '</div>';
  }

  /* Чекбокс этапа: трит-стейт (все/никакие/частично) по отмеченным модулям. */
  function stageCheckbox(st) {
    const st8 = stageCheckState(st, deal.modules);
    const attr = st8 === 'all' ? ' checked' : '';
    const ind = st8 === 'partial' ? ' data-ind="1"' : '';
    return '<div class="chk-cell"><input type="checkbox" class="stage-chk" data-stage="' + esc(st.id) + '"' + attr + ind + '></div>';
  }

  /* Активный модуль = первый незавершённый (в порядке данных). Всё, что раньше
     его, — завершённое: полосы светлее. Если завершены все — флаг 🏁 в конце. */
  function moduleEmphasis() {
    const activeIdx = deal.modules.findIndex(m => !isDoneStatus(m));
    const allDone = activeIdx === -1;
    let flagId = null;
    if (allDone) {
      let maxEnd = null;
      deal.modules.forEach(m => barsForModule(m).forEach(b => {
        if (maxEnd === null || b.end > maxEnd) { maxEnd = b.end; flagId = m.id; }
      }));
    }
    return {
      allDone, flagId,
      dimmed: id => allDone || (activeIdx !== -1 && deal.modules.findIndex(x => x.id === id) < activeIdx)
    };
  }

  function statusBadge(m) {
    const color = STATUS_COLORS[m.status] || '#ccc';
    return '<div class="st-cell" title="Стадия модуля по воронке"><span class="st-badge" style="background:' + color + '">' + esc(m.status) + '</span></div>';
  }

  function renderBody(cols, offsetIso) {
    let html = '';
    const em = moduleEmphasis();
    tableRows(deal.stages, deal.modules, collapsed).forEach(r => {
      if (r.type === 'stage') {
        const df = r.stage.dfinish;
        const chk = state.mode === 'group' ? stageCheckbox(r.stage) : '';
        html += '<div class="row data stage" data-stage="' + esc(r.stage.id) + '" title="Свернуть/развернуть модули">' +
          chk +
          '<div class="name stage-name"><span class="stage-toggle">' + (r.open ? '▾' : '▸') + '</span> ' + esc(r.stage.title) + '</div>' +
          '<div class="st-cell"></div>' +
          '<div class="num muted-note"></div><div></div><div></div>' +
          '<div class="kp-note">по КП: ' + esc(fmtDyy(parseD(df))) + '</div><div></div><div></div><div></div>' +
          ganttCells(cols, offsetIso) + '</div>';
      } else {
        const m = effModule(r.module, edits);
        const chk = state.mode === 'group'
          ? '<div class="chk-cell"><input type="checkbox" class="mod-chk" data-module="' + esc(m.id) + '"' +
            (state.checked.has(m.id) ? ' checked' : '') + '></div>'
          : '';
        const dim = em.dimmed(m.id);
        const withFlag = em.allDone && em.flagId === m.id;
        html += '<div class="row data module' + (dim ? ' is-done' : '') + '" data-module="' + esc(m.id) + '">' +
          chk +
          '<div class="name" title="' + esc(m.title) + '">' + esc(m.num) + ' · ' + esc(m.sname) + '</div>' +
          statusBadge(m) +
          EDIT_FIELDS.map(f => editCell(m, f)).join('') +
          '<div class="num run-cell">' + esc(cellValue(m, 'run')) + '</div>' +
          ganttCells(cols, offsetIso, barsFor(m, offsetIso, cols, dim, withFlag)) + '</div>';
      }
    });
    $('chartBody').innerHTML = html;
    /* trit-стейт визуально: indeterminate нельзя задать строкой HTML */
    document.querySelectorAll('.stage-chk[data-ind]').forEach(el => { el.indeterminate = true; });
  }

  function updateGroupBar() {
    const n = checkedCount(state.checked);
    $('gwApply').textContent = 'Применить к отмеченным (' + n + ')';
    $('gwApply').disabled = n < 1;
  }

  /* M6: счётчик на панели = число модулей в карте правок.
     Здесь же — валидация (M7): она должна перепроверяться на каждое изменение. */
  function updateChangesCounter() {
    const n = countPending(edits);
    $('changesCounter').textContent = 'Изменений: ' + n;
    updateOver99();
    updateValidation(n);
  }

  /* M7: валидация на каждом изменении — подсветка модулей/ячеек красным,
     список ошибок под панелью, блокировка «Отправить изменения».
     Ошибки исчезают сами, когда правки исправлены (вызов после каждой правки). */
  function updateValidation(n) {
    const errs = validateEdits(deal, edits);
    const badMods = new Set(errs.map(e => e.moduleId));
    const badCells = new Set(errs.map(e => e.moduleId + '|' + e.field));
    document.querySelectorAll('#chartBody .row.module').forEach(row => {
      row.classList.toggle('is-error', badMods.has(row.dataset.module));
      row.querySelectorAll('.cell-edit .cell-input').forEach(inp => {
        inp.closest('.cell-edit').classList.toggle('is-error',
          badCells.has(row.dataset.module + '|' + inp.dataset.field));
      });
    });
    const panel = $('errorPanel');
    panel.hidden = !errs.length;
    panel.innerHTML = errs.length
      ? '<b>Ошибки валидации — отправка заблокирована:</b><ul>' + errs.map(e => {
          const m = deal.modules.find(x => x.id === e.moduleId);
          return '<li>' + esc(m ? (m.num + ' · ' + m.sname) : e.moduleId) + ' — ' +
            esc(e.field) + ': ' + esc(e.msg) + '</li>';
        }).join('') + '</ul>'
      : '';
    $('sendBtn').disabled = n < 1 || errs.length > 0;
    $('cancelBtn').disabled = n < 1;
  }

  /* M6: живой Гант — пересчёт сетки и полос БЕЗ пересборки таблицы
     (inputs не пересоздаются, фокус и набор не теряются; сортировка/
     сворачивание не сбрасываются). Вызывается на каждое изменение поля. */
  function updateGantt() {
    const bounds = moduleDateBounds(deal.modules.map(m => effModule(m, edits)));
    const input = $('offsetInput').value;
    const offsetIso = input || defaultOffsetIso(bounds.min, state.step) || isoOf(new Date());
    if (!input) $('offsetInput').value = offsetIso;   /* правка вышла за диапазон → сетка расширяется */
    const cols = buildCols(offsetIso, state.step, bounds.max);
    setGridCols(cols.length);
    renderHead(cols);
    const em = moduleEmphasis();
    document.querySelectorAll('#chartBody .row.module, #chartBody .row.stage').forEach(row => {
      row.querySelectorAll('.gantt-track, .gantt-bar, .gantt-flag').forEach(el => el.remove());
      if (row.classList.contains('stage')) {          /* у этапа — только пустая сетка */
        row.insertAdjacentHTML('beforeend', ganttCells(cols, offsetIso));
        return;
      }
      const raw = deal.modules.find(x => x.id === row.dataset.module);
      if (!raw) return;
      const m = effModule(raw, edits);
      const withFlag = em.allDone && em.flagId === m.id;
      row.insertAdjacentHTML('beforeend', ganttCells(cols, offsetIso, barsFor(m, offsetIso, cols, em.dimmed(m.id), withFlag)));
      const run = row.querySelector('.run-cell');       /* производное «Р» тоже живое */
      if (run) run.textContent = cellValue(m, 'run');
    });
    updateChangesCounter();
  }

  function render() {
    const bounds = moduleDateBounds(deal.modules.map(m => effModule(m, edits)));
    /* Смещение: из поля (если задано) либо дефолт = min(дат) − один шаг. */
    const input = $('offsetInput').value;
    const offsetIso = input || defaultOffsetIso(bounds.min, state.step) || isoOf(new Date());
    if (!input) $('offsetInput').value = offsetIso;
    const cols = buildCols(offsetIso, state.step, bounds.max);
    setGridCols(cols.length);
    renderHead(cols);
    renderBody(cols, offsetIso);
    updateGroupBar();
    updateChangesCounter();
    ensureBarsVisible(bounds);
  }

  /* Авто-прокрутка календаря к полосам (только при полном рендере, не при наборе):
     не мешаем, если пользователь уже скроллил вручную. */
  let hScrolledByUser = false;
  function ensureBarsVisible(bounds) {
    if (hScrolledByUser || !bounds.min) return;
    const chart = $('chart');
    const track = document.querySelector('#chartBody .row.data .gantt-track');
    if (!track) return;
    const ganttStart = track.offsetLeft;                 // x начала зоны Ганта
    const stepDays = stepDaysOf(state.step);
    const firstCol = Math.max(0, Math.floor(daysBetween(bounds.min, $('offsetInput').value || bounds.min) / stepDays));
    const barX = ganttStart + firstCol * COL_W;          // где начинается самая ранняя полоса
    /* Скроллим, только если полосы НЕ видны; иначе возвращаем вид на таблицу */
    chart.scrollLeft = barX > chart.clientWidth ? Math.min(barX - 250, chart.scrollWidth - chart.clientWidth) : 0;
  }
  $('chart').addEventListener('scroll', () => {
    if ($('chart').scrollLeft > 4) hScrolledByUser = true;
  }, { passive: true });

  /* Клик по заголовку колонки — сортировка (повторный клик меняет направление).
     Клик по плашке этапа — сворачивание/разворачивание его модулей. */
  $('chartHead').addEventListener('click', e => {
    const btn = e.target.closest('.sort-btn');
    if (!btn) return;
    const key = btn.dataset.sort;
    if (sortState.key === key) sortState.dir = -sortState.dir;
    else { sortState.key = key; sortState.dir = 1; }
    render();
  });
  $('chartBody').addEventListener('click', e => {
    /* Клик по чекбоксу (модуля или этапа) — не сворачиваем этап */
    if (e.target.closest('.stage-chk, input[type=checkbox]')) return;
    const row = e.target.closest('.row.stage');
    if (!row) return;
    const id = row.dataset.stage;
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    render();
  });

  /* Переключатель масштаба (M4): меняет шаг колонок, рендер без перезагрузки данных. */
  document.querySelectorAll('.scale-btn').forEach(btn => {
    btn.disabled = false;
    btn.addEventListener('click', () => {
      state.step = btn.dataset.step;
      hScrolledByUser = false;
      document.querySelectorAll('.scale-btn').forEach(b => b.classList.toggle('active', b === btn));
      render();
    });
  });

  /* Поле «Смещение» (M4): первая дата календаря; пусто → дефолт. */
  $('offsetInput').addEventListener('change', () => { hScrolledByUser = false; render(); });

  /* ── M5: режимы правки ─────────────────────────────────────────────── */

  /* Тумблер «Единично | Группово»: строго один режим активен. Переключение
     не сбрасывает таблицу: правки живут в edits, значения читаются из них. */
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === state.mode) return;
      state.mode = mode;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      $('groupEntry').hidden = mode !== 'group';
      $('chartInner').classList.toggle('group-mode', mode === 'group');
      render();
    });
  });

  /* Инлайн-ввод (единичный режим): слушаем `input` (не только `change`), чтобы
     Гант пересчитывался при наборе. Правка пишется через setEdit — возврат к
     исходному удаляет её из карты. Таблица не перестраивается. */
  $('chartBody').addEventListener('input', e => {
    const inp = e.target;
    if (inp.classList.contains('cell-input')) {
      const m = deal.modules.find(x => x.id === inp.dataset.module);
      const key = inp.dataset.field;
      if (!m) return;
      if (inp.dataset.type === 'date') {
        /* Даты дд.мм.гг: в карту пишем ISO только когда введено полностью;
           частичный ввод карту не трогает (Гант показывает последнее валидное). */
        const iso = parseDyy(inp.value);
        if (inp.value.trim() === '') setEdit(m, edits, key, '');
        else if (iso) setEdit(m, edits, key, iso);
        else return;
      } else {
        const v = inp.type === 'number' && inp.value !== '' ? Number(inp.value) : inp.value;
        setEdit(m, edits, key, v);
      }
      const cell = inp.closest('.cell-edit');
      if (cell) cell.classList.toggle('is-edited',
        !!(edits[m.id] && Object.prototype.hasOwnProperty.call(edits[m.id], key)));
      updateGantt();
      return;
    }
    /* Чекбокс модуля (групповой режим) */
    if (inp.classList.contains('mod-chk')) {
      const id = inp.dataset.module;
      if (inp.checked) state.checked.add(id); else state.checked.delete(id);
      render();
      return;
    }
    /* Чекбокс этапа: все не отмечены/частично → отметить все; все → снять все */
    if (inp.classList.contains('stage-chk')) {
      const st = deal.stages.find(s => s.id === inp.dataset.stage);
      const on = stageCheckState(st, deal.modules) !== 'all';
      stageSetChecked(st, deal.modules, state.checked, on);
      render();
    }
  });

  /* Уход с поля даты: нормализуем показ к дд.мм.гг эффективного значения
     (частичный ввод откатывается к последнему валидному). */
  $('chartBody').addEventListener('focusout', e => {
    const inp = e.target;
    if (!inp.classList || !inp.classList.contains('date-input')) return;
    const m = deal.modules.find(x => x.id === inp.dataset.module);
    if (!m) return;
    const iso = effValue(m, edits, inp.dataset.field);
    inp.value = iso ? fmtDyy(parseD(iso)) : '';
  });

  /* Подсветка длительностей > 99 дней (не блокирует отправку — просто заметно). */
  function updateOver99() {
    const bad = new Set();
    deal.modules.forEach(m => {
      const eff = effModule(m, edits);
      DUR_KEYS.forEach(k => { if (typeof eff[k] === 'number' && eff[k] > 99) bad.add(m.id + '|' + k); });
    });
    document.querySelectorAll('#chartBody .row.module').forEach(row => {
      row.querySelectorAll('.cell-edit .cell-input').forEach(inp => {
        inp.closest('.cell-edit').classList.toggle('is-over99',
          bad.has(row.dataset.module + '|' + inp.dataset.field));
      });
    });
    DUR_KEYS.forEach(k => {
      const el = $('gw-' + k);
      if (el) el.classList.toggle('is-over99', Number(el.value) > 99);
    });
  }

  /* Групповое применение: только заполненные поля окна → всем отмеченным. */
  $('gwApply').addEventListener('click', () => {
    const win = {};
    EDIT_FIELDS.forEach(f => {
      const el = $('gw-' + f.key);
      if (!el || el.value === '') return;
      if (f.type === 'date') { const iso = parseDyy(el.value); if (iso) win[f.key] = iso; }
      else win[f.key] = Number(el.value);
    });
    const targets = deal.modules.filter(m => state.checked.has(m.id));
    applyGroup(targets, edits, win);
    EDIT_FIELDS.forEach(f => { const el = $('gw-' + f.key); if (el) el.value = ''; });
    render();
  });
  /* Окно группового ввода: красная рамка >99 сразу при наборе. */
  $('groupEntry').addEventListener('input', e => {
    if (e.target.classList.contains('cell-input') || e.target.tagName === 'INPUT') updateOver99();
  });

  /* ── M7: отправка/отмена ───────────────────────────────────────────── */

  /* Самодельный диалог подтверждения в стиле макета (не window.confirm). */
  function confirmAsk(title, text, onYes) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-overlay').hidden = false;
    $('confirm-yes').onclick = () => { $('confirm-overlay').hidden = true; onYes(); };
  }
  $('confirm-no').onclick = () => { $('confirm-overlay').hidden = true; };
  $('confirm-overlay').addEventListener('click', e => {
    if (e.target === $('confirm-overlay')) $('confirm-overlay').hidden = true;
  });

  /* Тост: небольшой блок с автоскрытием 2.5 с. */
  let toastTimer = null;
  function showToast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
  }

  /* «Отправить изменения» (кнопка активна только при N≥1 и без ошибок):
     подтверждение → фиксация правок в данных макета (эквивалент batch на
     портале) → полный ререндер (в приложении — перезагрузка данных) → тост. */
  $('sendBtn').addEventListener('click', () => {
    const n = countPending(edits);
    if (n < 1 || validateEdits(deal, edits).length) return;
    confirmAsk('Отправить изменения', 'Отправить ' + n + ' изменений в Б24?', () => {
      const saved = applyEdits(deal, edits);
      render();
      showToast('Сохранено: ' + saved + ' модулей');
    });
  });

  /* «Отменить изменения» при N>0: подтверждение → полный сброс карты правок
     и перерисовка (в макете это эквивалент перезагрузки данных с портала). */
  $('cancelBtn').addEventListener('click', () => {
    const n = countPending(edits);
    if (n < 1) return;
    confirmAsk('Отменить изменения', 'Сбросить ' + n + ' изменений?', () => {
      clearEdits(edits);
      render();
    });
  });

  render();

  /* Интерактив каркаса: только «Сбросить макет» и окно «Дебаг». Правки — M5–M7. */
  $('resetBtn').onclick = () => location.reload();
  (function () {
    const out = $('debug-output'), st = $('debug-status');
    $('debug-btn').onclick = () => {
      out.value = JSON.stringify({ note: 'Пример. В приложении здесь будет ответ портала', dealId: deal.id, modules: deal.modules.length }, null, 2);
      st.textContent = ''; $('debug-modal-overlay').hidden = false;
    };
    $('debug-modal-close').onclick = () => { $('debug-modal-overlay').hidden = true; };
    $('debug-modal-copy').onclick = () => {
      const fb = () => { out.select(); st.textContent = document.execCommand('copy') ? 'Скопировано в буфер обмена' : 'Выдели текст и нажми Ctrl+C'; };
      navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(out.value).then(() => { st.textContent = 'Скопировано в буфер обмена'; }, fb) : fb();
    };
  })();
})();

/* Экспорт чистой логики для node-проверок (sortState/collapsed нужны tableRows). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runDays, cellValue, sortModules, tableRows, sortState, collapsed,
    edits, effModule, effValue, setEdit, countPending, applyGroup, stageCheckState, stageSetChecked, checkedCount,
    validateEdits, applyEdits, clearEdits,
    stepDaysOf, defaultOffsetIso, buildCols, barColumns, barsForModule, moduleDateBounds, monthLabels, todayIndex, addDaysIso
  };
}

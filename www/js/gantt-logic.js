/* График модулей: чистая логика (без DOM). Используется app.js и node-тестом.
   Интервалы полос считаются от check/create (см. план stage-colors-dr-gantt, T3):
   в Б24 пишутся только 2 даты + 5 длительностей, остальные даты считает БП портала. */
var GanttLogic = (function () {
  'use strict';

  var DAY_MS = 24 * 3600 * 1000;
  var MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  var parseD = function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  var fmtD = function (d) { return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2); };
  var fmtDyy = function (d) { return fmtD(d) + '.' + String(d.getFullYear()).slice(-2); };
  /* дд.мм[.гг] → ISO; разделитель точка/дефис/без; null, если неполно или неверная дата. */
  function parseDyy(s) {
    var m = /^(\d{2})(?:([.-])(\d{2})(?:\2(\d{2}))?|(\d{2})(\d{2})?)$/.exec((s || '').trim());
    if (!m) return null;
    var day = m[1], mon = m[3] || m[5], yy = m[4] || m[6] || String(new Date().getFullYear()).slice(-2);
    var iso = '20' + yy + '-' + mon + '-' + day;
    var d = parseD(iso);
    return (d.getDate() === +day && d.getMonth() + 1 === +mon) ? iso : null;
  }

  var isoOf = function (d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  };
  function addDaysIso(iso, n) { var d = parseD(iso); d.setDate(d.getDate() + n); return isoOf(d); }
  function daysBetween(isoA, isoB) { return Math.round((parseD(isoB) - parseD(isoA)) / DAY_MS); }

  /* Длительность разработки «Р»: datediff(check, create) + 1 дней. */
  function runDays(m) {
    if (!m.check || !m.create) return '';
    return Math.round((parseD(m.create) - parseD(m.check)) / DAY_MS) + 1;
  }

  /* Подпись года для верхней полосы календаря (год на первой колонке года). */
  function yearLabels(cols) {
    return cols.map(function (iso, i) {
      var y = parseD(iso).getFullYear(), prev = i ? parseD(cols[i - 1]).getFullYear() : null;
      return (i === 0 || prev !== y) ? String(y) : '';
    });
  }

  function monthLabels(cols) {
    return cols.map(function (iso, i) {
      var d = parseD(iso), prev = i ? parseD(cols[i - 1]) : null;
      return (i === 0 || prev.getMonth() !== d.getMonth()) ? MONTHS[d.getMonth()] : '';
    });
  }

  var STEP_MAP = { '1d': 1, '1w': 7, '2w': 14, '3w': 21, '4w': 28 };
  /* Порядок стадий воронки (для сортировки по статусу); аббревиатуры — с сервера. */
  var STATUS_ORDER = ['Зап', 'Расс', 'Разр', 'Корр', 'Ож', 'Согл', 'Завр', 'Анну'];
  /* Завершённые стадии (низкий акцент); тёмный фон плашки — белый текст. */
  var STATUS_COMPLETED = ['Завр', 'Анну'];
  var STATUS_DARK_BG = ['Зап'];

  function stepDaysOf(step) { return STEP_MAP[step] || 7; }

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

  function todayIndex(cols, step) {
    var sd = stepDaysOf(step), today = isoOf(new Date());
    for (var i = 0; i < cols.length; i++) {
      if (daysBetween(cols[i], today) >= 0 && daysBetween(today, addDaysIso(cols[i], sd)) > 0) return i;
    }
    return -1;
  }

  /* ── Интервалы полос от check/create (новая логика, план T3) ───────────── */

  /* 5 ключей длительностей: ДЗ=dayRun, ДР=dayCheck, ДК=dayEdit, ДО=dayWait, ДС=dayApprove. */
  var DUR_KEYS = ['dayRun', 'dayCheck', 'dayEdit', 'dayWait', 'dayApprove'];

  /* Полосы модуля по интервалам от check/create:
     Запуск: check−(ДЗ+ДР) → check−ДР; Рассмотрение: check−ДР → check;
     Разработка: check → create; Корректировка: create → +ДК;
     Ожидание: → +ДО; Согласование: → +ДС.
     color — КОД стадии (NEW/PREPARATION/CLIENT/UC_*); перевод в цвет — в app.js
     при рендере (stageColors[b.color] || '#ccc'), чтобы логика оставалась чистой.
     m: {check, create, dayRun, dayCheck, dayEdit, dayWait, dayApprove} — eff-значения. */
  function barsForModule(m, stageColors) {
    if (!m.check || !m.create) return [];
    var dur = function (k) { var n = Number(m[k]); return isFinite(n) && n > 0 ? n : 0; };
    var dR = dur('dayCheck'), dZ = dur('dayRun');
    var bars = [];
    if (dZ > 0) bars.push({ key: 'run', kind: 'secondary', title: 'Запуск',
      start: addDaysIso(m.check, -(dZ + dR)), end: addDaysIso(m.check, -dR), color: 'NEW' });
    if (dR > 0) bars.push({ key: 'ras', kind: 'secondary', title: 'Рассмотрение',
      start: addDaysIso(m.check, -dR), end: m.check, color: 'PREPARATION' });
    bars.push({ key: 'main', kind: 'accent', title: 'Разработка',
      start: m.check, end: m.create, color: 'CLIENT' });
    var e1 = addDaysIso(m.create, dur('dayEdit'));
    if (dur('dayEdit') > 0) bars.push({ key: 'edit', kind: 'secondary', title: 'Корректировка',
      start: m.create, end: e1, color: 'UC_AJTX21' });
    var e2 = addDaysIso(e1, dur('dayWait'));
    if (dur('dayWait') > 0) bars.push({ key: 'wait', kind: 'secondary', title: 'Ожидание',
      start: e1, end: e2, color: 'UC_PM02XS' });
    var e3 = addDaysIso(e2, dur('dayApprove'));
    if (dur('dayApprove') > 0) bars.push({ key: 'approve', kind: 'secondary', title: 'Согласование',
      start: e2, end: e3, color: 'UC_M71TWU' });
    return bars;
  }

  /* Пиксельная разкладка полос (план T8): пропорциональная ширина (включительно),
     min 3px, клиппинг слева по offset, сдвиг коротких полос внутри одной колонки
     (idx×3px по порядку start, cap colW−3), чтобы несколько 1-дневных стадий
     в одной колонке были видны одновременно. bars — выход barsForModule,
     ctx = {offsetIso, stepDays, colW, nCols}. */
  function layoutBars(bars, ctx) {
    var pxPerDay = ctx.colW / ctx.stepDays;
    var laid = (bars || []).map(function (b) {
      var leftPx = daysBetween(ctx.offsetIso, b.start) * pxPerDay;
      var widthPx = Math.max(3, (daysBetween(b.start, b.end) + 1) * pxPerDay);
      var visible = daysBetween(ctx.offsetIso, b.end) >= 0;
      var clipped = false;
      if (!visible) return Object.assign({}, b, { leftPx: leftPx, widthPx: widthPx, visible: false });
      if (leftPx < 0) {
        /* клиппинг слева: честный видимый кусок от offset до end, но ≥3px */
        clipped = true;
        leftPx = 0;
        widthPx = Math.max(3, (daysBetween(ctx.offsetIso, b.end) + 1) * pxPerDay);
      }
      return Object.assign({}, b, { leftPx: leftPx, widthPx: widthPx, visible: true, clipped: clipped });
    });
    /* Сдвиг коротких полос (widthPx < colW), начинающихся в одной колонке.
       Клипнутые (start < offset) не сдвигаем — у них leftPx = 0 по контракту. */
    var groups = {};
    laid.forEach(function (p) {
      if (!p.visible || p.clipped || p.widthPx >= ctx.colW) return;
      var col = Math.floor(p.leftPx / ctx.colW);
      (groups[col] = groups[col] || []).push(p);
    });
    Object.keys(groups).forEach(function (col) {
      groups[col]
        .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; })
        .forEach(function (p, idx) { p.leftPx += Math.min(idx * 3, ctx.colW - 3); });
    });
    return laid;
  }

  /* Пустые длительности → 0: мутирует модули (сразу после normalizeModule) и
     дописывает 0 в editsMap[id][k], если ключа там ещё нет (авто-правка на
     отправку). Уже заполненные значения и существующие правки не трогаем. */
  function seedZeroDurations(modules, editsMap) {
    (modules || []).forEach(function (m) {
      DUR_KEYS.forEach(function (k) {
        if (m[k] === '' || m[k] === null || m[k] === undefined) {
          m[k] = 0;
          if (!editsMap[m.id]) editsMap[m.id] = {};
          if (!Object.prototype.hasOwnProperty.call(editsMap[m.id], k)) editsMap[m.id][k] = 0;
        }
      });
    });
    return editsMap;
  }

  /* Валидация правок перед отправкой. Пустые длительности пропускаем — после
     seedZeroDurations они уже 0 («Длительность не задана» больше не ошибка). */
  function validateEdits(modules, editsMap) {
    var errs = [];
    (modules || []).forEach(function (m) {
      var ed = editsMap[m.id];
      if (!ed || !Object.keys(ed).length) return;
      var eff = Object.assign({}, m, ed);
      if (eff.check && eff.create && daysBetween(eff.check, eff.create) < 0) {
        errs.push({ moduleId: m.id, field: 'check', msg: 'Рассмотрение позже Разработки' });
        errs.push({ moduleId: m.id, field: 'create', msg: 'Разработка раньше Рассмотрения' });
      }
      DUR_KEYS.forEach(function (k) {
        var v = eff[k];
        if (v === undefined || v === null || v === '') return;
        if (typeof v !== 'number' || !isFinite(v)) {
          errs.push({ moduleId: m.id, field: k, msg: 'Не число' });
        } else if (v < 0) {
          errs.push({ moduleId: m.id, field: k, msg: 'Отрицательная длительность' });
        }
      });
    });
    return errs;
  }

  return { DAY_MS: DAY_MS, MONTHS: MONTHS, STATUS_ORDER: STATUS_ORDER, STATUS_COMPLETED: STATUS_COMPLETED,
           STATUS_DARK_BG: STATUS_DARK_BG, DUR_KEYS: DUR_KEYS,
           parseD: parseD, fmtD: fmtD, fmtDyy: fmtDyy, parseDyy: parseDyy, isoOf: isoOf,
           addDaysIso: addDaysIso, daysBetween: daysBetween, runDays: runDays,
           yearLabels: yearLabels, monthLabels: monthLabels, STEP_MAP: STEP_MAP, stepDaysOf: stepDaysOf,
           buildCols: buildCols, barColumns: barColumns, defaultOffsetIso: defaultOffsetIso,
           todayIndex: todayIndex, barsForModule: barsForModule, layoutBars: layoutBars,
           seedZeroDurations: seedZeroDurations, validateEdits: validateEdits };
})();
if (typeof window !== 'undefined') window.GanttLogic = GanttLogic;
if (typeof module !== 'undefined') module.exports = GanttLogic;

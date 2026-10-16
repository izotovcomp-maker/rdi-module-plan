# План: красная полоса просрочки согласования + колонка 🔴

**Дизайн:** `design/krasnaya-polosa-prosrochki.md` (утверждён 2026-10-16).
**Ветка:** `красная-линия-при-задержке` (уже создана, от master `0130e1a`).
Откат = не мержить ветку. Бэк (`graph.php`), данные и `mock/` не трогаем.

## Отступление от дизайна (обязательно к учесть)

Дизайн говорил «template.html — без изменений», но `#groupEntry` (строка 95,
`<div class="run-cell"></div>`) сидит на той же сетке `--grid-cols`. Новая
sticky-колонка обязана получить пустую ячейку-заполнитель в groupEntry, иначе
кнопки «Применить»/«Очистить» сместятся. Это единственное отступление.

## Контракты

### `delayDays(m, todayIso)` → число | null
```
approveD пустая            → null
стадия m.status Завр/Анну  → null
approveD > сегодня         → null
иначе                      → daysBetween(m.approveD, todayIso)  (≥ 0)
```

### `delayBar(m, todayIso, offsetIso, step)` → объект | null
- `null` — как в `delayDays`.
- Иначе `{key:'delay', kind:'delay', title:'Просрочка согласования',
  start:m.approveD, end:<правый край колонки «сегодня»>, days}`.
- `end`: `span = daysBetween(offsetIso, todayIso)`; если `span >= 0`, то
  `end = addDaysIso(offsetIso, (floor(span / stepDays) + 1) * stepDays - 1)`
  (правый край колонки, где стоит линия «сегодня»); если `span < 0` (сегодня
  левее шкалы) — `end = todayIso` (полоса всё равно склипится слева).
- Полоса с `days === 0` НЕ рисуется на Ганте, но колонка показывает `0`
  (решение владельца: рисовать негде — совпадает с линией «сегодня»).

---

## Задачи

| # | Цель | Файлы | Верификация | Статус |
|---|---|---|---|---|
| T1 | `delayDays` + `delayBar` в чистой логике (TDD) | `www/js/gantt-logic.js`, `/tmp/kilo/test-gantt.js` | `node /tmp/kilo/test-gantt.js` → ALL OK | ☐ |
| T2 | Красная полоса в разметке Ганта | `www/js/app.js` | `node --check www/js/app.js`; node-тест T1 зелёный | ☐ |
| T3 | Колонка 🔴: шапка, sticky, ячейки, сортировка | `www/js/app.js` | `node --check www/js/app.js` | ☐ |
| T4 | CSS полосы и колонки + заполнитель groupEntry | `www/css/app.css`, `www/template.html` | `grep`-проверки правил CSS | ☐ |
| T5 | Полная проверка + журнал | `docs/state.md`, `docs/changelog.md`, git | все тесты; `git status` чистый после snapshot | ☐ |

---

## T1 — gantt-logic.js: `delayDays` + `delayBar` (TDD)

**Файлы:** `www/js/gantt-logic.js`, `/tmp/kilo/test-gantt.js` (существует,
21 строка, harness `eq(...)` уже есть).

1. **RED.** Дописать в конец `/tmp/kilo/test-gantt.js` (до `console.log`):

```js
// delayDays: просрочка согласования (дизайн krasnaya-polosa-prosrochki)
eq(G.delayDays({ approveD: '2026-10-10', status: 'Разр' }, '2026-10-16'), 6, 'delayDays 6 дней');
eq(G.delayDays({ approveD: '2026-10-16', status: 'Разр' }, '2026-10-16'), 0, 'delayDays 0 дней');
eq(G.delayDays({ approveD: '', status: 'Разр' }, '2026-10-16'), null, 'delayDays пустая approveD');
eq(G.delayDays({ status: 'Разр' }, '2026-10-16'), null, 'delayDays approveD undefined');
eq(G.delayDays({ approveD: '2026-10-20', status: 'Разр' }, '2026-10-16'), null, 'delayDays будущая approveD');
eq(G.delayDays({ approveD: '2026-10-10', status: 'Завр' }, '2026-10-16'), null, 'delayDays Завр');
eq(G.delayDays({ approveD: '2026-10-10', status: 'Анну' }, '2026-10-16'), null, 'delayDays Анну');
eq(G.delayBar({ approveD: '2026-10-10', status: 'Разр' }, '2026-10-16', '2026-10-05', '1w'),
   { key: 'delay', kind: 'delay', title: 'Просрочка согласования', start: '2026-10-10', end: '2026-10-18', days: 6 },
   'delayBar конец = правый край колонки сегодня');
eq(G.delayBar({ approveD: '2026-10-10', status: 'Разр' }, '2026-10-16', '2026-10-12', '1w').end,
   '2026-10-18', 'delayBar другая колонка (10-16 внутри колонки 10-12)');
eq(G.delayBar({ approveD: '2026-09-25', status: 'Разр' }, '2026-10-01', '2026-10-05', '1w').end,
   '2026-10-01', 'delayBar сегодня левее шкалы → end = сегодня');
eq(G.delayBar({ approveD: '2026-10-10', status: 'Завр' }, '2026-10-16', '2026-10-05', '1w'), null, 'delayBar null для завершённого');
```

   Прогнать: `node /tmp/kilo/test-gantt.js` → FAILURES (функции нет).

2. **GREEN.** В `www/js/gantt-logic.js` — добавить перед `seedZeroDurations`
   (после `layoutBars`):

```js
/* ── Просрочка согласования (дизайн krasnaya-polosa-prosrochki) ────────── */

/* Дней задержки: сегодня − approveD, или null — нет просрочки
   (пустая/будущая approveD, модуль завершён Завр/Анну). */
function delayDays(m, todayIso) {
  if (!m.approveD) return null;
  if (STATUS_COMPLETED.indexOf(m.status) !== -1) return null;
  var d = daysBetween(m.approveD, todayIso);
  return d >= 0 ? d : null;
}

/* Красная полоса: от approveD до правого края колонки «сегодня».
   days === 0 — полоса не рисуется, но колонка показывает 0. */
function delayBar(m, todayIso, offsetIso, step) {
  var days = delayDays(m, todayIso);
  if (days === null) return null;
  var sd = stepDaysOf(step);
  var span = daysBetween(offsetIso, todayIso);
  var end = span >= 0
    ? addDaysIso(offsetIso, (Math.floor(span / sd) + 1) * sd - 1)
    : todayIso;
  return { key: 'delay', kind: 'delay', title: 'Просрочка согласования',
    start: m.approveD, end: end, days: days };
}
```

3. В `return` модуля добавить `delayDays: delayDays, delayBar: delayBar` в
   строку с `barsForModule`/`layoutBars`.

4. `node /tmp/kilo/test-gantt.js` → `ALL OK (… + N checks)`. **RED→GREEN обязателен.**

**Коммит** (после T5, общий snapshot).

## T2 — app.js: красная полоса в разметке Ганта

**Файл:** `www/js/app.js`.

1. В `barsFor()` (строки ~550) — сразу после `var bars = barsForModule(...)`
   вставить:

```js
// Просрочка согласования: days > 0 (при 0 рисовать негде — только колонка 🔴 0).
var db = GanttLogic.delayBar(m, isoOf(new Date()), offsetIso, state.step);
if (db && db.days > 0) bars.push(db);
```

2. В `barsFor()` в `visible.map(...)` — для полосы `delay` не подставлять
   inline-background (цвет задаёт CSS), другим полосам оставить как есть.
   Заменить существующий `return '<div class="gantt-bar ...` на:

```js
var style = 'left:' + p.leftPx + 'px;width:' + Math.max(3, p.widthPx - 2) + 'px';
if (p.kind !== 'delay') style += ';background:' + esc(deal.stageColors[p.color] || '#ccc');
return '<div class="gantt-bar ' + p.kind + (dim ? ' dimmed' : '') + '" style="' + style +
  '" title="' + esc(p.title + ': ' + fmtD(parseD(p.start)) + '–' + fmtD(parseD(p.end))) + '"></div>';
```

   (`dim` для delay не критичен: завершённые модули туда не попадают.)

**Верификация:** `node --check www/js/app.js` — без ошибок; визуальная
проверка полосы — в живой проверке после деплоя.

## T3 — app.js: колонка 🔴

**Файл:** `www/js/app.js`. Все точки правки:

1. `HEAD_COLS` — дописать в конец (после «Р»):

```js
{ label: '🔴', cls: 'num', key: 'delay', title: 'Задержка согласования — дней от даты согласования до сегодня' }
```

2. `STICKY_W` → `[210, 46, 34, 34, 68, 68, 34, 34, 34, 34, 34]` (+34 в конец);
   `STICKY_KEYS` → дописать `'delay'` в конец.
3. `cellValue()` — до `return` добавить:

```js
if (key === 'delay') {
  var dd = GanttLogic.delayDays(m, isoOf(new Date()));
  return dd === null ? '—' : String(dd);
}
```

4. `sortKey()` — до `return` добавить: `if (key === 'delay') return GanttLogic.delayDays(m, isoOf(new Date()));`
   (`null` уже укладывается в общий механизм «пустые в конец»).
5. `renderBody()`, строка модуля — после `<div class="num run-cell cell-run">…</div>`
   вставить `'<div class="num delay-cell cell-delay">' + esc(cellValue(m, 'delay')) + '</div>' +`.
6. `renderBody()`, строка этапа — после `'<div class="run-cell"></div>'`
   вставить `'<div class="cell-delay"></div>' +`.
7. `updateGantt()` — после блока с `run.textContent` добавить:

```js
var dcell = row.querySelector('.cell-delay');
if (dcell) dcell.textContent = row.classList.contains('stage') ? '' : cellValue(m, 'delay');
```

**Верификация:** `node --check www/js/app.js` — без ошибок;
`grep -c "cell-delay" www/js/app.js` → ≥ 3.

## T4 — CSS + заполнитель groupEntry

**Файлы:** `www/css/app.css`, `www/template.html`.

1. `www/template.html`, `#groupEntry` — после `<div class="run-cell"></div>`
   (строка 95) вставить строку `<div class="cell-delay"></div>` (заполнитель
   новой sticky-колонки, чтобы `gw-actions` не сместился).
2. `www/css/app.css`:
   - у `.run-cell` (строка ~177) убрать `border-right: 1px solid var(--ink);`
     (граница блока уходит на новую последнюю колонку);
   - у `.h-cell.col-run` (строка ~187) убрать `border-right: 1px solid var(--ink);`;
   - добавить:

```css
.cell-delay { left: var(--sticky-delay); border-right: 1px solid var(--ink); font-size: 11px; }
.h-cell.col-delay { left: var(--sticky-delay); border-right: 1px solid var(--ink); }
.gantt-bar.delay { background: rgba(213, 0, 0, .75); }
```

**Верификация:** `grep -n "cell-delay\|gantt-bar.delay" www/css/app.css` —
находятся все три правила; `grep -n "cell-delay" www/template.html` — 1 строка.

## T5 — полная проверка + журнал

1. `node /tmp/kilo/test-gantt.js` → ALL OK; `node --check www/js/app.js` и
   `node --check www/js/gantt-logic.js` — без ошибок.
2. PHP не менялся — `php -l` не требуется.
3. Обновить журнал по AGENTS.md: `docs/state.md` (фича сделана в ветке, живая
   проверка — после деплоя), запись в `docs/changelog.md` у маркера
   `<!-- Новые записи добавляй ... -->`, при необходимости `docs/decisions.md`
   (решение о 0 дней — кандидат в D-NNN).
4. `bash scripts/snapshot.sh "фича: красная полоса просрочки согласования + колонка 🔴 (ветка красная-линия-при-задержке)"`.
5. `git status` — рабочее дерево чистое.

## Что НЕ делаем (не-цели из дизайна)

- Никаких изменений `www/api/graph.php`, БД, БП портала, `mock/`.
- Никаких фолбэков при пустой `approveD` (пустая = нет просрочки, прочерк).
- Деплой не делаем — только по явной цели пользователя.

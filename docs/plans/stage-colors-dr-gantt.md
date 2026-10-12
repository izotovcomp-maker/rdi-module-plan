# План: ДР-колонка, палитра Ганта, интервалы от check/create

Дизайн: [design/stage-colors-dr-gantt.md](../../design/stage-colors-dr-gantt.md) (утверждён 2026-10-12).
Каждая задача: TDD (тест раньше кода), верификация обязательна, снимок `bash scripts/snapshot.sh "<текст>"`.

| # | Задача | Файлы | Верификация | Статус |
|---|--------|-------|-------------|--------|
| T1 | API: `dayCheck` + `stageColors` в GET | `www/api/graph.php`, `/tmp/kilo/test-b1.php` | тест-b1 RED→GREEN, `php -l` | ☐ |
| T2 | API: `DAY2_CHECK` в whitelist save | `www/api/graph.php`, `/tmp/kilo/test-b2.php` | тест-b2 RED→GREEN, `php -l` | ☐ |
| T3 | Вынос чистой логики в `gantt-logic.js` + новые интервалы | `www/js/gantt-logic.js` (новый), `/tmp/kilo/test-gantt.js` (новый) | node-тест RED→GREEN | ☐ |
| T4 | UI: колонки ДЗ/ДР/ДК/ДО/ДС, dayCheck в правках, seed нулей | `www/js/app.js`, `www/template.html`, `www/css/app.css` | тесты T1–T3 зелёные; grep-проверки; `node --check app.js` | ☐ |
| T5 | Журнал + снимок | `docs/state.md`, `docs/changelog.md` | snapshot commit | ☐ |
| T6 | Деплой + живая проверка на портале | — | только по явной цели пользователя | ☐ |

---

## T1 — API GET: dayCheck и stageColors

**Тест (RED):** в `/tmp/kilo/test-b1.php` (существующий harness, FakeB24-заглушка
с реальной формой ответа портала — total/next на верхнем уровне):

1. `mapModule()` с `$item['UF_CRM_14_MOD_DAY2_CHECK'] = '7'` → `'dayCheck' => '7'`;
   без поля → `''`-поведение как у остальных длительностей (`?? ''`).
2. `graph_handle()` (stub b24) → в ответе `stageColors`:
   `['NEW'=>'#000000','PREPARATION'=>'#fff300','CLIENT'=>'#10e5fc',
     'UC_AJTX21'=>'#ace9fb','UC_PM02XS'=>'#fff300','UC_M71TWU'=>'#00a74c']`
   — ключ = суффикс STATUS_ID, значение = COLOR из stub-строк `crm.status.list`;
   пустой COLOR → `'#ccc'` (текущее поведение `graph_statusAbbrMap`).

**Код (GREEN):**
- `mapModule()`: + `'dayCheck' => $item['UF_CRM_14_MOD_DAY2_CHECK'] ?? '',`
- `graph_handle()`: из `$statusMap` собрать `stageColors`:
  ```php
  $stageColors = [];
  foreach ($statusMap as $sid => $v) $stageColors[graph_statusIdOf($sid)] = $v['color'];
  ```
  → в ответ + `'stageColors' => $stageColors`.
- Docblock шапки: добавить dayCheck/stageColors.

**Верификация:** `php /tmp/kilo/test-b1.php` → ALL OK; `php -l www/api/graph.php`.

## T2 — API save: whitelist ДР

**Тест (RED):** в `/tmp/kilo/test-b2.php`:
1. `graph_cleanFields(['UF_CRM_14_MOD_DAY2_CHECK'=>5])` → поле сохранено как int 5.
2. `graph_cleanFields(['UF_CRM_14_MOD_DAY2_CHECK'=>'abc'])` → null.
3. Постороннее поле (`UF_CRM_14_MOD_RUN`) по-прежнему отбрасывается молча.

**Код (GREEN):** `GRAPH_SAVE_DUR_FIELDS` += `'UF_CRM_14_MOD_DAY2_CHECK'`.
Комментарий константы: «2 даты + 5 длительностей = ровно 7 полей ТЗ; остальные
даты считает БП портала — на портал не пишем».

**Верификация:** `php /tmp/kilo/test-b2.php` → ALL OK; `php -l`.

## T3 — gantt-logic.js: чистая логика + новые интервалы

**Файл `www/js/gantt-logic.js` (новый):**
```js
/* График модулей: чистая логика (без DOM). Используется app.js и node-тестом. */
var GanttLogic = (function () {
  var DAY_MS = 24*3600*1000;
  var MONTHS = [...];
  var STATUS_ORDER = ['Зап','Расс','Разр','Корр','Ож','Согл','Завр','Анну'];
  var STATUS_COMPLETED = ['Завр','Анну'];
  var STATUS_DARK_BG = ['Зап'];
  var DUR_KEYS = ['dayRun','dayCheck','dayEdit','dayWait','dayApprove'];
  // parseD, fmtD, fmtDyy, parseDyy, isoOf, addDaysIso, daysBetween,
  // runDays (create−check+1), yearLabels, monthLabels, STEP_MAP, stepDaysOf,
  // buildCols, barColumns, defaultOffsetIso, todayIndex — перенос из app.js без изменений.
  function barsForModule(m, stageColors) { ... }   // см. ниже
  function seedZeroDurations(modules, editsMap) { ... }
  function validateEdits(modules, editsMap) { ... } // без «Длительность не задана»
  return { DAY_MS, MONTHS, STATUS_ORDER, STATUS_COMPLETED, STATUS_DARK_BG,
           DUR_KEYS, parseD, fmtD, fmtDyy, parseDyy, isoOf, addDaysIso,
           daysBetween, runDays, yearLabels, monthLabels, STEP_MAP, stepDaysOf,
           buildCols, barColumns, defaultOffsetIso, todayIndex,
           barsForModule, seedZeroDurations, validateEdits };
})();
if (typeof window !== 'undefined') window.GanttLogic = GanttLogic;
if (typeof module !== 'undefined') module.exports = GanttLogic;
```

**`barsForModule(m, stageColors)`** — полная замена. `stageColors` — карта
суффикс→цвет (сервер, fallback `'#ccc'` в самой карте):
```js
// m: {check, create, dayRun, dayCheck, dayEdit, dayWait, dayApprove} — eff-значения
// Возвращает [{key, kind, title, start, end, color}] или [] если нет check/create.
if (!m.check || !m.create) return [];
var dur = function (k) { var n = Number(m[k]); return isFinite(n) && n > 0 ? n : 0; };
var dR = dur('dayCheck'), dZ = dur('dayRun');
var bars = [];
if (dZ > 0) bars.push({ key:'run',  kind:'secondary', title:'Запуск',
  start:addDaysIso(m.check, -(dZ + dR)), end:addDaysIso(m.check, -dR), color:'NEW' });
if (dR > 0) bars.push({ key:'ras',  kind:'secondary', title:'Рассмотрение',
  start:addDaysIso(m.check, -dR), end:m.check, color:'PREPARATION' });
bars.push({ key:'main', kind:'accent', title:'Разработка',
  start:m.check, end:m.create, color:'CLIENT' });
var e1 = addDaysIso(m.create, dur('dayEdit'));
if (dur('dayEdit') > 0) bars.push({ key:'edit', kind:'secondary', title:'Корректировка',
  start:m.create, end:e1, color:'UC_AJTX21' });
var e2 = addDaysIso(e1, dur('dayWait'));
if (dur('dayWait') > 0) bars.push({ key:'wait', kind:'secondary', title:'Ожидание',
  start:e1, end:e2, color:'UC_PM02XS' });
var e3 = addDaysIso(e2, dur('dayApprove'));
if (dur('dayApprove') > 0) bars.push({ key:'approve', kind:'secondary', title:'Согласование',
  start:e2, end:e3, color:'UC_M71TWU' });
return bars;
```
`color` — КОД стадии; перевод в конкретный цвет — в `app.js` при рендере
(`stageColors[b.color] || '#ccc'`), чтобы логика оставалась чистой.

**`seedZeroDurations(modules, editsMap)`:** для каждого модуля и каждого
`DUR_KEYS`: если значение `''/null/undefined` → `module[k] = 0` и, если в
`editsMap[id]` ещё нет ключа `k`, `editsMap[id][k] = 0`. Возвращает editsMap.
(Модуль мутируется — вызывается сразу после normalizeModule, до render.)

**`validateEdits(modules, editsMap)`** — перенос из app.js с правками:
- убрать ошибку «Длительность не задана» (пустые уже 0 после seed);
- оставить: check ≤ create (пара ошибок на оба поля, как сейчас), «Не число»,
  «Отрицательная длительность».

**Тест `/tmp/kilo/test-gantt.js` (RED до кода)** — node, plain asserts:
1. Интервалы: check=2026-03-10, create=2026-03-20, ДЗ=5, ДР=3, ДК=2, ДО=1, ДС=4 →
   Запуск 03-02→03-07, Рассмотрение 03-07→03-10, Разработка 03-10→03-20,
   Корр 03-20→03-22, Ож 03-22→03-23, Согл 03-23→03-27; color-коды соответствуют.
2. Длительность 0/'' → полосы этой стадии нет; ДЗ=ДР=0 → первые две полосы нет,
   Разработка есть.
3. Нет create (или check) → `[]`.
4. `runDays` = 11.
5. `seedZeroDurations`: пустые длительности → 0 в модуле и в editsMap; уже
   заполненные не трогает; существующие правки не перетирает.
6. `validateEdits`: check>create → 2 ошибки; dayRun=-1 → ошибка; все нули → 0 ошибок.

**Верификация:** `node /tmp/kilo/test-gantt.js` → ALL OK.

## T4 — UI-интеграция app.js + template + css

1. `www/template.html`: `<script src="js/gantt-logic.js"></script>` ПЕРЕД `js/app.js`.
2. `www/js/app.js`:
   - Удалить перенесённые чистые функции; в начале IIFE:
     `var G = window.GanttLogic;` и деструктуризация имён, чтобы остальной код
     не менять (parseD, fmtD, fmtDyy, parseDyy, isoOf, addDaysIso, daysBetween,
     runDays, yearLabels, monthLabels, STEP_MAP, stepDaysOf, buildCols,
     barColumns, defaultOffsetIso, todayIndex, MONTHS, DAY_MS, STATUS_ORDER,
     STATUS_COMPLETED, STATUS_DARK_BG, DUR_KEYS, barsForModule, validateEdits).
   - `normalizeModule()`: + `dayCheck: normDur(m.dayCheck),` (runD/editD/waitD/
     approveD оставить в нормализации — поля ответа не ломаем).
   - После `deal.modules = …map(normalizeModule)` в `loadDeal()`:
     `G.seedZeroDurations(deal.modules, edits);`
   - `HEAD_COLS` (порядок/подписи): Статус · **ДЗ**(dayRun) · **ДР**(dayCheck) ·
     Рассмотр.(check) · Разработка(create) · **ДК**(dayEdit) · **ДО**(dayWait) ·
     **ДС**(dayApprove) · Р(run). title-подсказки обновить («Дни на …»).
   - `EDIT_FIELDS`: `{key:'dayCheck', type:'number'}` после dayRun.
   - `FIELD_MAP`: + `dayCheck: 'UF_CRM_14_MOD_DAY2_CHECK'`.
   - `setGridCols`: сетка на 9 колонок, например
     `'minmax(170px, 210px) 46px 34px 34px 84px 84px 34px 34px 34px 34px repeat('+nCols+', '+COL_W+'px)'`.
   - Строчные заглушки stage-строки в `renderBody`: пересчитать количество
     placeholder-`<div>` под 9 колонок (kp-note остаётся под «по КП» = колонка
     Разработка — уточнить по факту).
   - `barsFor()`: color-код полосы → `"background:" + esc(stageColors[b.color] || '#ccc')`;
     `deal.stageColors` из ответа API (в `loadDeal()`: `deal.stageColors = res.stageColors || {}`).
     Классы `accent/secondary/dimmed` не трогать.
   - Групповое окно: поле ДР (gw-dayCheck) — добавить в разметку template.html по
     аналогии с gw-dayRun.
   - Локальные `DUR_KEYS`, `validateEdits` из app.js удалить (берутся из G).
3. `www/css/app.css`: при необходимости ширина под новую колонку (сетка задаётся
   `--grid-cols` из JS; проверить, что CSS не фиксирует старое число колонок).

**Верификация:** `node --check www/js/gantt-logic.js && node --check www/js/app.js`;
`php /tmp/kilo/test-b1.php && php /tmp/kilo/test-b2.php && node /tmp/kilo/test-gantt.js`
→ ALL OK; grep: в app.js нет `barsForModule`-тела, есть `seedZeroDurations`,
в FIELD_MAP 7 полей, в HEAD_COLS подписи «ДЗ/ДР/ДК/ДО/ДС».

## T5 — Журнал и снимок

- `docs/state.md`: фаза «ДР + палитра Ганта: реализовано локально, ждёт деплоя и
  живой проверки»; карта проекта — ссылки на новый дизайн/план.
- `docs/changelog.md`: запись сверху (маркер).
- `docs/decisions.md` (D-008): «пустые длительности = 0 с авто-правкой на
  отправку; интервалы Ганта считаются на клиенте от check/create, в Б24 пишутся
  только 7 полей».
- `bash scripts/snapshot.sh "ДР-колонка, палитра Ганта, интервалы от check/create (T1–T4)"`.

## T6 — Деплой и живая проверка

Только после явной цели пользователя (куда деплоить). Порядок: `bash deploy.sh` →
md5-сверка → живая проверка вкладки: ДР-колонка, нули-автоправки, цвета полос по
палитре, интервалы при правке ДЗ/ДР/ДК/ДО/ДС, отправка — в Б24 уходят только 7 полей.

## Не входит (YAGNI)
Пересчёт дат стадий в Б24; изменения БП портала; макет mock/; авто-бинд
плейсментов; кэш crm.status.list (старое замечание B4 — отдельно).

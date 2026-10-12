<?php
declare(strict_types=1);

/**
 * График модулей: загрузка данных по сделке (сделка = смарт-процесс 1038).
 *
 * GET  ?dealId=<ID> → { ok:true, dealId, stages:[{id,title,dstart,dfinish}],
 *                       modules:[{id,title,num,sname,status,statusColor,stageId,check,create,
 *                                 runD,editD,waitD,approveD,dayRun,dayCheck,dayEdit,dayWait,dayApprove}],
 *                       stageColors:{<суффикс STATUS_ID>: <цвет>} }
 * POST ?dealId=<ID>&action=save, JSON {updates:[{id, fields:{...}}]}
 *      → { ok:true, saved:N, skipped:[{id,reason}], errors:[{id,error}] }
 *
 * stages  — crm.item.list entityTypeId=1042, filter parentId1038=dealId;
 *           dstart/dfinish = UF_CRM_10_MST_DSTART/DFINISH.
 * modules — crm.item.list entityTypeId=1050, filter parentId1038=dealId;
 *           check/create = UF_CRM_14_MOD_CHECK/CREATE, dayRun..dayApprove =
 *           UF_CRM_14_MOD_DAY2_RUN/CHECK/EDIT/WAIT/APPROVE, runD/editD/waitD/approveD =
 *           UF_CRM_14_MOD_RUN/EDIT/WAIT/APPROVE, stageId = parentId1042 (этап сделки).
 *           num/sname = UF_CRM_14_MOD_NUM/SNAME (fallback — разбор title «…_N-КР_01-…»).
 * status/statusColor — стадия модуля в его собственной воронке (stageId вида
 *           DT1050_20:NEW): crm.category.list (entityTypeId=1050, isDefault=Y) →
 *           crm.status.list (ENTITY_ID='C1050:<id>'), карта STATUS_ID → аббревиатура/цвет.
 * stageColors — та же crm.status.list, ключ = суффикс STATUS_ID, значение = COLOR
 *           ('' → '#ccc') — палитра полос Ганта на клиенте. Список на портале
 *           СМЕШАННЫЙ (147 строк всех воронок), поэтому свёртка по суффиксу идёт
 *           только по строкам с префиксом воронки модулей 'DT1050_<catId>:' —
 *           иначе чужие воронки (голый CLIENT лидов, «ТКП» DT1038_22:CLIENT)
 *           перебивают эталонные цвета.
 *
 * Кворк портала ooordi (D-006): useOriginalUfNames=Y (его подставляет b24()) вместе
 * с select молча выкидывает системные поля из ответа, а N+select — UF-поля.
 * Поэтому select НЕ задан (noselect): Y+noselect отдаёт всё — системные ключи
 * camelCase (id, stageId, parentId1042), UF — UPPER_CASE.
 *
 * crm.item.list отдаёт по 50 записей: первая страница — call(), остальные —
 * batch() (правило rule-b24-rest-batch-not-loop), не больше MAX_PAGES страниц
 * (защита от зацикливания).
 *
 * Доступ: сессия шаблона + accessAllows() по текущему режиму (как в других
 * не-admin эндпоинтах). Неавторизованный → {ok:false,error:'access'} 403.
 */

define('APP_ROOT', dirname(__DIR__));
require_once APP_ROOT . '/env.php';
require_once APP_ROOT . '/api/store.php';
require_once APP_ROOT . '/api/b24.php';
require_once APP_ROOT . '/api/session.php';

const GRAPH_ENTITY_DEAL   = 1038;
const GRAPH_ENTITY_STAGE  = 1042;
const GRAPH_ENTITY_MODULE = 1050;
const GRAPH_PAGE_SIZE     = 50;
const GRAPH_MAX_PAGES     = 20;

// ── Чистые функции (покрыты локальным тестом /tmp/kilo/test-b1.php) ─────────

/** STATUS_ID воронки модулей → сокращение (жёстко, из ТЗ). */
const GRAPH_STATUS_ABBR = [
    'NEW'         => 'Зап',
    'PREPARATION' => 'Расс',
    'CLIENT'      => 'Разр',
    'UC_AJTX21'   => 'Корр',
    'UC_PM02XS'   => 'Ож',
    'UC_M71TWU'   => 'Согл',
    'SUCCESS'     => 'Завр',
    'FAIL'        => 'Анну',
];

/** dealId — положительное целое, иначе null. */
function normalizeDealId($raw): ?int {
    if (is_int($raw)) return $raw > 0 ? $raw : null;
    if (is_string($raw) && preg_match('/^\d{1,12}$/', $raw)) {
        $id = (int)$raw;
        return $id > 0 ? $id : null;
    }
    return null;
}

/** Этап → {id,title,dstart,dfinish}. */
function mapStage(array $item): array {
    return [
        'id'      => (int)($item['id'] ?? 0),
        'title'   => (string)($item['title'] ?? ''),
        'dstart'  => (string)($item['UF_CRM_10_MST_DSTART'] ?? ''),
        'dfinish' => (string)($item['UF_CRM_10_MST_DFINISH'] ?? ''),
    ];
}

/**
 * num/sname из title модуля по БП: «<этап>_<номер>-<шифр раздела>-…»,
 * шифр вида «ИИ_01». Не разобралось → пустые строки.
 */
function graph_numSname(string $title): array {
    if (preg_match('/_([0-9]{1,5})-([A-Za-zА-Яа-яЁё]+_[0-9]+)/u', $title, $m)) {
        return [$m[1], $m[2]];
    }
    return ['', ''];
}

/**
 * Стадия воронки модуля → {abbr, color}. crm.status.list на этом портале возвращает
 * СМЕШАННЫЙ список всех воронок (голые NEW/CLIENT от лидов перекрывают нужные),
 * поэтому карта ключуется ПОЛНЫМ STATUS_ID ('DT1050_20:NEW' — как stageId модуля),
 * а abbr берётся по суффиксу из GRAPH_STATUS_ABBR (пользовательские — первые 4
 * символа NAME, color = COLOR или '#ccc').
 */
function graph_statusAbbrMap(array $rows): array {
    $map = [];
    foreach ($rows as $r) {
        if (!is_array($r)) continue;
        $sid = (string)($r['STATUS_ID'] ?? '');
        if ($sid === '') continue;
        $suffix = graph_statusIdOf($sid);
        $abbr  = GRAPH_STATUS_ABBR[$suffix] ?? mb_substr(trim((string)($r['NAME'] ?? '')), 0, 4);
        $color = (string)($r['COLOR'] ?? '');
        $map[$sid] = ['abbr' => $abbr, 'color' => $color !== '' ? $color : '#ccc'];
    }
    return $map;
}

/** STATUS_ID из стадия-строки модуля crm.item ('DT1050_20:NEW' → 'NEW'). */
function graph_statusIdOf(string $funnelStage): string {
    if ($funnelStage === '') return '';
    $p = strrpos($funnelStage, ':');
    return $p === false ? $funnelStage : substr($funnelStage, $p + 1);
}

/** Модуль → полный ответ-объект. $statusMap — карта graph_statusAbbrMap(). */
function mapModule(array $item, array $statusMap = []): array {
    // num/sname: UF — главный источник (реальные поля портала), fallback — разбор title.
    $num   = (string)($item['UF_CRM_14_MOD_NUM'] ?? '');
    $sname = (string)($item['UF_CRM_14_MOD_SNAME'] ?? '');
    if ($num === '' && $sname === '') [$num, $sname] = graph_numSname((string)($item['title'] ?? ''));
    // Статус модуля — по ПОЛНОМУ stageId ('DT1050_20:NEW'); fallback — суффикс
    // (если полного ключа в списке статусов нет).
    $full = (string)($item['stageId'] ?? '');
    $sid  = graph_statusIdOf($full);
    $stat = $statusMap[$full] ?? $statusMap[$sid] ?? null;
    return [
        'id'          => (int)($item['id'] ?? 0),
        'title'       => (string)($item['title'] ?? ''),
        'num'         => $num,
        'sname'       => $sname,
        'status'      => $stat['abbr'] ?? '',
        'statusColor' => $stat['color'] ?? '#ccc',
        'stageId'     => isset($item['parentId1042']) ? (int)$item['parentId1042'] : null,
        'check'       => $item['UF_CRM_14_MOD_CHECK'] ?? '',
        'create'      => $item['UF_CRM_14_MOD_CREATE'] ?? '',
        'runD'        => $item['UF_CRM_14_MOD_RUN'] ?? '',
        'editD'       => $item['UF_CRM_14_MOD_EDIT'] ?? '',
        'waitD'       => $item['UF_CRM_14_MOD_WAIT'] ?? '',
        'approveD'    => $item['UF_CRM_14_MOD_APPROVE'] ?? '',
        'dayRun'      => $item['UF_CRM_14_MOD_DAY2_RUN'] ?? '',
        'dayCheck'    => $item['UF_CRM_14_MOD_DAY2_CHECK'] ?? '',
        'dayEdit'     => $item['UF_CRM_14_MOD_DAY2_EDIT'] ?? '',
        'dayWait'     => $item['UF_CRM_14_MOD_DAY2_WAIT'] ?? '',
        'dayApprove'  => $item['UF_CRM_14_MOD_DAY2_APPROVE'] ?? '',
    ];
}

/**
 * Команды batch для догрузки страниц crm.item.list начиная со start.
 * Возвращает пары [ключ, start], ключи k1, k2, …
 */
function buildPagination(int $start, int $total, int $pageSize): array {
    $pages = [];
    $i = 1;
    for ($s = $start; $s < $total && count($pages) < GRAPH_MAX_PAGES; $s += $pageSize) {
        $pages['k' . $i++] = $s;
    }
    return $pages;
}

/**
 * Все страницы crm.item.list по фильтру. Первая страница — call(), остальные —
 * batch() чанками по 50 команд. Ошибка REST → RuntimeException.
 */
function graphListAll($b24, int $entityTypeId, int $dealId): array {
    $params = [
        'entityTypeId' => $entityTypeId,
        // Без select (noselect): на портале ooordi кворк useOriginalUfNames —
        // Y+select отдаёт только UF-поля, N+UPPER_CASE-UF молча выпадает из ответа.
        // Y+noselect отдаёт всё: системные ключи camelCase, UF — UPPER_CASE (D-006).
        'filter'       => ['parentId' . GRAPH_ENTITY_DEAL => $dealId],
        'start'        => 0,
    ];

    $first = $b24->call('crm.item.list', $params);
    if (!empty($first['error'])) {
        throw new RuntimeException('crm.item.list: ' . ($first['error_description'] ?? $first['error']));
    }
    $result = (array)($first['result'] ?? []);
    $items  = array_values((array)($result['items'] ?? []));
    // total и next — на ВЕРХНЕМ уровне ответа (Дебаг 2026-10-12: page1 next=50,
    // page2 next=null). Внутри result их нет — чтение оттуда молча отключало
    // пагинацию: график терял все страницы после первой (65 total → 50 в ответе).
    $next   = $first['next'] ?? null;

    if ($next !== null) {
        $total = (int)($first['total'] ?? 0);
        $cmds  = [];
        foreach (buildPagination((int)$next, $total, GRAPH_PAGE_SIZE) as $key => $start) {
            $cmds[$key] = ['crm.item.list', ['start' => $start] + $params];
        }
        foreach (array_chunk($cmds, 50, true) as $chunk) {
            $res = $b24->batch($chunk);
            if (!empty($res['error'])) {
                throw new RuntimeException('batch: ' . ($res['error_description'] ?? $res['error']));
            }
            $pages = (array)($res['result']['result'] ?? []);
            $errs  = (array)($res['result']['result_error'] ?? []);
            if ($errs) {
                $e = reset($errs);
                throw new RuntimeException('crm.item.list (batch): ' .
                    (is_array($e) ? ($e['error_description'] ?? json_encode($e, JSON_UNESCAPED_UNICODE)) : (string)$e));
            }
            foreach (array_keys($chunk) as $k) {
                foreach ((array)($pages[$k]['items'] ?? []) as $it) $items[] = $it;
            }
        }
    }
    return $items;
}

/**
 * Карта статусов воронки модулей: crm.category.list (entityTypeId=1050, берём
 * isDefault=Y, иначе первую) → crm.status.list (ENTITY_ID='C1050:<id>').
 * Возвращает ['map' => graph_statusAbbrMap(...), 'prefix' => 'DT1050_<catId>:']:
 * prefix — префикс полного STATUS_ID воронки модулей (crm.status.list на портале
 * отдаёт смешанный список всех воронок, stageColors фильтруется по префиксу).
 * Нет категории → ['map' => [], 'prefix' => '']. Ошибка REST → RuntimeException.
 */
function graph_statusMap($b24): array {
    $cat = $b24->call('crm.category.list', ['entityTypeId' => GRAPH_ENTITY_MODULE]);
    if (!empty($cat['error'])) {
        throw new RuntimeException('crm.category.list: ' . ($cat['error_description'] ?? $cat['error']));
    }
    $cats = array_values((array)($cat['result']['categories'] ?? []));
    $chosen = null;
    foreach ($cats as $c) {
        if (is_array($c) && (($c['isDefault'] ?? '') === 'Y' || ($c['isDefault'] ?? false) === true)) { $chosen = $c; break; }
    }
    if ($chosen === null && $cats !== []) $chosen = $cats[0];
    if (!is_array($chosen) || empty($chosen['id'])) return ['map' => [], 'prefix' => ''];
    $st = $b24->call('crm.status.list', ['ENTITY_ID' => 'C1050:' . (int)$chosen['id']]);
    if (!empty($st['error'])) {
        throw new RuntimeException('crm.status.list: ' . ($st['error_description'] ?? $st['error']));
    }
    return [
        'map'    => graph_statusAbbrMap((array)($st['result'] ?? [])),
        'prefix' => 'DT' . GRAPH_ENTITY_MODULE . '_' . (int)$chosen['id'] . ':',
    ];
}

/**
 * Вся загрузка по сделке. $b24 — экземпляр B24 (call/batch) — тестируется
 * с closure-заглушкой. Ошибка REST → RuntimeException.
 */
function graph_handle($b24, int $dealId): array {
    // Заголовок сделки: crm.item.get на портале приходит с пустым title —
    // проверенный путь crm.item.list с filter:id (Дебаг 2026-10-12).
    $deal = $b24->call('crm.item.list', ['entityTypeId' => GRAPH_ENTITY_DEAL, 'filter' => ['id' => $dealId]]);
    if (!empty($deal['error'])) {
        throw new RuntimeException('crm.item.list: ' . ($deal['error_description'] ?? $deal['error']));
    }
    $first = (array)(($deal['result']['items'] ?? [])[0] ?? []);
    $dealTitle = (string)($first['title'] ?? '');
    $stages    = array_map('mapStage',  graphListAll($b24, GRAPH_ENTITY_STAGE, $dealId));
    $statusData = graph_statusMap($b24);
    $statusMap  = $statusData['map'];
    $modules   = array_map(static fn(array $it): array => mapModule($it, $statusMap),
                           graphListAll($b24, GRAPH_ENTITY_MODULE, $dealId));
    $truncated = count($stages) >= GRAPH_MAX_PAGES * GRAPH_PAGE_SIZE
              || count($modules) >= GRAPH_MAX_PAGES * GRAPH_PAGE_SIZE;
    // Палитра Ганта: суффикс STATUS_ID → цвет (клиент маппит коды полос на цвета).
    // Свёртка ТОЛЬКО по строкам воронки модулей (prefix 'DT1050_<catId>:'):
    // crm.status.list отдаёт смешанный список всех воронок, суффиксы чужих
    // (голый CLIENT лидов, «ТКП» DT1038_22:CLIENT) перебивали эталонные цвета.
    $stageColors = [];
    if ($statusData['prefix'] !== '') {
        foreach ($statusMap as $sid => $v) {
            if (strpos($sid, $statusData['prefix']) === 0) $stageColors[graph_statusIdOf($sid)] = $v['color'];
        }
    }
    return [
        'ok'          => true,
        'dealId'      => $dealId,
        'dealTitle'   => $dealTitle,
        'stages'      => $stages,
        'modules'     => $modules,
        'stageColors' => $stageColors,
        'truncated'   => $truncated, // cap страниц пагинации достигнут — данные могут быть неполными
        'serverTime'  => date('c'),
    ];
}

// ── Сохранение (action=save) — чистые функции (тест /tmp/kilo/test-b2.php) ──

/**
 * Разрешённые поля записи: 2 даты (YYYY-MM-DD или '' — очистка) и 5 длительностей
 * (целые ≥ 0). 2 даты + 5 длительностей = ровно 7 полей ТЗ; остальные даты
 * считает БП портала — на портал не пишем.
 */
const GRAPH_SAVE_DATE_FIELDS = ['UF_CRM_14_MOD_CHECK', 'UF_CRM_14_MOD_CREATE'];
const GRAPH_SAVE_DUR_FIELDS  = ['UF_CRM_14_MOD_DAY2_RUN', 'UF_CRM_14_MOD_DAY2_EDIT',
                                'UF_CRM_14_MOD_DAY2_WAIT', 'UF_CRM_14_MOD_DAY2_APPROVE',
                                'UF_CRM_14_MOD_DAY2_CHECK'];

/**
 * Тело POST: JSON {updates:[{id, fields:{...}}]} → ['updates' => [...]] или null.
 */
function graph_parseSaveBody(string $raw): ?array {
    $data = json_decode($raw, true);
    if (!is_array($data) || !array_key_exists('updates', $data) || !is_array($data['updates'])) {
        return null;
    }
    return ['updates' => $data['updates']];
}

/**
 * Разрешённые поля с проверкой значений; лишние поля отбрасываются.
 * Значение неразрешённого типа у разрешённого поля → null (весь апдейт skipped).
 */
function graph_cleanFields(array $fields): ?array {
    $clean = [];
    foreach ($fields as $name => $value) {
        if (in_array($name, GRAPH_SAVE_DATE_FIELDS, true)) {
            if ($value === '' || $value === null) { $clean[$name] = ''; continue; }
            if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) return null;
            [$y, $m, $d] = array_map('intval', explode('-', $value));
            if (!checkdate($m, $d, $y)) return null;
            $clean[$name] = $value;
        } elseif (in_array($name, GRAPH_SAVE_DUR_FIELDS, true)) {
            if (is_int($value) ? $value < 0
                : (!(is_string($value) && preg_match('/^\d+$/', $value)))) {
                return null;
            }
            $clean[$name] = (int)$value;
        }
        // лишнее поле — отбрасываем молча
    }
    return $clean;
}

/** Один апдейт → ['id'=>int, 'fields'=>clean] или null. */
function graph_cleanUpdate(array $update): ?array {
    $id = normalizeDealId($update['id'] ?? null);
    if ($id === null || !isset($update['fields']) || !is_array($update['fields'])) return null;
    $fields = graph_cleanFields($update['fields']);
    if ($fields === null) return null;
    return ['id' => $id, 'fields' => $fields];
}

/**
 * Отбор апдейтов, чьи id принадлежат сделке. Возвращает
 * [owned[], skipped: [{id, reason}]].
 */
function graph_filterOwnership(array $updates, array $moduleIds): array {
    $known = array_flip($moduleIds);
    $owned = []; $skipped = [];
    foreach ($updates as $u) {
        if (isset($known[$u['id']])) $owned[] = $u;
        else $skipped[] = ['id' => $u['id'], 'reason' => 'Модуль не принадлежит сделке.'];
    }
    return [$owned, $skipped];
}

/**
 * Отправка апдейтов: batch() чанками по 50 команд crm.item.update
 * (entityTypeId=1050). Ошибки отдельных команд собираются в errors.
 * Ответ: {ok:true, saved, skipped:[], errors:[{id,error}]}.
 */
function graph_save($b24, array $updates, array $skipped = []): array {
    $saved = 0; $errors = [];
    foreach (array_chunk($updates, GRAPH_PAGE_SIZE, true) as $chunk) {
        $cmds = [];
        foreach ($chunk as $i => $u) {
            $cmds['k' . $i] = ['crm.item.update', [
                'entityTypeId' => GRAPH_ENTITY_MODULE,
                'id'           => $u['id'],
                'fields'       => $u['fields'],
            ]];
        }
        $res = $b24->batch($cmds);
        if (!empty($res['error'])) {
            throw new RuntimeException('batch: ' . ($res['error_description'] ?? $res['error']));
        }
        $result = (array)($res['result']['result'] ?? []);
        $errs   = (array)($res['result']['result_error'] ?? []);
        foreach ($chunk as $i => $u) {
            $key = 'k' . $i;
            if (isset($errs[$key])) {
                $e = $errs[$key];
                $errors[] = ['id' => $u['id'], 'error' => is_array($e)
                    ? (string)($e['error_description'] ?? $e['error'] ?? json_encode($e, JSON_UNESCAPED_UNICODE))
                    : (string)$e];
            } elseif (array_key_exists($key, $result)) {
                $saved++;
            } else {
                $errors[] = ['id' => $u['id'], 'error' => 'Нет ответа на команду batch.'];
            }
        }
    }
    return ['ok' => true, 'saved' => $saved, 'skipped' => $skipped, 'errors' => $errors];
}

/**
 * Полный пайплайн сохранения: валидация апдейтов → проверка принадлежности сделке
 * (список модулей через graphListAll) → batch crm.item.update.
 */
function graph_saveFull($b24, int $dealId, array $rawUpdates): array {
    $clean = []; $skipped = [];
    foreach ($rawUpdates as $u) {
        if (!is_array($u)) { $skipped[] = ['id' => null, 'reason' => 'Некорректная запись.']; continue; }
        $c = graph_cleanUpdate($u);
        if ($c === null) {
            $skipped[] = ['id' => is_array($u) && isset($u['id']) ? $u['id'] : null,
                          'reason' => 'Некорректные значения полей.'];
            continue;
        }
        $clean[] = $c;
    }
    $moduleItems = graphListAll($b24, GRAPH_ENTITY_MODULE, $dealId);
    $moduleIds = [];
    foreach ($moduleItems as $item) $moduleIds[] = (int)($item['id'] ?? 0);
    [$owned, $ownSkipped] = graph_filterOwnership($clean, $moduleIds);
    $skipped = array_merge($skipped, $ownSkipped);
    return graph_save($b24, $owned, $skipped);
}

// ── HTTP-обвязка ─────────────────────────────────────────────────────────────

function graphFail(int $code, string $error): void {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $error], JSON_UNESCAPED_UNICODE);
    exit;
}

// HTTP-часть не выполняется в CLI и когда graph.php подключают как библиотеку
// (probe-task.php: нужен только graph_handle — без GRAPH_SKIP_HTTP require под
// веб-SAPI выполнял HTTP-блок и убивал запрос graphFail'ом).
if (PHP_SAPI === 'cli' || defined('GRAPH_SKIP_HTTP')) return;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$method   = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$isSave   = $method === 'POST' && ($_GET['action'] ?? '') === 'save';

if (!$isSave && $method !== 'GET') graphFail(405, 'Только GET или POST action=save.');

// Доступ: сессия шаблона + действующий режим доступа (не только вход).
$session = findSessionFromHeader() ?? findSessionFromCookie();
if (!$session || !sessionIsCurrentlyAllowed($session)) graphFail(403, 'access');

$dealId = normalizeDealId($_GET['dealId'] ?? null);
if ($dealId === null) graphFail(400, 'dealId: ожидалось положительное целое.');

try {
    if ($isSave) {
        $raw = file_get_contents('php://input') ?: '';
        if (strlen($raw) > 1_000_000) graphFail(400, 'Тело запроса слишком большое.'); // защита от абьюза
        $body = graph_parseSaveBody($raw);
        if ($body === null) graphFail(400, 'Ожидался JSON {updates:[{id, fields:{...}}]}.');
        if (count($body['updates']) > 1000) graphFail(400, 'Слишком много обновлений за раз (максимум 1000).');
        echo json_encode(graph_saveFull(b24(), $dealId, $body['updates']), JSON_UNESCAPED_UNICODE);
    } else {
        echo json_encode(graph_handle(b24(), $dealId), JSON_UNESCAPED_UNICODE);
    }
} catch (Throwable $e) {
    graphFail(502, $e->getMessage());
}

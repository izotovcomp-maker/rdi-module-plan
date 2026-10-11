<?php
declare(strict_types=1);

/**
 * График модулей: загрузка данных по сделке (сделка = смарт-процесс 1038).
 *
 * GET  ?dealId=<ID> → { ok:true, dealId, stages:[{id,title,dfinish}],
 *                       modules:[{id,title,check,create,dayRun,dayEdit,dayWait,dayApprove,stageId}] }
 * POST ?dealId=<ID>&action=save, JSON {updates:[{id, fields:{...}}]}
 *      → { ok:true, saved:N, skipped:[{id,reason}], errors:[{id,error}] }
 *
 * stages  — crm.item.list entityTypeId=1042, filter PARENT_ID_1038=dealId;
 *           dfinish = UF_CRM_10_MST_DFINISH.
 * modules — crm.item.list entityTypeId=1050, filter PARENT_ID_1038=dealId;
 *           check/create = UF_CRM_14_MOD_CHECK/CREATE, dayRun..dayApprove =
 *           UF_CRM_14_MOD_DAY2_RUN/EDIT/WAIT/APPROVE, stageId = PARENT_ID_1042.
 *
 * crm.item.list отдаёт по 50 записей: первая страница — call(), остальные —
 * batch() (правило rule-b24-rest-batch-not-loop), не больше MAX_PAGES страниц
 * (защита от зацикливания). useOriginalUfNames='Y' подставляет b24().
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

/** dealId — положительное целое, иначе null. */
function normalizeDealId($raw): ?int {
    if (is_int($raw)) return $raw > 0 ? $raw : null;
    if (is_string($raw) && preg_match('/^\d{1,12}$/', $raw)) {
        $id = (int)$raw;
        return $id > 0 ? $id : null;
    }
    return null;
}

/** Этап → {id,title,dfinish}. */
function mapStage(array $item): array {
    return [
        'id'      => (int)($item['id'] ?? 0),
        'title'   => (string)($item['title'] ?? ''),
        'dfinish' => (string)($item['UF_CRM_10_MST_DFINISH'] ?? ''),
    ];
}

/** Модуль → {id,title,check,create,dayRun,dayEdit,dayWait,dayApprove,stageId}. */
function mapModule(array $item): array {
    return [
        'id'         => (int)($item['id'] ?? 0),
        'title'      => (string)($item['title'] ?? ''),
        'check'      => $item['UF_CRM_14_MOD_CHECK'] ?? null,
        'create'     => $item['UF_CRM_14_MOD_CREATE'] ?? null,
        'dayRun'     => $item['UF_CRM_14_MOD_DAY2_RUN'] ?? null,
        'dayEdit'    => $item['UF_CRM_14_MOD_DAY2_EDIT'] ?? null,
        'dayWait'    => $item['UF_CRM_14_MOD_DAY2_WAIT'] ?? null,
        'dayApprove' => $item['UF_CRM_14_MOD_DAY2_APPROVE'] ?? null,
        'stageId'    => isset($item['PARENT_ID_1042']) ? (int)$item['PARENT_ID_1042'] : null,
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
        'filter'       => ['PARENT_ID_' . GRAPH_ENTITY_DEAL => $dealId],
        'select'       => ['id', 'title', 'UF_CRM_10_MST_DFINISH', 'UF_CRM_14_MOD_CHECK',
                           'UF_CRM_14_MOD_CREATE', 'UF_CRM_14_MOD_DAY2_RUN', 'UF_CRM_14_MOD_DAY2_EDIT',
                           'UF_CRM_14_MOD_DAY2_WAIT', 'UF_CRM_14_MOD_DAY2_APPROVE', 'PARENT_ID_1042'],
        'start'        => 0,
    ];

    $first = $b24->call('crm.item.list', $params);
    if (!empty($first['error'])) {
        throw new RuntimeException('crm.item.list: ' . ($first['error_description'] ?? $first['error']));
    }
    $result = (array)($first['result'] ?? []);
    $items  = array_values((array)($result['items'] ?? []));
    $next   = $result['next'] ?? null;

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
 * Вся загрузка по сделке. $b24 — экземпляр B24 (call/batch) — тестируется
 * с closure-заглушкой. Ошибка REST → RuntimeException.
 */
function graph_handle($b24, int $dealId): array {
    $stages    = array_map('mapStage',  graphListAll($b24, GRAPH_ENTITY_STAGE, $dealId));
    $modules   = array_map('mapModule', graphListAll($b24, GRAPH_ENTITY_MODULE, $dealId));
    $truncated = count($stages) >= GRAPH_MAX_PAGES * GRAPH_PAGE_SIZE
              || count($modules) >= GRAPH_MAX_PAGES * GRAPH_PAGE_SIZE;
    return [
        'ok'         => true,
        'dealId'     => $dealId,
        'stages'     => $stages,
        'modules'    => $modules,
        'truncated'  => $truncated, // cap страниц пагинации достигнут — данные могут быть неполными
        'serverTime' => date('c'),
    ];
}

// ── Сохранение (action=save) — чистые функции (тест /tmp/kilo/test-b2.php) ──

/**
 * Разрешённые поля записи: 2 даты (YYYY-MM-DD или '' — очистка) и 4 длительности
 * (целые ≥ 0).
 */
const GRAPH_SAVE_DATE_FIELDS = ['UF_CRM_14_MOD_CHECK', 'UF_CRM_14_MOD_CREATE'];
const GRAPH_SAVE_DUR_FIELDS  = ['UF_CRM_14_MOD_DAY2_RUN', 'UF_CRM_14_MOD_DAY2_EDIT',
                                'UF_CRM_14_MOD_DAY2_WAIT', 'UF_CRM_14_MOD_DAY2_APPROVE'];

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

// HTTP-часть не выполняется в CLI (локальный тест graph_handle с заглушкой B24).
if (PHP_SAPI === 'cli') return;

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

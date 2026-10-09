<?php
declare(strict_types=1);

/**
 * Дебаг-кнопка: админ нажимает «Дебаг» в приложении, окно показывает текст — результат
 * api/probe-task.php. Админ копирует его кнопкой «Копировать» и отдаёт ЛЛМ в чат.
 * Нужна, потому что ЛЛМ не может сама зайти в приложение на портале (сессия, iframe).
 *
 * Этот файл — стабильная обвязка, его не правят. ЛЛМ правит только api/probe-task.php.
 *
 * Админ-only. Токены и секреты вырезаются из вывода. Вызовы REST из задачи — только чтение
 * (get / list / fields / info / current / search / count): дебаг не должен менять данные портала.
 *
 * GET → { ok: bool, text: string, ms: int }
 */

define('APP_ROOT', dirname(__DIR__));
require_once APP_ROOT . '/env.php';
require_once APP_ROOT . '/api/store.php';
require_once APP_ROOT . '/api/b24.php';
require_once APP_ROOT . '/api/session.php';

requireAdminSession();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const PROBE_READ_ONLY = '/(^|\.)(get|list|fields|info|current|search|count)$/';
const PROBE_SECRET_KEY = '/token|secret|password|passwd|^auth$|^sess|cookie|api[_-]?key/i';

/** Рекурсивно заменяет значения секретных ключей. */
function probeRedact($v) {
    if (!is_array($v)) return $v;
    foreach ($v as $k => $x) {
        $v[$k] = (is_string($k) && preg_match(PROBE_SECRET_KEY, $k)) ? '***скрыто***' : probeRedact($x);
    }
    return $v;
}

/** Проверка, что вызов только читает (для batch — каждая команда). */
function probeAssertReadOnly(string $method, array $params): void {
    if ($method === 'batch') {
        foreach ((array)($params['cmd'] ?? []) as $cmd) {
            probeAssertReadOnly(explode('?', (string)$cmd, 2)[0], []);
        }
        return;
    }
    if (!preg_match(PROBE_READ_ONLY, $method)) {
        throw new RuntimeException("Дебаг только читает: метод {$method} запрещён (разрешены get/list/fields/info/current/search/count)");
    }
}

$t0 = microtime(true);
try {
    $task = require APP_ROOT . '/api/probe-task.php';
    if (!is_callable($task)) throw new RuntimeException('probe-task.php должен возвращать функцию: return function (callable $call) { ... };');

    $b24 = b24();
    $call = function (string $method, array $params = []) use ($b24) {
        probeAssertReadOnly($method, $params);
        return $b24->call($method, $params);
    };
    $result = $task($call);
    $ok = true;
} catch (Throwable $e) {
    $result = ['error' => get_class($e) . ': ' . $e->getMessage()];
    $ok = false;
}

$text = is_string($result)
    ? $result
    : json_encode(probeRedact($result), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);

echo json_encode(['ok' => $ok, 'text' => (string)$text, 'ms' => (int)round((microtime(true) - $t0) * 1000)], JSON_UNESCAPED_UNICODE);

<?php
declare(strict_types=1);

/**
 * ЗАДАЧА ДЛЯ ДЕБАГ-КНОПКИ. Этот файл правит ЛЛМ.
 *
 * Как пользоваться:
 *   1. ЛЛМ пишет сюда код, который достаёт нужные данные (поля сущности, пример записи, ответ метода).
 *   2. `bash deploy.sh` (на prod/customer — только по явной команде человека).
 *   3. Админ открывает приложение, нажимает «Дебаг», копирует текст из окна и присылает в чат.
 *   4. ЛЛМ читает ответ и продолжает работу.
 *
 * Правила:
 *   - Только чтение: $call('crm.item.fields', ...) / list / get / info / current / search / count.
 *     Остальные методы блокирует probe.php.
 *   - Возвращай массив (будет JSON) или строку. Токены и секреты из вывода вырезаются.
 *   - Не возвращай лишнего: ограничивай `select` и `limit` — человек будет копировать это в чат.
 *   - Имена пользовательских полей — UPPER_CASE (UF_CRM_…), crm.item.* — с useOriginalUfNames=Y
 *     (его подставляет b24()). См. docs/agent/dev-rules.md.
 *   - После отладки верни файл к заглушке ниже.
 *
 * @return callable(callable): mixed  function ($call) — $call($method, $params) вернёт ответ Б24 как массив
 */
return function (callable $call) {
    // Съём реальной структуры смарт-процессов 1038 (Сделки), 1050 (Модули), 1042.
    // Пробный dealId: подставь реальный id сделки из карточки, где открыт вкладка.
    $dealId = 12;

    $list1050 = $call('crm.item.list', [
        'entityTypeId' => 1050,
        'filter'       => ['parentId1038' => $dealId],
        'start'        => 0,
    ]);
    $list1042 = $call('crm.item.list', [
        'entityTypeId' => 1042,
        'filter'       => ['parentId1038' => $dealId],
        'start'        => 0,
    ]);

    // Ответ graph.php целиком (реальный пайплайн с mapStage/mapModule).
    require_once APP_ROOT . '/api/graph.php';
    $graph = graph_handle(b24(), $dealId);

    $compactList = static function (array $res): array {
        $items = (array)($res['result']['items'] ?? []);
        $first = (array)($items[0] ?? []);
        return [
            'error'   => $res['error'] ?? null,
            'total'   => $res['total'] ?? null,
            'n_items' => count($items),
            'first_keys' => array_slice(array_keys($first), 0, 20),
        ];
    };

    return [
        'note'      => 'Проверка graph_handle по сделке 12: ответ graph.php + сырые списки.',
        'dealId'    => $dealId,
        'graph'     => $graph,
        'list_1050' => $compactList($list1050),
        'list_1042' => $compactList($list1042),
    ];
};

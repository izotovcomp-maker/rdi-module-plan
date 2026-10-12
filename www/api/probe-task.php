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
    // Диагноз: crm.item.list (1050, parentId1038=12) — total 65, а graphListAll
    // собирает 49. Снимаем сырые метаданные обеих страниц и тот же запрос через batch.
    $dealId = 12;
    $base = ['entityTypeId' => 1050, 'filter' => ['parentId1038' => $dealId]];

    $meta = static function (array $r): array {
        $items = (array)(($r['result'] ?? [])['items'] ?? []);
        $ids = array_map(static fn($it): int => (int)($it['id'] ?? 0), $items);
        return [
            'total'   => $r['total'] ?? null,
            'next'    => $r['next'] ?? null,
            'n'       => count($items),
            'firstId' => $ids[0] ?? null,
            'lastId'  => $ids ? $ids[count($ids) - 1] : null,
            'ids'     => $ids,
        ];
    };

    // Страница 1 — как её видит graphListAll (start=0).
    $p1 = $meta($call('crm.item.list', $base + ['start' => 0]));

    // Страница 2 — прямым вызовом (без batch): возвращает ли портал 15 хвостов.
    $p2 = $meta($call('crm.item.list', $base + ['start' => (int)($p1['next'] ?? 50)]));

    // Тот же запрос через batch — проверка парсинга result.result.k1 в graphListAll.
    $bt = $call('batch', ['halt' => 0, 'cmd' => [
        'k1' => 'crm.item.list?' . http_build_query($base + ['start' => (int)($p1['next'] ?? 50)]),
    ]]);
    $batch = [
        'top_keys'    => array_keys($bt),
        'result_keys' => array_keys((array)($bt['result'] ?? [])),
        'k1_items'    => count((array)((($bt['result'] ?? [])['result'] ?? [])['k1']['items'] ?? ($bt['result']['k1']['items'] ?? []))),
        'result_error'=> ($bt['result']['result_error'] ?? $bt['result_error'] ?? null),
    ];

    return [
        'note'  => 'Диагноз потери 16 модулей: сырые страницы crm.item.list (1050, parentId1038=12) + batch',
        'page1' => ['total' => $p1['total'], 'next' => $p1['next'], 'n' => $p1['n'], 'firstId' => $p1['firstId'], 'lastId' => $p1['lastId']],
        'page2' => ['start' => (int)($p1['next'] ?? 50), 'total' => $p2['total'], 'next' => $p2['next'], 'n' => $p2['n'], 'firstId' => $p2['firstId'], 'lastId' => $p2['lastId'], 'ids' => $p2['ids']],
        'batch' => $batch,
    ];
};

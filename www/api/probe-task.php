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
    // Диагноз: почему график пустой. Гипотеза — фильтр PARENT_ID_1038 неверен,
    // правильно parentId1038 (parentId + entityTypeId родителя).
    // 1) поля 1050/1042: имена полей привязки (parent*) + ошибки, если fields упал
    // 2) реальные сделки 1038 (по какой dealId пробовать)
    // 3) list 1050 без фильтра (2 шт., поля id/title/parent*) — реальные значения привязки
    // 4) list 1050 с фильтром parentId1038=1 и со старым PARENT_ID_1038=1 — сравнение
    $fields1050 = $call('crm.item.fields', ['entityTypeId' => 1050]);
    $fields1042 = $call('crm.item.fields', ['entityTypeId' => 1042]);

    $errorsOf = function (array $res): ?string {
        if (empty($res['error'])) return null;
        return ($res['error'] ?? '') . ': ' . ($res['error_description'] ?? '');
    };
    // только имена полей (компактно) + отдельным списком всё, что похоже на привязку
    $namesOf = function (array $res) use ($errorsOf): array {
        if ($e = $errorsOf($res)) return ['ERROR' => $e];
        $names = array_keys((array)($res['fields'] ?? []));
        $parent = array_values(array_filter($names, static fn($n) => stripos($n, 'parent') !== false
            || stripos($n, 'PARENT') !== false));
        return ['count' => count($names), 'parentFields' => $parent];
    };

    $deals = $call('crm.item.list', [
        'entityTypeId' => 1038,
        'select'       => ['id', 'title'],
        'limit'        => 3,
        'order'        => ['id' => 'DESC'],
    ]);

    $parentIdSelect = ['id', 'title', 'parentId1038', 'parentId1042', 'PARENT_ID_1038', 'PARENT_ID_1042'];
    $listNoFilter = $call('crm.item.list', [
        'entityTypeId' => 1050,
        'select'       => $parentIdSelect,
        'limit'        => 2,
        'order'        => ['id' => 'DESC'],
    ]);
    $listByParentNew = $call('crm.item.list', [
        'entityTypeId' => 1050,
        'filter'       => ['parentId1038' => 1],
        'select'       => $parentIdSelect,
        'limit'        => 2,
    ]);
    $listByParentOld = $call('crm.item.list', [
        'entityTypeId' => 1050,
        'filter'       => ['PARENT_ID_1038' => 1],
        'select'       => $parentIdSelect,
        'limit'        => 2,
    ]);

    return [
        'note'            => 'Диагноз привязки смарт-процессов 1042/1050 к сделкам 1038.',
        'fields_1050'     => $namesOf($fields1050),
        'fields_1042'     => $namesOf($fields1042),
        'deals_1038'      => $deals,
        'list_1050_nofilter'  => $listNoFilter,
        'list_1050_parentId1038'  => $listByParentNew,
        'list_1050_PARENT_ID_1038' => $listByParentOld,
    ];
};

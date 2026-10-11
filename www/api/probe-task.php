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
    // Пробный dealId (PARENT_ID_1038): если известно реальное id сделки из
    // placement-контекста — подставь его, иначе оставь 1.
    $dealId = 1;

    $fields1050 = $call('crm.item.fields', ['entityTypeId' => 1050]);
    $fields1042 = $call('crm.item.fields', ['entityTypeId' => 1042]);
    $list1050 = $call('crm.item.list', [
        'entityTypeId' => 1050,
        'filter'       => ['PARENT_ID_1038' => $dealId],
        'select'       => ['id', 'title', 'PARENT_ID_1038'],
        'limit'        => 2,
    ]);

    // Оставляем только имена полей + типы, чтобы вывод был компактным.
    $compactFields = function (array $res): array {
        $out = [];
        foreach (($res['fields'] ?? []) as $name => $f) {
            $out[$name] = [
                'type'     => $f['type'] ?? null,
                'title'    => $f['title'] ?? ($f['formLabel'] ?? null),
                'isMultiple' => $f['isMultiple'] ?? null,
                'items'    => $f['items'] ?? null,
            ];
        }
        return $out;
    };

    return [
        'note'                 => 'Структура смарт-процессов 1038/1042/1050 + примеры записей 1050.',
        'dealId_probe'         => $dealId,
        'fields_entityType_1050' => $compactFields($fields1050),
        'fields_entityType_1042' => $compactFields($fields1042),
        'list_1050_by_parent'  => $list1050,
    ];
};

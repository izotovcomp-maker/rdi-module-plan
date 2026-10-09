---
description: Структура проекта, базовые грабли, краткое описания места размещения и порядка деплоя
---
# `tmpl-b24-php-kilo` — шаблон single-tenant B24 local-app на PHP

Канонический скелет для нового приложения **«один деплой = один портал»**.
PHP-бэкенд, vanilla JS-фронт, файловый store без БД, защита `<?php exit;?>` без `.htaccess`.

Подходит для in-house инструментов, заказных интеграций, одиночных установок.
Для маркета / N-портального деплоя — **смена шаблона** (multi-tenant-вариант
этого шаблона пока не существует), а не доработка этого.

## Что внутри

```
tmpl-b24-php-kilo/
├── README.md                 ← этот файл
├── AGENTS.md                 ← единый источник правил для агентов: стек, деплой, канон инфраструктуры
├── CLAUDE.md                 ← одна строка `@AGENTS.md` (Claude Code импортирует AGENTS.md)
├── kilo.jsonc                ← конфиг Kilo (MCP)
├── .claude/skills/           ← скиллы (Kilo читает эту папку тоже)
├── .claude/commands          ← симлинк на .kilo/commands
├── deploy.sh                 ← rsync www/ на сервер (локально или по SSH, профиль prod/lab/customer)
├── mydeploy.env.example      ← образец /projects/mydeploy.env — данные ВАШИХ серверов в одном месте
├── deploy.customer.env.example ← образец данных сервера заказчика (реальный файл в git не попадает)
├── .kilo/commands/           ← слэш-команды журнала (единственная копия)
│   ├── log.md                ← /log — записать шаг в state.md/changelog.md + snapshot.sh
│   ├── decision.md           ← /decision — зафиксировать решение в decisions.md
│   └── handoff.md            ← /handoff — собрать снимок передачи в docs/handoff.md
├── mock/                     ← макет на вымышленных данных: статика, открывается двойным кликом; заготовка переписывается под проект. Вне www/ — в прод не уходит
├── docs/                     ← журнал проекта, см. docs/handoff.md — точка входа; карта — docs/INDEX.md
│   ├── INDEX.md              ← карта docs/: какой файл о чём и когда открывать
│   ├── agent/                ← правила агента по триггерам: dev-rules.md, b24-search.md, deploy.md, mockup.md
│   ├── handoff.md            ← с чего начать новому исполнителю
│   ├── project-brief.md      ← что за проект и зачем
│   ├── state.md               ← где мы сейчас + следующие шаги (живой снимок)
│   ├── changelog.md           ← что уже сделано, по датам
│   ├── decisions.md            ← почему так, а не иначе (D-NNN)
│   ├── onboarding.md            ← протокол первого запуска: вопросы → саммари и план → макет → привязка
│   ├── deploy-targets.md         ← профили деплоя prod / lab / customer, вопросы заказчику
│   ├── how-to-link.md            ← привязка приложения к порталу Б24 (заготовка, агент подставляет значения)
│   ├── how-to-link-ALL.md        ← то же вручную, для хостинга без SSH
│   └── install-flow-diagram.md   ← диаграмма POST'ов install-flow
│   (граблей, правил и документации Б24 в проекте нет: общие папки `/projects/docs/rules-b24/`
│    — см. `INDEX.md` — и `/projects/docs/b24-rest-docs/` — клон официальной документации)
├── scripts/
│   ├── snapshot.sh           ← коммит-снимок для журнала
│   └── pack-mock.sh          ← собрать макет в mock-<версия>.zip для заказчика
└── www/                      ← всё, что деплоится на хостинг
    ├── env.example           ← шаблон env.php; deploy.sh генерирует из него env.php сам
    ├── init.php               ← bootstrap для 1%-кейса (чужой хостинг, путь/домен неизвестны заранее)
    ├── index.php               ← главный handler (install POST + runtime)
    ├── template.html           ← UI (рендерится через index.php, не веб-сервером напрямую)
    ├── api/
    │   ├── store.php         ← <?php exit;?> защита, storeRead/storeWrite
    │   ├── b24.php            ← B24 class — OAuth, refresh, REST call/batch
    │   ├── session.php         ← admin-only gate через user.admin
    │   ├── install.php         ← alternative install handler (если /index.php занят чем-то)
    │   ├── lib.php              ← settings helpers + httpJson обёртка над cURL
    │   ├── bind.php             ← placement.bind утилита, идемпотентная
    │   ├── probe.php            ← обвязка дебаг-кнопки (админ-only, только чтение, секреты скрыты) — не править
    │   ├── probe-task.php       ← запрос, который ЛЛМ пишет для дебаг-кнопки; ответ видит админ
    │   └── debug.php            ← ручной REST-тестировщик методов Б24 для человека (удалить когда не нужен)
    ├── bin/
    │   └── process.php       ← CLI cron-воркер (заглушка)
    ├── css/style.css         ← стиль «тёплая бумага» (токены в :root), общий для приложения и макета
    └── js/app.js             ← точка входа фронта, BX24 init
```

## Дебаг-кнопка: как ассистент получает данные портала

Ассистент (ЛЛМ) не может сам зайти в приложение на портале и не справляется с `debug.php`. Поэтому в шапке
приложения у администраторов есть кнопка **«Дебаг»**:

1. ЛЛМ пишет нужный запрос (поля сущности, пример записи, ответ метода) в `www/api/probe-task.php` и деплоит.
2. Админ открывает приложение из портала, нажимает «Дебаг» — в окне появляется текст (например, JSON).
3. Админ нажимает «Копировать» и вставляет текст в чат с ЛЛМ.
4. ЛЛМ читает реальные данные и продолжает работу.

Безопасность: кнопка и эндпоинт — только для администраторов портала; запросы только на чтение; токены и секреты
из вывода вырезаются. Правила для агента — `docs/agent/dev-rules.md`, «Дебаг-кнопка». Кнопка есть и в макете (`mock/`).

## Что закрывает «из коробки»

Каждый из этих пунктов взят из живых грабель, см. ссылки на заметки:

| Фаза | Где зашито в коде |
|------|-------------------|
| Save-tokens-gate (`INSTALL=Y` / `ONAPPINSTALL` / `!hasTokens` / expired) | [`index.php`](www/index.php), `api/install.php`. KB: [tokens-save-only-on-install](/projects/docs/rules-b24/b24-local-app-tokens-save-only-on-install.md) |
| DOMAIN resolve chain (POST.DOMAIN → existing → REFERER not-self) | `B24::saveTokensFromInstall` в [`api/b24.php`](www/api/b24.php). KB: [marketplace-install-post-no-domain](/projects/docs/rules-b24/b24-marketplace-install-post-no-domain.md) |
| `installFinish` маркер | `installFinishedAt` / `installFinishedUsers` в `tokens.json`, рендер `renderInstallFinishPage()` |
| Двухфазная установка | reload через 700ms в `renderInstallFinishPage()`. KB: [two-phase-install](/projects/docs/rules-b24/b24-local-app-two-phase-install.md) |
| Защита state через `<?php exit;?>` (без `.htaccess`) | [`api/store.php`](www/api/store.php) |
| Cache-bust `?v=<mtime>` для css/js | `preg_replace_callback` в [`index.php`](www/index.php) |
| Admin-gate через `user.admin` | [`api/session.php`](www/api/session.php) |
| Idempotent `placement.bind` | unbind перед bind в [`api/bind.php`](www/api/bind.php) |
| CRON anti-overlap (flock) | [`bin/process.php`](www/bin/process.php) |
| iframe X-Frame-Options / CSP (опционально) | закомментированный snippet в `index.php` — раскомментировать на коробке клиента |

Полный install-чек-лист и каноны жёстких вопросов: [/projects/docs/rules-b24/rule-b24-install-checklist.md](/projects/docs/rules-b24/rule-b24-install-checklist.md).

## Как создать новый проект

Деплой, хостинг и первый запуск (`deploy.sh` → env.php создаётся сам →
регистрация в Б24) описаны **в одном месте** — [AGENTS.md → ИНФРАСТРУКТУРА СЕРВЕРА](AGENTS.md#инфраструктура-сервера).
Пошаговая привязка `client_id`/`client_secret` — в [docs/how-to-link.md](docs/how-to-link.md).
Здесь эти шаги не дублируются, чтобы не разъезжались при изменении флоу — правь только там.

Это сценарий с автоматическим деплоем: свой сервер (`prod`, по умолчанию) или сервер
заказчика по SSH (`customer`) — см. [docs/deploy-targets.md](docs/deploy-targets.md).
Если у заказчика нет SSH (shared-хостинг, FTP-заливка) — ручной кейс: см.
[docs/how-to-link-ALL.md](docs/how-to-link-ALL.md), там процедура через `www/init.php`.

Коротко:

1. Скопировать этот шаблон в новую папку проекта (имя папки = будущий slug).
2. Пройти онбординг: если нет `.onboarding-done` — агент задаст вопросы по протоколу из docs/onboarding.md.
3. Агент пишет в чат саммари («что прочитал и как понял») и план реализации — вы согласуете.
4. Агент предлагает макет в `mock/` на вымышленных данных — вы согласуете состав данных и экранов. Заказчику макет уходит архивом: `bash scripts/pack-mock.sh` → `mock-v1.zip`, открывается двойным кликом.
5. Бэк и фронт по согласованному плану.
6. Деплой и привязка к порталу (профили — [docs/deploy-targets.md](docs/deploy-targets.md), шаги — [docs/how-to-link.md](docs/how-to-link.md)) — только после макета, когда известны сущности и права.

## Что заменить под конкретный проект

Перед тем как делать бизнес-логику:

0. **`mock/`** — сначала макет, потом его вёрстка переезжает в `template.html`
1. **`template.html`** — header'ы, title, UI-блоки
2. **`api/bind.php`** — массив `$placements` (раскомментировать нужные)
3. **`bin/process.php` → `runJob()`** — тело cron-задачи (если нужна)
4. **Новые endpoint'ы в `api/`** — свои `<endpoint>.php` под бизнес-операции
5. **`AGENTS.md`** — онбординг меняет только первую строку (заголовок); данные проекта идут в `docs/project-brief.md`

## Что НЕ менять без причины

- **`api/store.php`** — защита через `<?php exit;?>` критична. Не выносить state в обычный `.json`
- **`api/b24.php` `saveTokensFromInstall`** — там цепочка резолва DOMAIN и not-self фильтр. Любая правка может сломать установку на cloud / коробке
- **`api/session.php`** — admin-gate через `user.admin` REST. Не ослаблять до простого «есть ли AUTH_ID»
- **Save-policy токенов в `index.php`** — `$isFirst || $isFormal || expired`. Не сохранять на каждом POST'е, иначе admin-токен затрётся (см. заметку)

## Хостинг

Данных серверов в шаблоне нет. Они в профилях деплоя: свои серверы — в одном файле
`/projects/mydeploy.env` (профили `prod`, `lab`), сервер заказчика — в
`deploy.customer.env` проекта. Переезд своего сервера — правка `PROD_*` в одном
файле. Механизм, вопросы заказчику и команды для создания пользователя деплоя —
[docs/deploy-targets.md](docs/deploy-targets.md). Рабочая конфигурация серверов —
Caddy + PHP-FPM; другой веб-сервер у заказчика — маршрут настраивается вручную.

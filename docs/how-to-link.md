---
description: Как привязать приложение rdi-module-plan к порталу Б24 — деплой, Caddy, регистрация, установка
---
# Как привязать приложение к порталу Битрикс24

> Профиль деплоя: `prod`. Сервер заказчика без SSH (FTP, shared-хостинг) —
> [how-to-link-ALL.md](how-to-link-ALL.md).

**Проект:** `rdi-module-plan` · **Профиль деплоя:** `prod` · **URL:** `https://rub24.blackboxbegin.space/rdi-module-plan/`

## Что такое client_id и client_secret

Битрикс24 использует OAuth-авторизацию. Когда пользователь открывает приложение, Б24 выдаёт временный код, который приложение обменивает на `access_token` для REST-запросов. Для этого обмена нужны:

| Параметр | Назначение |
|---|---|
| `client_id` | Идентификатор приложения — говорит Б24, *какое* приложение делает запрос |
| `client_secret` | Секретный ключ — доказывает, что запрос делает *настоящий* владелец приложения |

Хранятся в `/var/www/b24/rdi-module-plan/env.php` на сервере. **Никогда не коммитить в git.**

---

## Порядок действий

### 1. Проверить и задеплоить

```bash
bash deploy.sh --dry-run     # что изменится — ничего не меняет
bash deploy.sh               # профиль из .deploy-target (prod)
```

Доступ к серверу: ssh iagdeploy@rub24.blackboxbegin.space.
При первом деплое скрипт сам создаёт `/var/www/b24/rdi-module-plan/env.php` из `env.example` с
верными `APP_URL` (`https://rub24.blackboxbegin.space/rdi-module-plan`), `APP_PATH` и `DATA_ROOT` — править их руками не нужно.

### 2. Блок веб-сервера (вручную, один раз на проект)

`deploy.sh` в конце сообщит, есть ли блок для `/rdi-module-plan`. Если нет — вставь в блок
домена конфига веб-сервера на сервере и перезагрузи:

```
handle /rdi-module-plan* {
    uri strip_prefix /rdi-module-plan
    root * /var/www/b24/rdi-module-plan
    php_fastcgi unix//run/php/php8.3-fpm.sock
    file_server
}
```

### 3. Зарегистрировать приложение в Б24

В портале Битрикс24: **Приложения → Разработчикам → вкладка «Готовые сценарии» → Другое → Локальное приложение**
(прямого deep-link'а на эту форму с портала Б24 не даёт — открывать вручную
через левое меню; официальная инструкция с картинками:
[Разработчикам: как создать вебхуки и приложения для Битрикс24](https://helpdesk.bitrix24.ru/open/20886106/#2))

- Тип: **Серверное**
- **Путь обработчика:** `https://rub24.blackboxbegin.space/rdi-module-plan/index.php`
- **Путь установки:** тот же URL (с `/index.php` на конце — обязательно)
- **«Настройка прав»** — отметь: `crm, user, placement, department` (список называет агент по `docs/project-brief.md`; `department` — доступ по отделам (режим по умолчанию), см. [rule-b24-department-based-access](/projects/docs/rules-b24/rule-b24-department-based-access.md))

После сохранения Б24 покажет `client_id` и `client_secret`.

### 4. Вписать credentials в env.php на сервере

В `/var/www/b24/rdi-module-plan/env.php` (на сервере, не в проекте):

```php
define('B24_CLIENT_ID', 'app.xxxxxxxxx.xxxxxxxx');       // из карточки Б24
define('B24_CLIENT_SECRET', 'xxxxxxxxxxxxxxxxxxxxxxxx');  // из карточки Б24
```

### 5. Установить приложение

Открыть приложение из меню Б24. Двухфазный install-flow отработает сам, OAuth-токены
сохранятся в `data/b24-tokens.php`.

---

## Несколько порталов

Этот шаблон — **single-tenant**: один экземпляр = один портал. Для каждого
дополнительного портала — отдельный проект (отдельный slug, свой `env.php`
с credentials портала). Повторить шаги 1–5.

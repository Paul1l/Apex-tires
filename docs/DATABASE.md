# PostgreSQL APEX WHEELS

## Что используется

Production read model и первичное хранилище backend — PostgreSQL. Схема
создается воспроизводимой миграцией:

`server/database/migrations/001_initial_postgresql.sql` и
`002_local_business_readiness.sql`, `003_catalog_auth_and_cart.sql`,
`004_large_catalog.sql`, `005_order_status_history.sql`, `006_inventory_reservations.sql`,
`007_rate_limits.sql`, `008_import_job_progress.sql`, `009_order_request_hash.sql`.

Production-база пока не развернута и строка подключения не хранится в
репозитории. Для магазина с персональными данными PostgreSQL и backend должны
физически находиться в российском дата-центре.

## Применение миграций

1. Создать базу и две роли (см. «Роли и права»): владельца схемы и роль
   приложения.
2. Выполнить `pnpm db:migrate` с `DATABASE_URL` **владельца** (на VDS:
   `docker compose ... run --rm migrate`).
3. Запустить приложение с `DATABASE_URL` **роли приложения** и
   `DATABASE_SSL_MODE=require` (кроме внутренней сети Docker). Строки
   подключения хранятся в secret manager или `.env.production`, не в Git.

Runner берет advisory lock, выполняет каждый новый SQL-файл в транзакции и
записывает его имя в `schema_migrations`. Повторный запуск безопасен.

Миграция 007 только добавляет таблицу `rate_limit_buckets` и два индекса
`orders` (телефон; `LOWER(customer_email)`), ничего не удаляет и не меняет
существующие данные. Индексы строятся обычным `CREATE INDEX` внутри транзакции
миграции: на время построения запись в `orders` ждёт, на текущих объёмах это
доли секунды.

Миграция 008 только добавляет колонку `import_jobs.last_progress_at` — время
последнего признака работы импорта (`docs/PRODUCT_IMPORT.md`). Миграция 009
только добавляет колонку `orders.checkout_request_hash` — SHA-256
нормализованного запроса заказа. В нём учитываются состав (строки одного товара
суммируются, порядок не важен), имя, телефон, email без учёта регистра, способ
и адрес получения, шиномонтаж и комментарий. Повтор `idempotencyKey` с тем же
запросом возвращает существующий заказ. Повтор с другим запросом получает
`409 IDEMPOTENCY_KEY_REUSED`, номер существующего заказа при этом не
раскрывается. У заказов до 009 хеш `NULL`, они обрабатываются как раньше.

## Роли и права

В production две роли:

| Роль | Кто использует | Права |
| --- | --- | --- |
| владелец схемы (`POSTGRES_USER`; образ `postgres` создаёт его суперпользователем) | миграции, резервные копии | владеет всеми объектами |
| роль приложения (`POSTGRES_APP_USER`, по умолчанию `apex_app`) | работающее приложение, CLI-импорт | `SELECT`, `INSERT`, `UPDATE`, `DELETE` на таблицы; `USAGE`, `SELECT` на последовательности; `EXECUTE` на функции |

**Что запрещено роли приложения.**
- Атрибуты: `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`.
- Создание объектов: `CREATE` на схему `public` и на базу, временные таблицы
  (`TEMPORARY` отозван и у `PUBLIC`).
- Изменение данных в обход приложения: `TRUNCATE`, `setval`.
- Журнал миграций `schema_migrations` недоступен.
- Роль не владеет ни одним объектом, поэтому `ALTER` и `DROP` невозможны.
- Нет роли `pg_read_server_files`, поэтому `COPY ... PROGRAM` и чтение файлов
  сервера недоступны.

**Права на объекты будущих миграций.** Для владельца заданы права по умолчанию
(`ALTER DEFAULT PRIVILEGES FOR ROLE <владелец> IN SCHEMA public`), и таблицы,
последовательности и функции новых миграций сразу доступны приложению. Условие
одно: миграции выполняет именно владелец. Если объект создан другой ролью,
скрипт роли нужно запустить повторно.

**Скрипт роли.** Роль создаёт `deploy/postgres/init/10-app-role.sql` (psql,
имя и пароль — из `POSTGRES_APP_USER` и `POSTGRES_APP_PASSWORD` через
`\getenv`).
- Скрипт идемпотентен: создаёт роль один раз, при каждом запуске задаёт пароль
  и атрибуты, выдаёт права и отзывает лишние.
- Запускать его нужно от владельца в базе приложения.
- На VDS он выполняется автоматически при первом старте пустого тома. На
  существующей базе — командой из `docs/VDS_DEPLOYMENT.md` («Переход на
  отдельную роль»).
- Вне Docker — так:

  ```bash
  POSTGRES_APP_USER=apex_app POSTGRES_APP_PASSWORD=... \
    psql -v ON_ERROR_STOP=1 --no-psqlrc "<URL владельца>" -f deploy/postgres/init/10-app-role.sql
  ```

  Нужен psql 15 или новее (`\getenv`).

**Проверка.** Под ролью приложения проверены: заказ (резерв, триггеры статуса),
корзина, импорт CSV из CLI и админки, обмен с 1С, фоновые задания. Под ней же
отказано: `CREATE TABLE`/`TEMP`/`INDEX`/`SCHEMA`/`FUNCTION`/`EXTENSION`,
`ALTER` и `DROP`, `TRUNCATE`, `setval`, доступ к `schema_migrations`,
`COPY ... PROGRAM`, `pg_read_file`, `SET ROLE` владельца. Миграция под ролью
приложения тоже не выполняется. Тест на PostgreSQL в
`server/tests/import-job-recovery.test.ts` запускается при `TEST_DATABASE_URL`
и проходит под ролью приложения.

Для локальной разработки достаточно одного пользователя-владельца. Разделение
ролей обязательно для staging и production.

## Основные таблицы

| Таблица | Назначение |
| --- | --- |
| `store_settings` | изменяемые бизнес-настройки и начальная емкость |
| `users`, `sessions`, `otp_challenges` | аккаунты, серверные сессии и OTP |
| `consents` | версии согласий пользователя |
| `products` | карточки, source system и внешний ID |
| `product_images` | URL/object-storage ключи фотографий |
| `product_fitments` | совместимость со старым протоколом 1С; не источник нового подбора |
| `brands`, `categories`, `product_external_ids` | справочники и внешние идентификаторы |
| `tire_specs`, `wheel_specs` | типизированные размеры и характеристики |
| `car_makes`, `car_models`, `car_generations`, `car_modifications`, `fitments` | нормализованный автомобильный справочник и проверенные размеры |
| `import_jobs`, `import_job_errors`, `import_job_product_keys` | прогресс, построчные ошибки и полный CSV-снимок |
| `order_status_history`, `inventory_reservations` | история статусов и резервы с TTL |
| `warehouses`, `inventories` | склады и остатки |
| `prices` | цены по типам, в копейках |
| `orders`, `order_items` | заказ и неизменяемые снимки строк |
| `integration_queue` | надежная очередь передачи заказов |
| `integration_sync_logs` | итоги и идемпотентность обменов |
| `integration_sync_errors` | безопасные ошибки отдельных записей |
| `admin_audit_log` | аудит административных действий |
| `used_product_lots`, `used_product_lot_images` | конкретные б/у комплекты и их реальные фотографии |
| `vehicle_fitment_requests` | запросы покупателей по отсутствующим автомобилям |
| `notification_outbox` | надежная очередь email/Telegram без отправки из HTTP-транзакции |
| `rate_limit_buckets` | счётчики защитных лимитов (ключ — HMAC, фиксированные окна), чистятся заданием резервов |
| `shopping_carts`, `shopping_cart_items` | пользовательские и анонимные серверные корзины |
| `user_identities`, `addresses`, `favorites`, `comparison_items` | подготовленные таблицы; не все имеют пользовательский API |

## Идентификаторы и деньги

- внутренние ID — UUID;
- `source_system` + `external_id` связывают запись с 1С или другой ERP;
- SKU уникален, но не заменяет внешний GUID;
- деньги хранятся целым `BIGINT` в копейках;
- даты хранятся в `TIMESTAMPTZ`;
- товары не удаляются при пропаже из 1С, а деактивируются.

## Масштаб и индексы

PostgreSQL не требует пустых строк-заготовок. Каталог получает страницы
24/48/96 товаров, фильтрация и сортировка выполняются SQL. Целевая архитектура
допускает 300 000 SKU; фактический локальный тест — 50 000.
CSV принимает до 300 000 строк / 200 МБ, transaction по 100–2000 строк.

Расширения: pgcrypto для UUID/хешей и pg_trgm для поиска. Миграции создают
GIN-индексы LOWER(name), LOWER(model), LOWER(brand), B-tree LOWER(sku),
LOWER(article), уникальные source/external и slug. Частичные индексы покрывают
активные товары, retail-цену и доступные остатки; составные tire_specs и
wheel_specs — размеры. Fitments индексируются по поколению и проверенности,
а также по параметрам шины/диска. Индексы не заменяют EXPLAIN на реальной базе.

Основные таблицы сохраняют предыдущие имена (`inventories`, `shopping_carts`),
чтобы не переименовывать рабочие зависимости ради косметики.

## Эксплуатация

Перед запуском нужны отдельные development/staging/production базы, роль
приложения с минимальными правами (см. «Роли и права»), сетевые ограничения,
мониторинг соединений, автоматические backup и проверенная процедура
восстановления.

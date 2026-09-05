# PostgreSQL APEX WHEELS

## Что используется

Production read model и первичное хранилище backend — PostgreSQL. Схема
создается воспроизводимой миграцией:

`server/database/migrations/001_initial_postgresql.sql` и
`002_local_business_readiness.sql`, `003_catalog_auth_and_cart.sql`,
`004_large_catalog.sql`, `005_order_status_history.sql`, `006_inventory_reservations.sql`.

Production-база пока не развернута и строка подключения не хранится в
репозитории. Для магазина с персональными данными PostgreSQL и backend должны
физически находиться в российском дата-центре.

## Применение миграций

1. Создать отдельного пользователя и базу PostgreSQL.
2. Задать `DATABASE_URL` и `DATABASE_SSL_MODE=require` через secret manager.
3. Выполнить `pnpm db:migrate`.

Runner берет advisory lock, выполняет каждый новый SQL-файл в транзакции и
записывает его имя в `schema_migrations`. Повторный запуск безопасен.

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

Перед запуском нужны отдельные development/staging/production базы,
минимальные права пользователя приложения, сетевые ограничения, мониторинг
соединений, автоматические backup и проверенная процедура восстановления.

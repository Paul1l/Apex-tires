# Интеграция APEX WHEELS с 1С по REST/HTTP

## 1. Текущий статус

Интеграционный backend и PostgreSQL-схема подготовлены, но конкретная база 1С
**не подключена**. В коде нет фиктивного соединения или тестовых учетных данных.
Подключение выполняется после получения версии платформы, конфигурации,
структуры справочников, складов, цен и заказов.

Основной протокол — HTTPS + JSON. CommerceML может быть добавлен позже как
отдельный legacy-адаптер, не меняя бизнес-логику магазина.

## 2. Архитектура

```text
1С --HTTPS/JSON--> Next.js API --> Integration Service --> PostgreSQL
1С <--HTTPS/JSON-- OneCHttpProvider <-- Integration Queue <-- заказы сайта

Browser --> Next.js Route Handler --> Service --> Repository --> PostgreSQL
```

Каталог всегда читается из PostgreSQL. Запрос покупателя не зависит от
доступности 1С. Заказ сначала транзакционно сохраняется в `orders` и
`order_items`, а затем помещается в `integration_queue`.

Слои backend:

```text
Route Handler -> Service -> Repository -> PostgreSQL
                       |
                       +-> OneCProvider -> OneCHttpProvider -> 1С
```

`ERPIntegrationProvider` задает общий контракт внешней учетной системы.
`OneCProvider` расширяет его для 1С, а `OneCHttpProvider` отвечает только за
HTTP, авторизацию, timeout и безопасные повторы. Route Handlers и сервис заказов
не знают URL или формат авторизации конкретной 1С.

## 3. Контракт OneCProvider

```js
getProducts({ changedSince })
getPrices({ changedSince })
getStocks({ changedSince })
sendOrder(order, { idempotencyKey })
getOrderStatus(externalOrderId)
healthCheck()
```

Пути HTTP-сервиса 1С и преобразование ее внутреннего JSON уточняются при
подключении. Если формат 1С отличается от контракта сайта, преобразование
добавляется в адаптер, а не в `orderService` или React.

## 4. REST endpoints backend

Базовый путь входящего API: `/api/integrations/1c/v1`.

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/health` | здоровье PostgreSQL и соединения с 1С |
| `POST` | `/products/batch` | полный или инкрементальный импорт товаров |
| `POST` | `/prices/batch` | отдельное обновление цен |
| `POST` | `/stocks/batch` | отдельное обновление остатков |
| `POST` | `/fitments/batch` | применяемость по автомобилям |
| `GET` | `/orders?limit=100` | получение ожидающих заказов для pull-модели |
| `POST` | `/order-statuses/batch` | статусы заказов и оплаты из 1С |

Админка получает безопасный агрегированный статус через серверный Route
Handler. Кнопки повтора и запуска обмена будут открыты только после подключения
реальной серверной роли администратора; фиктивный ключ или demo-доступ не
используется.

Публичное оформление заказа выполняется через `POST /api/v1/orders`. Цена,
активность товара и остаток повторно проверяются backend; значения frontend не
используются как источник истины.

## 5. Authentication и транспорт

Все методы `/api/integrations/1c/v1/**`, включая health check, требуют:

```http
X-Integration-Key: <INTEGRATION_API_KEY>
```

В production разрешен только HTTPS. Ключи должны иметь не менее 32 случайных
символов, храниться в secret manager и ротироваться. Их нельзя передавать в
React, URL, Git или обычные логи. Дополнительно рекомендуется IP allowlist,
VPN либо mTLS, если инфраструктура 1С это позволяет.

Route Handler ограничивает частоту запросов в пределах одного процесса. На
production-инфраструктуре дополнительно обязателен распределенный rate limit
на reverse proxy/WAF, поскольку приложение может работать в нескольких
экземплярах.

Для исходящих запросов в 1С адаптер поддерживает API key либо Basic Auth поверх
HTTPS. Конкретный вариант выбирается после аудита публикации 1С.

## 6. Общий формат batch

```json
{
  "apiVersion": "1.0",
  "idempotencyKey": "products-2026-09-04T10:00:00Z-part-1",
  "mode": "incremental",
  "changedSince": "2026-09-04T09:00:00+07:00",
  "cursor": "optional-1c-version-or-cursor",
  "items": []
}
```

- `idempotencyKey` уникален для логической операции;
- `mode`: `full` или `incremental`;
- `changedSince` сообщает границу инкрементальной выборки;
- `cursor` хранит версию/курсор 1С для аудита;
- `items` содержит до 5 000 записей, общий размер HTTP-тела — до 10 МБ.

Некорректная запись не останавливает остальные записи пакета. HTTP `207`
означает частичный результат.

## 7. Товары и external IDs

Внутренний `products.id` — UUID сайта. `externalId` — стабильный GUID/ID объекта
1С. Уникальная связь строится по паре `source_system = "1c"` + `external_id`.
Название товара никогда не используется как ключ.

Минимальная схема элемента товара:

```json
{
  "externalId": "b9602d2f-13a6-4edc-a9a4-c923cc184c75",
  "sku": "TYRE-001",
  "name": "Шина Ikon Autograph Aqua 3",
  "brand": "Ikon",
  "model": "Autograph Aqua 3",
  "category": "Легковые шины",
  "description": "Летняя шина",
  "kind": "tire",
  "condition": "new",
  "width": 205,
  "profile": 55,
  "diameter": 16,
  "season": "summer",
  "studded": false,
  "runflat": false,
  "xl": false,
  "specifications": { "loadIndex": "91", "speedIndex": "V" },
  "images": [
    {
      "externalId": "image-guid",
      "url": "https://storage.example.ru/products/tyre-001.webp",
      "alt": "Ikon Autograph Aqua 3",
      "position": 0
    }
  ],
  "isActive": true,
  "sourceUpdatedAt": "2026-09-04T09:58:00+07:00"
}
```

Для диска дополнительно используются `pcd`, `offset`, `centerBore`, `color` и
`wheelType` (`alloy`, `steel`, `other`). Значение `condition=used` допускается
только после подтверждения торговли б/у товарами. Конкретные б/у комплекты и их
индивидуальные фотографии хранятся отдельно от общей модели товара.
Изображения не хранятся в base64 или в таблице `products`: 1С передает готовый
URL либо сначала загружает файл в российское object storage, а затем передает
URL и ключ изображения.

### Full sync

`mode = "full"` используется для полного контрольного снимка. Товары 1С,
которые отсутствуют в успешно проверенном полном пакете, получают
`is_active = false` и `sync_status = "inactive"`. Физическое удаление не
выполняется, поэтому сохраняются история заказов, URL и внешние ключи.

Деактивация выполняется только если весь полный пакет прошел без ошибок. Для
каталога более 5 000 позиций протокол полного снимка нужно расширить сессией из
нескольких частей до реального запуска.

### Incremental sync

`mode = "incremental"` обновляет только переданные позиции. 1С выбирает
объекты, измененные после согласованной даты/версии, а backend сохраняет
`source_updated_at` и курсор запуска.

## 8. Цены

Цена синхронизируется отдельно от карточки товара:

```json
{
  "externalId": "product-guid",
  "priceType": "retail",
  "price": 15990.00,
  "oldPrice": 17490.00,
  "discount": 8.58,
  "currency": "RUB",
  "sourceUpdatedAt": "2026-09-04T10:01:00+07:00"
}
```

В API цена выражена в рублях максимум с двумя знаками, а PostgreSQL хранит ее
целым `BIGINT` в копейках. Отрицательные цены отклоняются.
`oldPrice` и `discount` необязательны: без подтвержденной старой цены скидка на
витрине не отображается.

## 9. Остатки

```json
{
  "externalId": "product-guid",
  "warehouseExternalId": "warehouse-guid",
  "warehouseCode": "EXAMPLE-WAREHOUSE",
  "warehouseName": "ПРИМЕР — заменить фактическим складом",
  "quantity": 8,
  "reserved": 2,
  "sourceUpdatedAt": "2026-09-04T10:02:00+07:00"
}
```

`quantity` и `reserved` — неотрицательные целые числа, `reserved` не превышает
`quantity`. Остаток неизвестного товара не создается: сначала должна пройти
синхронизация номенклатуры.

### Качество применяемости

Каждая строка `/fitments/batch` содержит `source` (`manual`, `import` или
`external_api`), `verified`, `verifiedAt` и `notes`. Непроверенные строки
сохраняются, но не участвуют в автоматической выдаче совместимых товаров.
OpenAI и другие LLM не могут устанавливать `verified=true`.

## 10. Заказы и очередь

Последовательность создания заказа:

1. backend валидирует покупателя и российский телефон;
2. блокирует выбранные товары в транзакции;
3. повторно проверяет активность, цену и доступный остаток;
4. рассчитывает итог на сервере;
5. записывает заказ и строки заказа;
6. в той же транзакции создает элемент `integration_queue`;
7. возвращает покупателю номер заказа;
8. отдельный worker передает очередь в 1С.

Если 1С недоступна, заказ остается в PostgreSQL со статусом интеграции
`pending`/`failed`. Используются поля `retry_count`, `last_error`,
`last_attempt_at`, `synced_at`. Статусы: `pending`, `processing`, `synced`,
`failed`.

Передаваемый заказ содержит `siteOrderId`, номер, дату, покупателя, телефон,
email, SKU, количество, зафиксированную цену, скидку, итог, способ получения,
адрес, комментарий, статус заказа и оплаты.

## 11. Idempotency

Повтор batch с тем же `idempotencyKey` возвращает сохраненный результат и не
создает повторные записи. Для заказа используется ключ `order:<siteOrderId>`.
`OneCHttpProvider.sendOrder()` всегда отправляет его в заголовке
`Idempotency-Key`. HTTP-сервис 1С обязан искать существующий документ по
`siteOrderId`/ключу до создания нового заказа.

POST без idempotency key автоматически не повторяется. Операции, защищенные
ключом, и безопасные GET могут повторяться ограниченное число раз.

## 12. Ошибки и ответы

Успешный ответ:

```json
{
  "ok": true,
  "idempotencyKey": "products-2026-09-04T10:00:00Z-part-1",
  "processed": 95,
  "failed": 0,
  "errors": []
}
```

Частичный ответ (`207 Multi-Status`):

```json
{
  "ok": false,
  "idempotencyKey": "products-2026-09-04T10:00:00Z-part-1",
  "processed": 95,
  "failed": 5,
  "errors": [
    {
      "index": 12,
      "externalId": "product-guid",
      "code": "VALIDATION_ERROR",
      "message": "Запись не соответствует контракту.",
      "issues": [{ "path": "diameter", "message": "Too small" }]
    }
  ]
}
```

Основные коды: `UNAUTHORIZED` (401), `VALIDATION_ERROR` (422),
`SYNCHRONIZATION_IN_PROGRESS` (409), `REQUEST_TOO_LARGE` (413),
`ONEC_UNAVAILABLE` (503). Клиент не получает stack trace, SQL и секреты.

## 13. Timeout и retry

- исходящий timeout по умолчанию: 8 секунд;
- повторы: максимум 2 после первой попытки;
- задержка растет экспоненциально;
- повторяются сетевые ошибки, HTTP 408, 429 и 5xx;
- небезопасный POST без idempotency key не повторяется;
- задержка очереди заказов увеличивается до одного часа;
- зависшая более 15 минут запись `processing` снова доступна обработчику;
- недоступность 1С не переводит весь магазин в состояние down.

Пример health:

```json
{
  "ok": true,
  "site": "healthy",
  "database": "healthy",
  "oneC": "unavailable",
  "timestamp": "2026-09-04T03:00:00.000Z"
}
```

## 14. Журнал синхронизации

`integration_sync_logs` содержит источник, сущность, операцию, направление,
режим, idempotency key, курсор, начало/окончание, статус, количество принятых,
обработанных и ошибочных записей, безопасное резюме и структурированный
результат. Ошибки отдельных элементов записываются в
`integration_sync_errors`.

Тела заказов, пароли, API-ключи, HTTP-заголовки и другие секреты в журнал
синхронизации не пишутся.

## 15. Пример HTTP request

```http
POST /api/integrations/1c/v1/stocks/batch HTTP/1.1
Host: api.apex-wheels.ru
Content-Type: application/json
X-Integration-Key: <secret>

{
  "apiVersion": "1.0",
  "idempotencyKey": "stocks-2026-09-04T10:05:00Z",
  "mode": "incremental",
  "items": [
    {
      "externalId": "product-guid",
      "warehouseExternalId": "warehouse-guid",
      "warehouseCode": "BARNAUL-MAIN",
      "warehouseName": "Барнаул · Основной склад",
      "quantity": 8,
      "reserved": 0
    }
  ]
}
```

## 16. ENV variables

| Переменная | Назначение |
| --- | --- |
| `DATABASE_URL` | строка соединения PostgreSQL |
| `DATABASE_SSL_MODE` | `require` в production |
| `INTEGRATION_API_KEY` | входящие запросы 1С |
| `ONEC_BASE_URL` | HTTPS URL опубликованного HTTP-сервиса 1С |
| `ONEC_API_KEY` | ключ исходящих запросов, если выбран API key |
| `ONEC_API_KEY_HEADER` | имя заголовка ключа |
| `ONEC_USERNAME`, `ONEC_PASSWORD` | альтернатива: Basic Auth поверх HTTPS |
| `ONEC_REQUEST_TIMEOUT_MS` | timeout HTTP-запроса |
| `ONEC_SAFE_RETRY_COUNT` | число безопасных повторов |

## 17. Что должен реализовать программист 1С

1. Опубликовать HTTPS HTTP-сервис либо подготовить регламентную обработку.
2. Сопоставить GUID номенклатуры, SKU, виды товаров и характеристики.
3. Сопоставить виды цен и склады со стабильными кодами/GUID.
4. Реализовать полную и инкрементальную выборку с датой или версией изменений.
5. Формировать batch и уникальные idempotency key.
6. Обрабатывать `200`, `207`, `4xx`, `429` и `5xx`; повторять только безопасные
   операции.
7. Искать заказ по `siteOrderId` до создания документа.
8. Возвращать external ID, статус заказа и оплаты.
9. Не писать секреты и персональные данные в обычный журнал регистрации.
10. Провести сверку контрольных товаров, цен, складов и заказов в staging.

## 18. Информация, необходимая перед реальным подключением

- версия платформы 1С;
- название и версия конфигурации;
- файловый, серверный или облачный режим;
- доступные REST/HTTP возможности;
- адрес сервера 1С и публикации информационной базы;
- наличие HTTPS и действующего сертификата;
- поддерживаемый способ authentication;
- структура номенклатуры и групп товаров;
- GUID и правила формирования SKU/артикула;
- дополнительные реквизиты шин и дисков;
- виды цен и валюта;
- список складов и правила доступного остатка;
- структура документа заказа;
- схема статусов заказа и оплаты;
- кастомные поля и существующие доработки;
- способ передачи и хранения изображений;
- тестовая база, технический пользователь и сетевой доступ.

## 19. Развертывание

1. Создать PostgreSQL в российском дата-центре.
2. Задать server-side ENV Next.js через secret manager.
3. Выполнить `pnpm db:migrate`.
4. Собрать `pnpm build` и запустить Next.js за HTTPS reverse proxy.
5. Ограничить сетевой доступ к PostgreSQL.
6. Настроить backup/restore, мониторинг и алерты очереди.
7. Подключить staging-базу 1С и выполнить приемочные тесты.
8. Только после сверки включить production-расписание.

Расписание намеренно не зашито в код. После анализа 1С обычно товары
обновляются реже, а цены и остатки — чаще.

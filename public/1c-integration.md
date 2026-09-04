# APEX WHEELS — контракт обмена с 1С v1

Реальная 1С пока не подключена. Этот документ описывает подготовленный
HTTPS/JSON API серверного слоя Next.js с PostgreSQL.

## Авторизация

Все методы требуют серверный заголовок:

```http
X-Integration-Key: <INTEGRATION_API_KEY>
```

Ключ нельзя помещать во frontend или репозиторий.

## Методы

- `GET /api/integrations/1c/v1/health`
- `POST /api/integrations/1c/v1/products/batch`
- `POST /api/integrations/1c/v1/prices/batch`
- `POST /api/integrations/1c/v1/stocks/batch`
- `POST /api/integrations/1c/v1/fitments/batch`
- `GET /api/integrations/1c/v1/orders?limit=100`
- `POST /api/integrations/1c/v1/order-statuses/batch`

## Общий batch

```json
{
  "apiVersion": "1.0",
  "idempotencyKey": "products-2026-09-04T10:00:00Z",
  "mode": "incremental",
  "changedSince": "2026-09-04T09:00:00+07:00",
  "items": []
}
```

Один пакет содержит до 5 000 записей. Повтор завершенного пакета с тем же
`idempotencyKey` не создает дубликаты. Полный формат полей, правила retry,
заказов, изображений и данные, необходимые от заказчика, находятся в
`docs/1C_REST_INTEGRATION.md` исходного репозитория.

## Результат

```json
{
  "ok": false,
  "idempotencyKey": "products-2026-09-04T10:00:00Z",
  "processed": 95,
  "failed": 5,
  "errors": [
    {
      "index": 12,
      "externalId": "product-guid",
      "code": "VALIDATION_ERROR",
      "message": "Запись не соответствует контракту."
    }
  ]
}
```

Код `207` означает, что корректные записи сохранены, а ошибочные перечислены
отдельно. Сайт продолжает работать из PostgreSQL, даже если 1С недоступна.

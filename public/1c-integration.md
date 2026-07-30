# APEX WHEELS — API обмена с 1С

Версия контракта: `1.0`

## Авторизация

Все методы, кроме `GET /api/1c/health`, требуют заголовок:

```http
X-1C-Token: <ONEC_SHARED_SECRET>
Content-Type: application/json
```

Токен задаётся как production secret `ONEC_SHARED_SECRET` и не хранится в репозитории.

## Проверка доступности

```http
GET /api/1c/health
```

## Импорт номенклатуры

```http
POST /api/1c/import/products
```

```json
{
  "version": "1.0",
  "syncId": "1c-products-20260730-080000",
  "products": [
    {
      "externalId": "1C-000001",
      "sku": "T-MI-PS5-2254518",
      "kind": "tire",
      "brand": "Michelin",
      "model": "Pilot Sport 5",
      "subtitle": "225/45 R18 95Y XL",
      "width": 225,
      "profile": 45,
      "diameter": 18,
      "season": "summer",
      "studded": false,
      "runflat": false,
      "country": "Франция",
      "tags": ["XL"],
      "isActive": true,
      "isFeatured": true
    }
  ]
}
```

До 1000 товаров за один запрос. Повторный `externalId` обновляет существующую запись.

## Импорт цен и остатков

```http
POST /api/1c/import/stock-prices
```

```json
{
  "version": "1.0",
  "syncId": "1c-stock-20260730-080100",
  "rows": [
    {
      "externalId": "1C-000001",
      "warehouseCode": "MSK-N",
      "warehouseName": "Москва · Север",
      "quantity": 12,
      "reserved": 2,
      "price": 18490,
      "oldPrice": 20990,
      "currency": "RUB"
    }
  ]
}
```

До 5000 строк за один запрос.

## Экспорт заказов

```http
GET /api/1c/orders/export
```

Возвращает до 100 заказов, которые ещё не были помечены как выгруженные. Для production рекомендуется добавить endpoint подтверждения импорта заказа со стороны 1С.

## Коды ответа

- `200` — операция выполнена.
- `202` — данные валидны, но БД не подключена; режим validation-only.
- `401` — неверный токен.
- `413` — запрос больше 5 МБ.
- `422` — ошибка структуры данных.
- `503` — secret интеграции не настроен.

## Идемпотентность

`syncId` должен быть уникальным идентификатором операции на стороне 1С. Схема БД содержит таблицу `sync_runs` для регистрации запусков, курсоров и ошибок.

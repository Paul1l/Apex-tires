# APEX WHEELS — контракт обмена с 1С

Версия контракта: `1.0`

> Сейчас опубликованный стенд работает в режиме `validation-only`: токен и
> база данных не подключены. Это API-контур, а не активная синхронизация.

## Авторизация

Все методы, кроме `GET /api/1c/health`, требуют:

```http
X-1C-Token: <ONEC_SHARED_SECRET>
Content-Type: application/json
```

Токен задается как production secret `ONEC_SHARED_SECRET` и не хранится в
репозитории.

## Проверка

```http
GET /api/1c/health
```

Поле `mode` имеет значение `active` только когда настроены и токен, и база.

## Импорт номенклатуры

```http
POST /api/1c/import/products
```

```json
{
  "version": "1.0",
  "syncId": "1c-products-20260731-080000",
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

До 1000 товаров за запрос. Повторный `externalId` обновляет товар. Один и тот
же успешно обработанный `syncId` повторно не изменяет данные.

## Импорт цен и остатков

```http
POST /api/1c/import/stock-prices
```

```json
{
  "version": "1.0",
  "syncId": "1c-stock-20260731-080100",
  "rows": [
    {
      "externalId": "1C-000001",
      "warehouseCode": "KEM-MAIN",
      "warehouseName": "Барнаул · Основной склад",
      "quantity": 12,
      "reserved": 2,
      "price": 18490,
      "oldPrice": 20990,
      "currency": "RUB"
    }
  ]
}
```

До 5000 строк за запрос. Сначала нужно выгрузить номенклатуру: строка с
неизвестным `externalId` не сможет создать цену или остаток.

## Импорт применяемости

```http
POST /api/1c/import/fitments
```

```json
{
  "version": "1.0",
  "syncId": "1c-fitments-20260731-080200",
  "rows": [
    {
      "externalId": "1C-000001",
      "make": "BMW",
      "model": "3 Series",
      "generation": "G20",
      "yearFrom": 2019,
      "yearTo": 2026,
      "isOem": true
    }
  ]
}
```

До 5000 строк за запрос. Пакет удаляет предыдущую применяемость только для
затронутых `externalId` и записывает актуальные строки. Сначала нужно загрузить
товары через `import/products`.

## Получение заказов

```http
GET /api/1c/orders/export
```

Метод возвращает до 100 не подтвержденных заказов вместе с товарными строками.
Денежные суммы передаются целым числом в копейках.

После успешной записи документов в 1С нужно подтвердить заказы:

```http
POST /api/1c/orders/acknowledge
```

```json
{
  "version": "1.0",
  "syncId": "1c-orders-ack-20260731-081000",
  "orderIds": ["order-site-000001"]
}
```

Подтверждение отправляется **только после фиксации транзакции в 1С**. При
сетевой ошибке запрос безопасно повторяется с тем же `syncId`.

## Ответы

- `200` — операция выполнена;
- `202` — JSON корректен, но база не подключена (`validation-only`);
- `400` — некорректный JSON;
- `401` — неверный `X-1C-Token`;
- `413` — запрос больше 5 МБ;
- `422` — структура не соответствует контракту;
- `503` — `ONEC_SHARED_SECRET` не задан.

Полная инструкция внедрения находится в `docs/ONEC_INTEGRATION.md` исходного
кода.

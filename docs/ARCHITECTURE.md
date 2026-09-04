# Архитектура APEX WHEELS

## Текущее состояние

Витрина сохраняет существующий Next.js/React UI. Серверные Route Handlers,
сервисы, репозитории и интеграционные адаптеры находятся в том же TypeScript-
приложении. Production-БД — PostgreSQL. Реальная БД, 1С, платежи и object
storage пока не подключены, поэтому публичный стенд нельзя использовать для
настоящих заказов.

## Целевая схема

```text
Browser -> Next.js Route Handlers -> Services -> Repositories -> PostgreSQL
                    |
                    +-> ERP provider -> 1С HTTP/JSON
                    +-> Payment provider
                    +-> Email/SMS provider
                    +-> Object storage
```

Frontend не получает секреты и не обращается напрямую к PostgreSQL, 1С,
платежам или провайдерам сообщений.

## Backend-слои

| Каталог | Ответственность |
| --- | --- |
| `app/api` | Route Handlers, HTTP-ввод/вывод и authentication |
| `server/bootstrap` | server-only сборка зависимостей приложения |
| `server/services` | бизнес-правила и транзакционные сценарии |
| `server/repositories` | SQL и отображение данных PostgreSQL |
| `server/integrations` | адаптеры внешних систем |
| `server/validators` | runtime-проверка недоверенного JSON |
| `server/database/migrations` | воспроизводимая схема PostgreSQL |

## Ключевые решения

- Каталог читается из PostgreSQL, а не из 1С при каждом открытии страницы.
- Заказ и элемент очереди создаются одной транзакцией.
- Цена и остаток при оформлении повторно проверяются backend.
- Внутренний UUID отделен от внешнего ID 1С.
- Ошибка 1С не делает магазин недоступным.
- Полный импорт деактивирует отсутствующие товары только после полностью
  успешного пакета.
- Интеграционный API имеет версию `/v1` и отдельный server-only ключ для 1С.
- Логи не содержат пароли, API-ключи и полные тела заказов.

## Постепенная миграция frontend

Существующий UI сохраняется. Следующие изменения выполняются по одному
функциональному срезу:

1. каталог: `StoreProvider` -> catalog service -> REST API;
2. оформление: корзина -> order service -> `POST /api/v1/orders`;
3. админка: формы -> admin service -> защищенный backend;
4. OTP и сессии: текущие обработчики -> PostgreSQL repositories;
5. фото: browser base64 -> российское object storage.

До завершения этих шагов localStorage остается только прототипным адаптером, а
не production-хранилищем.

# Production deployment на российском VDS

Целевой контур: один VDS с Docker Compose, Next.js, PostgreSQL и Nginx. PostgreSQL не публикуется в интернет. Nginx является единственной публичной точкой входа.

## До запуска

1. Получить домен и направить A-запись на VDS.
2. Заполнить клиентские данные из `CLIENT_DATA_REQUIRED.md`.
3. Создать `.env.production` вне Git на основе `.env.example`.
4. Сгенерировать отдельные случайные значения `POSTGRES_PASSWORD`, `OTP_CODE_PEPPER`, `INTERNAL_JOB_SECRET` и `INTEGRATION_API_KEY` длиной не менее 32 символов.
5. Открыть только TCP 22, 80 и 443. Порт PostgreSQL 5432 наружу не открывать.

## Первый запуск

```bash
docker compose --env-file .env.production -f deploy/docker-compose.production.yml build
docker compose --env-file .env.production -f deploy/docker-compose.production.yml up -d postgres
docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm app pnpm db:migrate
```

Для первого выпуска сертификата временно смонтировать
`deploy/nginx/bootstrap-http.conf.template` вместо TLS-шаблона и запустить
Nginx на порту 80. Выпустить сертификат Let's Encrypt через certbot webroot.
После появления файлов `/etc/letsencrypt/live/<домен>/fullchain.pem` и
`privkey.pem` вернуть `deploy/nginx/templates/default.conf.template` и
запустить весь контур:

```bash
docker compose --env-file .env.production -f deploy/docker-compose.production.yml up -d
```

## Обновление

```bash
git pull --ff-only
docker compose --env-file .env.production -f deploy/docker-compose.production.yml build app
docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm app pnpm db:migrate
docker compose --env-file .env.production -f deploy/docker-compose.production.yml up -d app nginx
```

Сначала создаётся резервная копия БД. После выкладки проверяются `/api/health`, каталог, вход, создание тестового заказа и журналы контейнеров.

## Резервные копии

`deploy/scripts/backup-postgres.sh` создаёт custom-format backup для `pg_restore` и удаляет локальные копии старше заданного срока. Скрипт запускается cron ежедневно. Минимум одна дополнительная зашифрованная копия должна уходить на независимое российское object storage. Восстановление необходимо проверять регулярно на отдельной БД.

Пример cron внутри административного контура:

```cron
30 2 * * * docker compose --env-file /opt/apex/.env.production -f /opt/apex/deploy/docker-compose.production.yml exec -T postgres /scripts/backup-postgres.sh
```

Скрипт уже смонтирован в контейнер PostgreSQL только для чтения. Пароли не указываются прямо в crontab.

## Фоновые уведомления

Заказы и заявки атомарно создают записи в `notification_outbox`. Каждую минуту cron вызывает защищённый `POST /api/internal/jobs/notifications` с заголовком `X-Job-Key`. Значение заголовка берётся из `INTERNAL_JOB_SECRET`; его нельзя помещать в команду, попадающую в общий журнал или историю shell. Если Postbox временно недоступен, уведомление остаётся в очереди и получает отложенную повторную попытку.

## Что не автоматизируется без инфраструктуры заказчика

- покупка и настройка домена;
- создание VDS и firewall;
- выпуск сертификата;
- внешний backup storage;
- реальные SMTP/Postbox, 1С и платежные credentials;
- мониторинг и уведомления дежурному.

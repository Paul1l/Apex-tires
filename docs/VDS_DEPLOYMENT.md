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

## Освобождение резервов

Отдельное задание вызывает защищённый `POST /api/internal/jobs/reservations`
с `X-Job-Key`, тем же способом передачи секрета, что и очередь уведомлений.
Рекомендуемая начальная частота — раз в минуту, но окончательно её выбирает
владелец. Один вызов обрабатывает до 100 заказов; при большом backlog нужны
дополнительные ограниченные вызовы и мониторинг. Повторный вызов безопасен.

`ORDER_RESERVATION_TTL_HOURS` задаёт срок резерва (по умолчанию 24 часа).
Согласовать срок до открытия магазина. Рекомендация аудита безопасности:
для анонимных неподтверждённых заказов сократить срок (например, до 1–2 часов
или резервировать после звонка менеджера), чтобы поддельные заказы не
«замораживали» остаток на сутки. Значение по умолчанию не меняется без решения
владельца. Истёкший резерв освобождает товар, но
не подменяет бизнес-статус заказа. Отгрузка такого заказа запрещена до решения
менеджера: текущая версия позволяет отменить заказ и оформить новый после
проверки остатка. Автоматическое повторное резервирование не реализовано.

Проверить оба задания на staging. Без работающего задания истёкшие резервы
продолжат уменьшать доступный остаток; один лишь запуск Next.js их не очищает.

## IP клиента и защита от злоупотреблений

### Откуда берётся IP клиента

`TRUSTED_PROXY` указывает, какому прокси приложение верит:

| Значение | Где | Какой заголовок читается |
| --- | --- | --- |
| `nginx` | этот VDS (Docker Compose передаёт по умолчанию) | только `X-Real-IP`, его nginx перезаписывает из `$remote_addr` |
| `cloudflare` | демо на Cloudflare Workers (`wrangler.jsonc`) | только `CF-Connecting-IP`, его перезаписывает Cloudflare |
| `none` или пусто | локальная разработка, неизвестный хостинг | никакой: IP неизвестен |

`X-Forwarded-For` не читается никогда: его левое значение задаёт клиент.
Шаблон nginx заменяет `X-Forwarded-For` на `$remote_addr` и удаляет
присланный клиентом `CF-Connecting-IP`. При `none` лимиты по IP не
применяются (иначе все посетители попали бы в одну корзину лимита), лимиты по
телефону и email работают, IP в журнал согласий не пишется; в production в
журнал выводится предупреждение. Если перед VDS появится Cloudflare, в nginx
нужно добавить `set_real_ip_from` с диапазонами Cloudflare и
`real_ip_header CF-Connecting-IP`, иначе `$remote_addr` будет адресом
Cloudflare.

### Лимиты

Лимиты хранятся в PostgreSQL (таблица `rate_limit_buckets`, миграция 007) и
общие для всех процессов. Окна фиксированные и выровнены по времени (часовое
окно сбрасывается в начале часа). Ответ при превышении — `429` в обычном
формате ошибок с подсказкой «Повторите через N мин.». Это защитные пороги, не
бизнес-правила; значение по умолчанию меняется переменной окружения.

| Действие | Ключ | По умолчанию | Окно | Переменная |
| --- | --- | --- | --- | --- |
| Оформление заказа | IP (IPv6 — по /64) | 10 | 1 ч | `RATE_LIMIT_ORDERS_PER_IP` |
| Оформление заказа | телефон; отдельно email | 5 | 1 ч | `RATE_LIMIT_ORDERS_PER_CONTACT` |
| Заказы с неистёкшим резервом одновременно | телефон или email | 3 | — | `ORDER_MAX_ACTIVE_RESERVATIONS_PER_CONTACT` |
| Заявка на подбор | IP | 5 | 1 ч | `RATE_LIMIT_FITMENT_REQUESTS_PER_IP` |
| Заявка на подбор | телефон | 3 | 1 ч | `RATE_LIMIT_FITMENT_REQUESTS_PER_PHONE` |
| Сохранение гостевой корзины | IP | 120 | 10 мин | `RATE_LIMIT_GUEST_CART_WRITES_PER_IP` |
| Запрос кода входа | IP | 30 | 1 ч | `RATE_LIMIT_AUTH_CODE_REQUESTS_PER_IP` |
| Неверные коды входа | email | 15 | скользящие 24 ч | `OTP_MAX_FAILED_ATTEMPTS_PER_EMAIL` |
| Обмен с 1С | IP | 120 | 1 мин | `RATE_LIMIT_ONEC_REQUESTS_PER_IP` |

Кроме того, одного товара в заказе может быть не больше 20 шт. и после
объединения повторяющихся строк. Ключи лимитов хранятся только как HMAC
(`OTP_CODE_PEPPER`), IP, телефоны и email в таблице лимитов не видны.
Некорректное значение переменной останавливает обработку запросов с ошибкой
конфигурации, как и другие обязательные настройки.

Истёкшие окна удаляет задание `POST /api/internal/jobs/reservations` (до
5 000 строк за вызов) и, дополнительно, примерно каждый сотый запрос с
лимитом (до 1 000 строк). Таблица не растёт без задания, но с заданием чище.

Рекомендуется продублировать грубые лимиты в nginx (`limit_req_zone` для
`/api/auth/`, `/api/v1/orders`, `/api/v1/fitment-requests`,
`/api/v1/account/cart`) после проверки на staging, а для анонимного checkout и
формы заявки — CAPTCHA (решение заказчика).

### Заголовки безопасности

`next.config.ts` (`headers()`) отдаёт для всех маршрутов `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` и
`Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`.
Это работает и в `next start`, и в OpenNext worker. Nginx добавляет HSTS и
`server_tokens off`, а `nosniff`/`Referrer-Policy` ставит сам (копии
приложения скрыты, чтобы заголовки не дублировались). CSP пока не ограничивает
`script-src`/`img-src`: полная политика с nonce для Next.js и Яндекс Метрики —
отдельная задача. Запрет встраивания во фреймы отключает отображение карты
кликов Метрики поверх сайта; сбор данных не затрагивается.

## Действия, требующие доступа заказчика

- покупка и настройка домена;
- создание VDS и firewall;
- выпуск сертификата;
- внешний backup storage;
- реальные SMTP/Postbox, 1С и платежные credentials;
- мониторинг и уведомления дежурному.

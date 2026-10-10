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
docker compose --env-file .env.production -f deploy/docker-compose.production.yml pull nginx
docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm app pnpm db:migrate
docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm --no-deps nginx nginx -t
docker compose --env-file .env.production -f deploy/docker-compose.production.yml up -d app nginx
docker compose --env-file .env.production -f deploy/docker-compose.production.yml restart nginx
```

Сначала создаётся резервная копия БД. После выкладки проверяются `/api/health`, каталог, вход, создание тестового заказа и журналы контейнеров.

`pull nginx` подтягивает исправления стабильной ветки nginx (тег `1.30-alpine`).
Шаблон `deploy/nginx/templates/default.conf.template` подставляется в конфигурацию
только при старте контейнера, а `up -d` не перезапускает nginx, если изменился
лишь шаблон, — поэтому после `git pull` нужен `restart nginx`. Команда
`run --rm --no-deps nginx nginx -t` заранее проверяет новый шаблон с текущими
переменными и сертификатом, не трогая работающий nginx (контейнер `app` должен
быть запущен: имя `app` разрешается при проверке). Если проверка не прошла,
`restart` не выполнять.

## Проверка конфигурации при старте

При запуске `next start` (`instrumentation.ts`) приложение проверяет окружение
и пишет найденные проблемы в журнал контейнера одной строкой на проблему:

```text
[config] ОШИБКА (OTP_CODE_PEPPER): OTP_CODE_PEPPER не задан: гостевая корзина, вход и сессии отвечают 503 ...
```

Проверяются: `DATABASE_URL` для сборки в режиме database, `OTP_CODE_PEPPER`
(без него корзина, вход и сессии отвечают 503), корректность backend-переменных
(`readEnvironment`), защитных лимитов и `TRUSTED_PROXY` (без него в production —
предупреждение). Значения переменных в журнал не пишутся. Сервер при этом не
останавливается, чтобы preview, демо на Cloudflare и сборка Docker-образа без
env работали как прежде; если хука нет, та же проверка выполняется при первом
запросе к БД. После выкладки:

```bash
docker compose --env-file .env.production -f deploy/docker-compose.production.yml logs app | grep '\[config\]'
```

Пустой вывод означает, что проблем не найдено.

## Яндекс Метрика на VDS

`YANDEX_METRIKA_COUNTER_ID` задаётся в `.env.production` и передаётся в
контейнер (`deploy/docker-compose.production.yml`); `/api/public-config` читает
его из окружения процесса. Интеграция с wrangler (`initOpenNextCloudflareForDev`)
включается только в `next dev`, поэтому в production-контейнере не запускается
`workerd`. На Cloudflare значение берётся из vars/secrets worker.

## Резервные копии

`deploy/scripts/backup-postgres.sh` создаёт custom-format backup для `pg_restore` и удаляет локальные копии старше заданного срока. Скрипт запускается cron ежедневно. Минимум одна дополнительная зашифрованная копия должна уходить на независимое российское object storage. Восстановление необходимо проверять регулярно на отдельной БД.

Пример cron внутри административного контура:

```cron
30 2 * * * docker compose --env-file /opt/apex/.env.production -f /opt/apex/deploy/docker-compose.production.yml exec -T postgres sh /scripts/backup-postgres.sh
```

Скрипт уже смонтирован в контейнер PostgreSQL только для чтения. Пароли не указываются прямо в crontab.
Скрипт запускается через `sh`: в Git он хранится без права на исполнение, и
прямой вызов `/scripts/backup-postgres.sh` завершился бы ошибкой `permission denied`.

## Фоновые уведомления

Заказы и заявки атомарно создают записи в `notification_outbox`. Каждую минуту cron вызывает защищённый `POST /api/internal/jobs/notifications` с заголовком `X-Job-Key`. Значение заголовка берётся из `INTERNAL_JOB_SECRET`; его нельзя помещать в команду, попадающую в общий журнал или историю shell. Если Postbox временно недоступен, уведомление остаётся в очереди и получает отложенную повторную попытку.

Задания вызываются только изнутри контура: nginx отвечает `403` на любой
запрос к `/api/internal/` извне. Cron на хосте запускает
`deploy/scripts/run-internal-job.sh`; скрипт выполняет запрос внутри
контейнера `app` (`docker compose exec -T app node …` к
`http://127.0.0.1:3000`), а ключ читает из `INTERNAL_JOB_SECRET` в окружении
контейнера — секрета нет ни в crontab, ни в аргументах команды:

```cron
* * * * * flock -n /run/lock/apex-job-notifications.lock sh /opt/apex/deploy/scripts/run-internal-job.sh notifications
* * * * * flock -n /run/lock/apex-job-reservations.lock sh /opt/apex/deploy/scripts/run-internal-job.sh reservations
```

`flock -n` не даёт запускам накладываться, если задание выполняется дольше
минуты. Аргумент — имя задания из `/api/internal/jobs/<имя>` (допустимы только
`a-z`, `0-9` и `-`), так же вызываются и разовые задания. Скрипт ищет
`.env.production` в корне репозитория (`/opt/apex`; другой путь — переменная
`APEX_ENV_FILE`). При успехе он ничего не выводит; при
ошибке (код HTTP не 2xx или `"ok": false`, например часть писем не ушла)
печатает статус и укороченный ответ (только счётчики) и завершается с кодом 1 —
cron пришлёт это письмом, если для crontab настроен `MAILTO`. Вызовы через
публичный адрес (`curl https://<домен>/api/internal/...`) больше не работают:
их нужно заменить на строки выше.

## Освобождение резервов

Отдельное задание вызывает защищённый `POST /api/internal/jobs/reservations`
с `X-Job-Key`, тем же способом передачи секрета, что и очередь уведомлений
(вторая строка crontab в разделе выше).
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

IPv6: сеть Docker в `docker-compose.production.yml` без IPv6. Если у VDS есть
IPv6 и для домена опубликована AAAA-запись, IPv6-соединения к портам 80/443
принимает `docker-proxy` и передаёт их в контейнер nginx уже от адреса шлюза
Docker-сети (`172.x.0.1`): все IPv6-посетители попадут в одну корзину лимитов
по IP, а allowlist 1С по IPv6 не сработает. Пока IPv6 для сети Docker не
включён и не проверен, AAAA-запись не публиковать. Признак проблемы — адреса
`172.x.0.1` в `docker compose ... logs nginx`. Адрес шлюза нельзя добавлять в
allowlist и разрешать для `/api/internal/`: через него проходят все IPv6-клиенты.

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

Собственные ответы nginx (400, 403, 413, 414, 502) несут HSTS, `nosniff` и
`Referrer-Policy` (`add_header ... always` на уровне `server`);
`X-Frame-Options`, CSP и `Permissions-Policy` есть только в ответах
приложения. `add_header` наследуется в `location` (и в блок `if`), только если
там нет ни одного своего `add_header`. Поэтому в шаблоне `location` их не
содержат; если понадобится добавить заголовок в отдельный `location`, в нём
нужно повторить все три строки уровня `server`.

## Nginx: правила перед приложением

Шаблон `deploy/nginx/templates/default.conf.template`, порт 443.

**Битое %-кодирование пути — 400.** Если `%XX` в пути не складываются в
корректный UTF-8 (`/legal/%C0%AF`, `/tires/%E0%A4`), роутер Next.js падает с
500 ещё до кода приложения. Nginx отвечает на такие пути `400 Bad Request` и не
проксирует их; синтаксически неверные `%ZZ`, `%A` в конце и `%00` nginx
отклоняет с тем же кодом сам. Выбран 400, а не 404: запрос некорректен
синтаксически, и все варианты битого кодирования получают один код; для
поисковых систем 400 и 404 равнозначны. Строка запроса (`?q=%ZZ`) не
проверяется: Next.js разбирает её без ошибки. Кириллические slug, `+`, `%2F`,
`%25` проходят в приложение как раньше. Проверка — одно регулярное выражение
с притяжательными квантификаторами (без катастрофических возвратов); URI
длиннее 8 КБ nginx отклоняет кодом 414 ещё до неё.

**Сжатие.** Ответы сжимает nginx (gzip, уровень 5): HTML, CSS, JS, JSON, XML,
SVG, RSC (`text/x-component`), текст. Уже сжатые форматы (AVIF, WebP, JPEG,
PNG, WOFF2) не сжимаются. Приложению заголовок `Accept-Encoding` не
передаётся, поэтому `next start` не тратит процессор на сжатие и двойного
сжатия нет. Brotli в образе `nginx:alpine` без стороннего модуля недоступен.
ETag сжатых ответов nginx помечает слабым (`W/"..."`), повторная проверка
(`304`) работает.

**Фоновые задания.** `/api/internal/` доступен только с loopback контейнера
nginx, извне — `403`. Задания запускаются внутри контейнера `app` (см.
«Фоновые уведомления»).

**Обмен с 1С: необязательный allowlist адресов.** По умолчанию
`/api/integrations/1c/` защищён только ключом `INTEGRATION_API_KEY`. Чтобы
дополнительно ограничить адреса, в `.env.production` задать:

```dotenv
ONEC_ALLOWED_IPS=203.0.113.10,203.0.113.11
```

Точные адреса через запятую или пробел, в той форме, в какой nginx пишет их в
журнал (IPv6 — в сокращённой записи). Диапазоны CIDR не поддерживаются: такая
запись ни с чем не совпадёт, и 1С получит `403`. С другого адреса nginx отвечает
`403` до приложения; пустое значение — проверка выключена. Применить:
`docker compose ... run --rm --no-deps nginx nginx -t`, затем
`docker compose ... up -d nginx` (изменилась переменная — контейнер
пересоздаётся) и пробный обмен с 1С. Адрес, с которого реально приходит 1С,
виден в `docker compose ... logs nginx`. Символы `"`, `$` и `\` в значении
ломают конфигурацию: nginx не запустится, проверка `nginx -t` это покажет.

**Версии образов.** `nginx:1.30-alpine` — текущая стабильная ветка (1.30.5 на
октябрь 2026); прежний `nginx:1.27-alpine` не обновлялся с апреля 2025 года и
не содержит исправлений уязвимостей 1.29–1.30 (в том числе в модуле rewrite и
в `map` с регулярными выражениями). Патчи стабильной ветки подтягиваются
`docker compose ... pull nginx`; при выходе следующей стабильной ветки (чётный
минорный номер) тег меняется вручную после проверки `nginx -t`. Предупреждение
`the "listen ... http2" directive is deprecated` в журнале nginx безопасно.
`postgres:17-bookworm` актуален (17.x, обновляется); переход на `17-trixie`
меняет glibc и требует переиндексации текстовых индексов, переход на
PostgreSQL 18 — отдельная миграция с резервной копией.

## Действия, требующие доступа заказчика

- покупка и настройка домена;
- создание VDS и firewall;
- выпуск сертификата;
- внешний backup storage;
- реальные SMTP/Postbox, 1С и платежные credentials;
- мониторинг и уведомления дежурному.

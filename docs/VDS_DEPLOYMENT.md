# Production deployment на российском VDS

Целевой контур: один VDS с Docker Compose, Next.js, PostgreSQL и Nginx. PostgreSQL не публикуется в интернет. Nginx является единственной публичной точкой входа.

## До запуска

1. Получить домен и направить A-запись на VDS.
2. Заполнить клиентские данные из `CLIENT_DATA_REQUIRED.md`.
3. Создать `.env.production` вне Git на основе `.env.example`.
4. Сгенерировать отдельные случайные значения `POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD`, `OTP_CODE_PEPPER`, `INTERNAL_JOB_SECRET` и `INTEGRATION_API_KEY` длиной не менее 32 символов. Пароли PostgreSQL входят в строку подключения, поэтому в них не должно быть символов, требующих кодирования в URL; подходит `openssl rand -hex 32`.
5. Открыть только TCP 22, 80 и 443. Порт PostgreSQL 5432 наружу не открывать.
6. Контакты и реквизиты `NEXT_PUBLIC_*` (телефон, email, адрес магазина,
   данные продавца) обязательны: без них production-сборка остановится
   (`assertProductionBusinessConfig`). После запуска данные магазина правятся
   в админке, но значения из сборки по-прежнему видны на сайте до сброса кэша
   после каждой выкладки и когда база недоступна, поэтому их держат
   актуальными (см. «Сброс кэша страниц после запуска»).
7. По желанию: `PRODUCT_IMAGE_MAX_BYTES` и `PRODUCT_IMAGE_MAX_COUNT` (пусто —
   5 МБ и 10 фото на товар, см. «Фото товаров»). `UPLOADS_DIR` в
   `.env.production` не задаётся: его фиксирует compose-файл.

## Первый запуск

Команды выполняются из корня репозитория на сервере (`/opt/apex`). Порядок
важен: каждый шаг опирается на предыдущий.

1. **Сборка образа** (`apex-wheels-app:latest`; его же использует сервис
   `migrate`):

   ```bash
   docker compose --env-file .env.production -f deploy/docker-compose.production.yml build
   ```

2. **PostgreSQL и роль приложения.** При первом старте с пустым томом образ
   выполняет `deploy/postgres/init/10-app-role.sql` (см. «Роли PostgreSQL»):

   ```bash
   docker compose --env-file .env.production -f deploy/docker-compose.production.yml up -d postgres
   docker compose --env-file .env.production -f deploy/docker-compose.production.yml logs postgres | grep 'Роль приложения'
   ```

   Ожидается строка «Роль приложения apex_app готова …».

3. **Миграции 001–013** выполняет владелец схемы через одноразовый сервис
   `migrate`:

   ```bash
   docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm migrate
   ```

   Вывод — строки от `Applied 001_initial_postgresql.sql` до
   `Applied 013_staff_trusted_devices.sql` (номера 011 нет: миграция не
   понадобилась). Повторный запуск ничего не применяет и ничего не выводит.

4. **Первый администратор** (открытой регистрации сотрудников нет,
   `docs/AUTHENTICATION.md`, «Первый администратор»):

   ```bash
   docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm migrate \
     node_modules/.bin/tsx server/tools/create-staff.ts --email admin@example.ru --name "Имя Фамилия"
   ```

   Это `pnpm admin:create` без pnpm (см. «Команды без pnpm»). Команда печатает
   QR-код и ключ — это секрет входа: сразу отсканируйте QR-код
   приложением-аутентификатором (Google Authenticator, Яндекс Ключ и др.), не
   сохраняйте вывод в файлы и чаты и очистите экран (`clear`). Сервис
   `migrate` берёт из `.env.production` тот же `OTP_CODE_PEPPER`, что и сайт:
   ключ сотрудника шифруется производным от него ключом, поэтому после
   запуска `OTP_CODE_PEPPER` не меняют (иначе ключи всех сотрудников придётся
   выпускать заново).

5. **Сертификат и запуск сайта.** Для первого выпуска сертификата временно
   смонтировать `deploy/nginx/bootstrap-http.conf.template` вместо
   TLS-шаблона и запустить Nginx на порту 80. Выпустить сертификат Let's
   Encrypt через certbot webroot. После появления файлов
   `/etc/letsencrypt/live/<домен>/fullchain.pem` и `privkey.pem` вернуть
   `deploy/nginx/templates/default.conf.template` и запустить весь контур:

   ```bash
   docker compose --env-file .env.production -f deploy/docker-compose.production.yml up -d
   ```

   При первом `up` создаётся том фото `uploads` (см. «Фото товаров»). Входить
   в админку до перехода на HTTPS не нужно.

6. **Сброс кэша страниц — обязательно после каждого `up -d`.** Образ собран
   без базы, и до сброса страницы показывают контакты и доставку из сборки и
   пустой каталог (раздел «Сброс кэша страниц после запуска»). Дождаться, когда
   приложение отвечает и база доступна, и выполнить задание:

   ```bash
   until docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T app \
     node -e 'fetch("http://127.0.0.1:3000/api/health").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))'
   do sleep 3; done
   sh deploy/scripts/run-internal-job.sh site-revalidation
   ```

   Успех — без вывода.

7. **Вход в админку.** Открыть `https://<домен>/admin`, ввести email и
   6-значный код из приложения. Браузер, с которого вошли, становится
   «доверенным устройством» на 90 дней: чужие неверные попытки с вашим email
   не закрывают вход с него. Входите с личного устройства. Если телефон с
   приложением потерян, новый ключ выдаёт другой администратор в разделе
   «Сотрудники», а для последнего администратора повторяют шаг 4. Менеджеров
   и других администраторов добавляют в разделе «Сотрудники».

8. **Данные магазина.** Админка → «Настройки» (`/admin?section=settings`):
   контакты, адрес и карта, часы работы, доставка, услуги
   (`docs/SITE_SETTINGS.md`). Сохраняет только администратор; сохранение само
   сбрасывает кэш страниц. После первого сохранения витрина, документы и
   проверка заказа берут эти значения из базы. Переменные `NEXT_PUBLIC_*` с
   контактами, доставкой и услугами при этом остаются значениями сборки: их
   показывают страницы, собранные при сборке образа, до сброса кэша после
   каждой выкладки (шаг 6), и весь сайт, когда база недоступна. Поэтому в
   `.env.production` их держат такими же, как в «Настройках»; кроме того, они
   обязательны для production-сборки.

9. **Проверка фото.** Админка → «Товары» → товар → «Фотографии»: загрузить
   JPEG и открыть его на витрине. Если загрузка выключена или отвечает
   ошибкой записи — см. «Фото товаров».

10. **Задания cron** (crontab root на хосте, пути для `/opt/apex`):

    ```cron
    * * * * * flock -n /run/lock/apex-job-notifications.lock sh /opt/apex/deploy/scripts/run-internal-job.sh notifications
    * * * * * flock -n /run/lock/apex-job-reservations.lock sh /opt/apex/deploy/scripts/run-internal-job.sh reservations
    30 2 * * * docker compose --env-file /opt/apex/.env.production -f /opt/apex/deploy/docker-compose.production.yml exec -T postgres sh /scripts/backup-postgres.sh
    40 2 * * * sh /opt/apex/deploy/scripts/backup-uploads.sh
    @reboot sleep 120 && sh /opt/apex/deploy/scripts/run-internal-job.sh site-revalidation
    ```

    Подробности — «Фоновые уведомления», «Освобождение резервов»,
    «Резервные копии», «Сброс кэша страниц после запуска».

11. **Проверки:** `https://<домен>/api/health`, каталог, страница
    `/contacts` (данные из «Настроек»), тестовый заказ и
    `docker compose … logs app | grep '\[config\]'` (пустой вывод — проблем
    нет, см. «Проверка конфигурации при старте»).

## Обновление

```bash
# 1. Резервные копии базы и фото до изменений
docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T postgres sh /scripts/backup-postgres.sh
sh deploy/scripts/backup-uploads.sh
# 2. Код и образы
git pull --ff-only
docker compose --env-file .env.production -f deploy/docker-compose.production.yml build app
docker compose --env-file .env.production -f deploy/docker-compose.production.yml pull nginx
# 3. Новые миграции (уже применённые пропускаются)
docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm migrate
# 4. Проверка шаблона nginx и перезапуск
docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm --no-deps nginx nginx -t
docker compose --env-file .env.production -f deploy/docker-compose.production.yml up -d app nginx
docker compose --env-file .env.production -f deploy/docker-compose.production.yml restart nginx
# 5. Сброс кэша страниц, когда приложение ответило (обязательно)
until docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T app \
  node -e 'fetch("http://127.0.0.1:3000/api/health").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))'
do sleep 3; done
sh deploy/scripts/run-internal-job.sh site-revalidation
```

Шаг 5 обязателен при каждом обновлении: без него страницы показывают контакты
и доставку из сборки и пустой каталог (до 5 минут после сборки образа, а если
образ собран раньше — первому посетителю каждой страницы; раздел
«Сброс кэша страниц после запуска»). После выкладки проверяются
`/api/health`, каталог, страница `/contacts`, вход в админку, загрузка фото,
создание тестового заказа и журналы контейнеров.

**Первое обновление до версии с томом фото.** Скрипта `backup-uploads.sh`
до `git pull` ещё нет — копию фото на этом обновлении пропустить (до него
загрузка фото на VDS была выключена, копировать нечего). `up -d app`
пересоздаёт контейнер с томом `uploads` и `UPLOADS_DIR=/app/uploads`;
проверить права — раздел «Фото товаров». С этой же версии `migrate` и запуск
сайта не вызывают pnpm (см. «Команды без pnpm»): команды вида
`run --rm migrate pnpm …` и `run --rm app pnpm …` в заметках и cron нужно
заменить, и добавить в cron копию фото (раздел «Резервные копии»).

`migrate` запускает образ, собранный для `app` (`apex-wheels-app:latest`),
поэтому `build app` выполняется до миграций. Командой `up` сервис не
запускается (профиль `tools`).

`pull nginx` подтягивает исправления стабильной ветки nginx (тег `1.30-alpine`).
Шаблон `deploy/nginx/templates/default.conf.template` подставляется в конфигурацию
только при старте контейнера, а `up -d` не перезапускает nginx, если изменился
лишь шаблон, — поэтому после `git pull` нужен `restart nginx`. Команда
`run --rm --no-deps nginx nginx -t` заранее проверяет новый шаблон с текущими
переменными и сертификатом, не трогая работающий nginx (контейнер `app` должен
быть запущен: имя `app` разрешается при проверке). Если проверка не прошла,
`restart` не выполнять.

## Сброс кэша страниц после запуска

Образ собирается без базы данных. Страницы, которые Next.js строит при сборке
и затем обновляет раз в 5 минут (ISR: общий макет с шапкой и подвалом,
главная, каталоги шин и дисков, контакты), поэтому содержат
значения сборки: контакты, адрес, часы, доставку и услуги из `NEXT_PUBLIC_*`
в `.env.production` и пустой начальный каталог. Новый контейнер отдаёт их, пока
страница не перестроится. Интервал Next.js отсчитывает от времени сборки
(время изменения файлов страниц), а не от старта: если образ собран меньше 5
минут назад, значения сборки видны до истечения этих 5 минут; если раньше —
их получает первый посетитель каждой страницы, пока в фоне строится новая
версия. Задание
`site-revalidation` сбрасывает кэш всех страниц сразу: следующие запросы
строят их из базы (сохранённые «Настройки», текущий каталог).

Обязательно выполнять после каждого `up -d`, который создаёт контейнер `app`
заново (первый запуск — шаг 6, каждое обновление — шаг 5): новый контейнер
начинает со страниц сборки. Каталог `.next` в образе принадлежит пользователю
приложения (D25), поэтому перестроенные страницы сохраняются в файловой системе
контейнера: после `docker compose … restart app` и перезагрузки сервера тот же
контейнер продолжает отдавать уже обновлённые страницы, и сброс там не нужен
(но и не вредит).

```bash
# ждать, пока /api/health не ответит 200 (приложение запущено, база доступна)
until docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T app \
  node -e 'fetch("http://127.0.0.1:3000/api/health").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))'
do sleep 3; done
sh deploy/scripts/run-internal-job.sh site-revalidation
```

Скрипт выполняет запрос внутри контейнера `app` с ключом из
`INTERNAL_JOB_SECRET` (как задания cron) и при успехе ничего не печатает.
`HTTP 401` — `INTERNAL_JOB_SECRET` не задан или не совпадает; `HTTP 404` — в
запущенном образе ещё нет этого задания (образ не пересобран). Если цикл
ожидания не заканчивается за минуту, прервать его (Ctrl+C) и смотреть
`docker compose … logs app`: чаще всего недоступна база (`/api/health`
отвечает 503).

Строка cron
`@reboot sleep 120 && sh /opt/apex/deploy/scripts/run-internal-job.sh site-revalidation`
(«Первый запуск», шаг 10) — страховка: после перезагрузки сервера она
обновляет страницы из базы (например, если настройки меняли вручную в SQL).
120 секунд — запас на старт Docker и приложения; при неудаче cron пришлёт
ошибку, а страницы обновятся сами по интервалу.

Отсюда правило для `.env.production`: контакты, адрес, часы, доставку и
услуги в `NEXT_PUBLIC_*` держат такими же, как в «Настройках». Их видно до
сброса кэша и при недоступной базе, и они обязательны для production-сборки.
Изменение этих переменных действует только после `build app`, `up -d app` и
сброса кэша.

## Команды без pnpm

В образе приложения pnpm нет. `deploy/Dockerfile` включает только shim
corepack, который скачивает pnpm из `registry.npmjs.org` при первом вызове, а
сервис `migrate` работает в сети `backend` без выхода в интернет: `pnpm …`
там завершается ошибкой `Error when performing the request to
https://registry.npmjs.org/pnpm/…`. Поэтому compose-файл и эта инструкция
вызывают те же программы, что скрипты `package.json`, напрямую из
`node_modules/.bin` образа:

| Скрипт `package.json` | Команда в контейнере |
| --- | --- |
| `pnpm db:migrate` | `node_modules/.bin/tsx server/database/run-migrations.ts` (команда сервиса `migrate`) |
| `pnpm admin:create -- …` | `node_modules/.bin/tsx server/tools/create-staff.ts …` (через `run --rm migrate`) |
| `pnpm import:csv …` | `node_modules/.bin/tsx server/imports/run-csv-import.ts products /tmp/import.csv` (через `run --rm -v <файл>:/tmp/import.csv:ro app`, см. ниже) |
| `pnpm exec next start` | `node_modules/.bin/next start` (`CMD` образа) |

Сайт тоже запускается без pnpm, поэтому старт контейнера не зависит от
доступности registry.npmjs.org. Миграциям, созданию сотрудника и запуску
сайта файлы хоста не нужны; импорту CSV — нужны.

**Импорт CSV из командной строки.** Файлы хоста в контейнер `app` не
смонтированы, поэтому файл подключают на время команды только для чтения и
передают путь внутри контейнера:

```bash
chmod 644 /root/imports/products.csv
docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm \
  -v /root/imports/products.csv:/tmp/import.csv:ro app \
  node_modules/.bin/tsx server/imports/run-csv-import.ts products /tmp/import.csv
sh deploy/scripts/run-internal-job.sh catalog-revalidation
```

Слева от `:` — абсолютный путь к файлу на хосте. Файл должен читаться
пользователем приложения (uid 10001), отсюда `chmod 644`; права каталогов
над ним на хосте значения не имеют. Тип — `products` или `fitments`, режим по
умолчанию `incremental`; `full` — только с четвёртым аргументом
`--confirm-full` (форматы файлов — `docs/CSV_IMPORTS.md`). Процесс импорта
работает от роли приложения и кэш страниц сбросить не может — это делает
задание `catalog-revalidation` (последняя строка). Импорт через админку
этого не требует.

## Роли PostgreSQL

Работающее приложение подключается к PostgreSQL отдельной ролью
`POSTGRES_APP_USER` (по умолчанию `apex_app`). Владелец схемы `POSTGRES_USER`,
которого образ `postgres` создаёт суперпользователем, используется только для
миграций (`run --rm migrate`) и резервных копий. Его пароль в окружение
контейнера `app` не передаётся.

Права роли приложения:
- `SELECT`, `INSERT`, `UPDATE`, `DELETE` на таблицы;
- `USAGE` и `SELECT` на последовательности;
- `EXECUTE` на функции.

Ей запрещено:
- DDL: нельзя создавать таблицы, в том числе временные, создавать схемы и
  расширения, менять и удалять таблицы;
- `TRUNCATE`, `setval`, `COPY ... PROGRAM`, чтение файлов сервера;
- доступ к журналу миграций `schema_migrations`;
- атрибуты `SUPERUSER`, `CREATEDB` и `CREATEROLE`.

Права по умолчанию (`ALTER DEFAULT PRIVILEGES`) дают те же права на таблицы,
последовательности и функции, которые создадут будущие миграции владельца.
Подробности — в `docs/DATABASE.md`.

Роль создаёт и настраивает `deploy/postgres/init/10-app-role.sql`. Имя и пароль
скрипт берёт из `POSTGRES_APP_USER` и `POSTGRES_APP_PASSWORD` окружения
контейнера `postgres`. Скрипт идемпотентен: повторный запуск задаёт пароль
заново и отбирает лишние права.
- На пустом томе образ запускает его сам при первом старте (каталог смонтирован
  в `/docker-entrypoint-initdb.d`).
- На существующей базе он запускается командой из следующего раздела.

Без `POSTGRES_APP_PASSWORD` Docker Compose не выполняет ни одну команду с этим
файлом, включая задания cron и резервную копию: `required variable
POSTGRES_APP_PASSWORD is missing a value`.

### Переход на отдельную роль на работающем сервере

Выполняется один раз, в окно обслуживания. На шагах 4–7 сайт несколько секунд
отвечает 503.

1. Сделать резервную копию:
   `docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T postgres sh /scripts/backup-postgres.sh`.
2. До `git pull` добавить в `.env.production`:
   `POSTGRES_APP_USER=apex_app` и `POSTGRES_APP_PASSWORD=<openssl rand -hex 32>`.
   Без этой переменной новый compose-файл не запустит ни одну команду.
3. `git pull --ff-only`, затем
   `docker compose --env-file .env.production -f deploy/docker-compose.production.yml build app`.
4. Пересоздать контейнер PostgreSQL с новыми переменными и каталогом init:
   `docker compose --env-file .env.production -f deploy/docker-compose.production.yml up -d postgres`.
   Том с данными сохраняется. Скрипты init на непустом томе не запускаются.
5. Создать роль и выдать права:

   ```bash
   docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T postgres \
     sh -c 'psql -v ON_ERROR_STOP=1 --no-psqlrc -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/10-app-role.sql'
   ```

   Ожидаемая последняя строка: «Роль приложения apex_app готова: только чтение
   и изменение данных, без DDL». Пароль и имя берутся из окружения контейнера;
   в командной строке и истории shell их нет.
6. Применить миграции владельцем:
   `docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm migrate`.
7. Перезапустить приложение уже от роли приложения:
   `docker compose --env-file .env.production -f deploy/docker-compose.production.yml up -d app nginx`.
8. Открыть любую страницу каталога (простаивающие соединения закрываются через
   30 с) и проверить, от какой роли работает приложение. Ожидается только
   `apex_app`:

   ```bash
   docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T postgres \
     sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT usename, count(*) FROM pg_stat_activity WHERE application_name = '"'"'apex-wheels-backend'"'"' GROUP BY 1"'
   ```

   Затем проверить `/api/health`, каталог, вход, корзину, тестовый заказ,
   импорт CSV в админке и `docker compose ... logs app`.

Откат: временно указать в `.env.production` в `POSTGRES_APP_USER` и
`POSTGRES_APP_PASSWORD` значения `POSTGRES_USER` и `POSTGRES_PASSWORD`, затем
выполнить `up -d app`. Приложение снова подключится владельцем; роль
`apex_app` при этом не мешает. Повторный запуск скрипта роли с такими
значениями остановится с ошибкой, так и задумано.

Смена пароля роли приложения: изменить `POSTGRES_APP_PASSWORD`, выполнить
`up -d postgres`, команду шага 5 и `up -d app`.

CLI-импорт на сервере (`docker compose ... run --rm -v <файл>:/tmp/import.csv:ro app
node_modules/.bin/tsx server/imports/run-csv-import.ts ...`, полная команда — в
«Команды без pnpm») работает от роли приложения: ему нужны только данные.

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

## Фото товаров (том `uploads`)

Фото, загруженные в админке (`docs/ADMIN_CATALOG.md`, «Фото»), хранятся в
именованном томе `uploads`, смонтированном в контейнер `app` в `/app/uploads`.
`UPLOADS_DIR=/app/uploads` задаёт сам compose-файл; в `.env.production` эту
переменную задавать не нужно (значение оттуда не используется). Том
переживает пересборку образа, `up -d` и перезагрузку сервера. Имя тома в
Docker — `<проект>_uploads`, по умолчанию `deploy_uploads` (как и
`deploy_postgres_data`), см. `docker volume ls`.

**Права.** Приложение работает от пользователя `apex` (uid 10001). Каталог
`/app/uploads` в образе принадлежит ему (режим 0750), и новый пустой том при
первом подключении получает того же владельца — на хосте ничего делать не
нужно. Проверка:

```bash
docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec app \
  sh -c 'stat -c "%u %a" /app/uploads && touch /app/uploads/.write-test && rm /app/uploads/.write-test && echo writable'
```

Ожидается `10001 750` и `writable`. Если владелец другой (том создан раньше
вручную или другим образом), исправить один раз:

```bash
docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm --no-deps --user root app \
  chown -R 10001:10001 /app/uploads
```

**Лимиты** — необязательные переменные `.env.production` (после изменения —
`up -d app`):

| Переменная | Значение |
| --- | --- |
| `PRODUCT_IMAGE_MAX_BYTES` | размер одного фото в байтах, 100000–20000000; пусто — 5242880 (5 МБ) |
| `PRODUCT_IMAGE_MAX_COUNT` | фото у одного товара, 1–30; пусто — 10 |

Неверное значение не останавливает сайт: выключается только загрузка новых
фото, а админка показывает, какая переменная задана неверно.

Nginx пропускает к загрузке фото (`POST /api/admin/products/<id>/images`)
тело до 8 МБ (`client_max_body_size 8m` в отдельном `location`), приложение
принимает фото до `PRODUCT_IMAGE_MAX_BYTES` плюс до 64 КБ на поля формы.
Значит, `8m` хватает для `PRODUCT_IMAGE_MAX_BYTES` до 8323072 байт (~7,9 МБ).
Для большего значения в `deploy/nginx/templates/default.conf.template` в этом
`location` указать не меньше `PRODUCT_IMAGE_MAX_BYTES` + 64 КБ, округлив вверх
до целых мегабайт (10000000 → `10m`, максимум 20000000 → `20m`), затем
`nginx -t` и `restart nginx` (раздел «Обновление»). Лимиты остальных адресов
от этого не меняются (см. «Nginx: правила перед приложением»).

**Раздача.** `/uploads/products/<id>/<файл>` отдаёт приложение через общий
`location /` nginx: маршрут принимает только имена ровно того вида, который
создаёт сайт, и отдаёт фиксированный `Content-Type`, `nosniff`, CSP
`default-src 'none'; sandbox` и кэш на год (`immutable`). Раздавать том
напрямую из nginx без всех этих ограничений нельзя.

**Осторожно:** `docker compose … down -v` и `docker volume rm` безвозвратно
удаляют том с фото (и том с базой). Для остановки — `down` без `-v`.

## Резервные копии

| Что | Скрипт | Файл | Хранится |
| --- | --- | --- | --- |
| База PostgreSQL | `deploy/scripts/backup-postgres.sh` в контейнере `postgres`: `pg_dump` владельцем схемы, формат custom для `pg_restore` | `deploy/backups/<POSTGRES_DB>_<время UTC>.dump` | 14 дней |
| Фото товаров (том `uploads`) | `deploy/scripts/backup-uploads.sh` на хосте: `tar` внутри контейнера `app`, архив проверяется `gzip -t` | `deploy/backups/uploads_<время UTC>.tar.gz` | 14 дней |

Скрипты удаляют свои локальные копии старше срока `BACKUP_RETENTION_DAYS`.
Файлы доступны только root (режим 0600): в дампе персональные данные
покупателей; поэтому и команды восстановления ниже выполняются от root
(`sudo -i`), иначе перенаправление `< файл` не прочитает архив. Каталог
`deploy/backups` исключён из Git (`deploy/.gitignore`).
Минимум одна дополнительная зашифрованная копия **обоих** наборов должна
уходить на независимое российское object storage, туда же — зашифрованная
копия `.env.production`: без того же `OTP_CODE_PEPPER` ключи входа
сотрудников из восстановленной базы не расшифровать, придётся выпускать
новые. Восстановление необходимо регулярно проверять (ниже — проверка без
остановки сайта).

Cron (crontab root, ежедневно; сначала база, затем фото):

```cron
30 2 * * * docker compose --env-file /opt/apex/.env.production -f /opt/apex/deploy/docker-compose.production.yml exec -T postgres sh /scripts/backup-postgres.sh
40 2 * * * sh /opt/apex/deploy/scripts/backup-uploads.sh
```

Порядок «база, затем фото»: все фото, на которые ссылается дамп, попадают в
более поздний архив; фото, загруженные между копиями, лежат в архиве лишними
и не мешают. Скрипты запускаются через `sh`: в Git они хранятся без права на
исполнение, и прямой вызов завершился бы ошибкой `permission denied`. Пароли
в crontab не указываются: `backup-postgres.sh` смонтирован в контейнер
PostgreSQL только для чтения и берёт их из его окружения.

`backup-uploads.sh` работает при запущенном контейнере `app` (`tar` выполняется
внутри него от пользователя приложения и только читает том), ищет
`.env.production` в корне репозитория (другой путь — `APEX_ENV_FILE`); каталог
копий меняется переменной `UPLOADS_BACKUP_DIRECTORY`, срок —
`BACKUP_RETENTION_DAYS`, например
`40 2 * * * BACKUP_RETENTION_DAYS=7 sh /opt/apex/deploy/scripts/backup-uploads.sh`.
Срок копий базы меняется так же, но в окружении контейнера:
`… exec -T -e BACKUP_RETENTION_DAYS=30 postgres sh /scripts/backup-postgres.sh`.
При ошибке скрипты печатают её и завершаются с ненулевым кодом (cron пришлёт
письмо, если задан `MAILTO`). Оба скрипта пишут сначала во временный файл
`<имя>.partial` и переименовывают его в `.dump` или `.tar.gz` только после
успешного завершения; при ошибке и при прерывании (TERM, INT, HUP) временный
файл удаляется. Поэтому оборванная копия не выглядит как настоящая и не
вытесняет старые при подсчёте срока хранения; старые копии удаляются только
после успешной новой.

Архив фото каждый раз полный, а фото уже сжаты, поэтому 14 архивов занимают
около 14 объёмов тома. Объём тома —
`docker compose … exec app du -sh /app/uploads`; при нехватке места на диске
уменьшить срок хранения архивов фото.

### Проверка восстановления базы (сайт работает)

Копия восстанавливается во временную базу рядом с рабочей, затем она
удаляется. `<файл>` — имя из `deploy/backups` (в контейнере это `/backups`):

```bash
docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T postgres \
  sh -c 'createdb -U "$POSTGRES_USER" apex_restore_check'
docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d apex_restore_check --no-owner --exit-on-error --single-transaction /backups/<файл>.dump'
docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d apex_restore_check -Atc "SELECT (SELECT count(*) FROM schema_migrations), (SELECT count(*) FROM products), (SELECT count(*) FROM orders)"'
docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T postgres \
  sh -c 'dropdb -U "$POSTGRES_USER" apex_restore_check'
```

`pg_restore` должен завершиться без вывода; числа — применённые миграции
(12 для 001–013), товары и заказы на момент копии.

### Восстановление базы (замена рабочей)

Выполняется в окно обслуживания, сайт на это время отвечает 502. Те же шаги
восстанавливают копию на новом сервере (после шагов 1–2 «Первого запуска», с
прежним `.env.production`).

1. Если рабочая база доступна — сделать копию текущего состояния, чтобы можно
   было вернуться (команда из cron выше).
2. Остановить приложение (задания cron в это время завершаются ошибкой — это
   ожидаемо):
   `docker compose --env-file .env.production -f deploy/docker-compose.production.yml stop app`.
3. Пересоздать пустую базу. **Удаляет все текущие данные базы.** На новом
   сервере шаг тоже нужен: скрипт роли уже создал в новой базе
   `schema_migrations`, и `pg_restore` остановился бы на ней.

   ```bash
   docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T postgres \
     sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
   ```

4. Восстановить копию одной транзакцией (при ошибке база остаётся пустой, а
   не заполненной наполовину):

   ```bash
   docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T postgres \
     sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error --single-transaction /backups/<файл>.dump'
   ```

   Копия содержит права роли приложения, поэтому роль `apex_app` должна уже
   существовать (её создаёт первый старт PostgreSQL на пустом томе). Если её
   нет, `pg_restore` остановится на `GRANT`: выполнить команду шага 5 из
   «Перехода на отдельную роль» и повторить шаги 3–4.
5. Права роли приложения и закрытый от неё журнал миграций — команда шага 5
   из раздела «Переход на отдельную роль на работающем сервере».
6. Применить миграции новее копии:
   `docker compose --env-file .env.production -f deploy/docker-compose.production.yml run --rm migrate`.
7. `docker compose … up -d app`, затем `docker compose … restart nginx` и
   сброс кэша страниц (раздел «Сброс кэша страниц после запуска»); проверить
   `/api/health`, вход в админку и каталог.

### Восстановление фото

```bash
docker compose --env-file .env.production -f deploy/docker-compose.production.yml up -d app
docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec -T app \
  tar -C /app/uploads -xzf - < deploy/backups/uploads_<время>.tar.gz
docker compose --env-file .env.production -f deploy/docker-compose.production.yml exec app \
  sh -c 'find /app/uploads -type f | wc -l'
```

Архив распаковывается от пользователя приложения, файлы получают его
владельца. Файлы с теми же именами заменяются (имена случайные и не
повторяются), остальные остаются на месте. Берите архив той же ночи, что и
дамп базы (он сделан после дампа). Файл без записи в базе на сайте не виден и
не мешает; запись без файла даёт 404 вместо фото — такое фото загружают
заново.

## Фоновые уведомления

Заказы и заявки атомарно создают записи в `notification_outbox`. Каждую минуту cron вызывает защищённый `POST /api/internal/jobs/notifications` с заголовком `X-Job-Key`. Значение заголовка берётся из `INTERNAL_JOB_SECRET`; его нельзя помещать в команду, попадающую в общий журнал или историю shell. Если Postbox временно недоступен, уведомление остаётся в очереди и получает отложенную повторную попытку.

Пока Postbox не настроен (не заданы `YANDEX_POSTBOX_*`), задание отвечает
`200` с `"ok": true`, `"providerConfigured": false`, числом уведомлений в
очереди (`queued`) и сообщением «Провайдер уведомлений не настроен, уведомления
остаются в очереди». Очередь не трогается: записи не помечаются ошибочными и не
теряются, а после настройки Postbox уходят при следующем запуске задания. Cron
в это время не получает ошибок. С настроенным Postbox поведение прежнее: если
часть писем не ушла, ответ — `"ok": false`, скрипт печатает счётчики и
завершается с кодом 1.

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

**Размер тела запроса.** Больший запрос nginx отклоняет кодом `413` (с
заголовками безопасности), не передавая приложению:

| Адрес | `client_max_body_size` |
| --- | --- |
| `POST /api/admin/products/<id>/images` — загрузка фото (отдельный `location` с регулярным выражением) | `8m` |
| `/api/admin/imports/` — импорт CSV (потоковая передача) | `200m` |
| все остальные адреса | `6m` (уровень `server`) |

Как менять лимит фото вместе с `PRODUCT_IMAGE_MAX_BYTES` — раздел «Фото
товаров».

**Необязательный allowlist для сотрудников (выключен).** По решению D21
`/admin` доступен из любой сети: вход — по коду из приложения-аутентификатора,
а «доверенные устройства» не дают постороннему заблокировать вход сотрудника.
Если владелец решит пускать в админку только с адресов магазина, в шаблоне
есть заготовка: блоки `geo` и `map` в начале файла и
`if ($apex_staff_ip_denied)` в TLS-сервере закомментированы (строки кода
начинаются с `#` без пробела). Включение: убрать `#` у этих строк, вместо
примеров `203.0.113.10` и `198.51.100.0/24` указать адреса магазина (здесь
допустимы и точные адреса, и диапазоны CIDR), затем `nginx -t` и
`restart nginx`. С других адресов `/admin`, `/api/admin/` (включая импорт и
загрузку фото) и `/api/auth/staff/` получат `403` от nginx; проверяется
нормализованный путь, поэтому `/%61dmin` и `//admin` тоже закрыты. Витрина,
вход покупателей, `/uploads`, 1С и фоновые задания не затрагиваются. Перед
включением убедиться, что адреса статические, а сотрудникам из других сетей
есть VPN: иначе вход закроется для всех, и откатывать придётся по SSH. Адрес
шлюза Docker-сети (`172.x.0.1`) не указывать (см. «IP клиента», IPv6).
Шаблон хранится в Git: правку лучше внести в репозиторий, иначе локальное
изменение на сервере может помешать `git pull --ff-only`.

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

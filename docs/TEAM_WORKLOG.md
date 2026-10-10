# Реестр задач и решений: аудит, дизайн, изображения шин

Запрос заказчика (10.10.2026): провести аудит сайта, предложить более
узнаваемый дизайн, создать изображения для каждого наименования шины.

Исходное состояние: ветка `claude/magical-cray-rc1s4m` = `main` (`ab725a7`);
`lint`, `typecheck`, 28/28 тестов — без ошибок.

## Решения

| ID | Решение | Причина |
|---|---|---|
| D1 | Дизайн выдаётся как предложение: спецификация + статический прототип в `docs/design-proposal/`. Код витрины под новый дизайн не переводится до согласования. | В запросе «предложить»; на прошлом этапе дизайн сознательно не менялся. |
| D2 | Изображения шин — детерминированные SVG-иллюстрации, генерируемые из атрибутов товара (бренд, модель, сезон, шипы, размер). Показываются, только если у товара нет фото; фото из 1С/CSV имеет приоритет. Помечаются как иллюстрация. | Генератора фотографий в среде нет; выдавать рисунок за фото товара нельзя; решение должно работать и для товаров из PostgreSQL. |
| D3 | Аудиторы работают только на чтение. Исправления вносят владельцы файлов после разбора; в этой итерации — Critical/High и недорогие Medium. | Независимость проверки, отсутствие конфликтов в файлах. |
| D4 | Изображения дисков вне объёма задачи. | В запросе только шины. |
| D5 | Новые npm-зависимости не добавляются. Playwright/Chromium берутся из среды для проверок. | Без изменения стека. |
| D10 | 500 на битом %-кодировании пути (`/tires/%E0%A4%A`) не исправляется в приложении: ошибка в роутере Next.js до нашего кода; правило nginx от T8d проверено только регуляркой — оставлено рекомендацией до проверки на staging. | Непроверенный конфиг nginx может остановить сайт; эффект — только шум в логах. |
| D11 | Сообщение о нехватке остатка показывает точное количество только в режиме показа `exact`; в остальных режимах — без числа. | Не раскрывать остатки, которые владелец решил скрывать. |
| D6 | Из находок T1 в рекомендации (не исправляем сейчас): CAPTCHA (нужны внешний сервис и ключи), срок резерва и письма на неподтверждённый email (решение владельца), SEC-09/10/11/13/15/16. | Внешние сервисы и бизнес-правила — решение заказчика; Low — вне D3. |
| D7 | Одновременно работают 4 исполнителя (T4, T5a, T5c, T5d): наборы файлов не пересекаются, ресурсов достаточно (4 CPU, 14 ГБ RAM). | Исключение из лимита 3 по правилу «независимые задачи и достаточные ресурсы». |
| D8 | Падежные формы города (`cityPrepositional`, `cityDative`) добавлены руководителем в `config/business.ts` до старта T5c/T5d — общий контракт. | Один владелец общего конфига. |
| D9 | Иллюстрации шин остаются data URI в `<img>`: 8 SVG ≈ 13 КБ в gzip, при серверном рендеринге 24 карточек ≈ 40 КБ gzip. | Отдельный маршрут изображений пока не оправдан. |

## Задачи

Статусы: запланировано → готово к работе → в работе → на проверке → принято;
заблокировано — с причиной.

| ID | Задача | Исполнитель | Разрешённые файлы | Статус |
|---|---|---|---|---|
| T1 | Аудит безопасности и серверной логики | агент «security-audit» | только чтение; отчёт в рабочую папку руководителя | принято: 1 High, 5 Medium, 10 Low, 6 Info; Critical нет; SEC-01 и SEC-08 подтверждены руководителем по коду |
| T2 | Аудит фронтенда: SEO, доступность, производительность, UX | агент «frontend-audit» | только чтение (отдельный git worktree) | принято: 1 Critical (SEO-01), 12 High, 24 Medium, 12 Low; SEO-04 и UX-02 подтверждены руководителем по коду |
| T3 | Генератор иллюстраций шин и подключение в витрине | агент «tire-images» | `lib/tire-illustration.ts`, `components/tire-illustration.tsx`, функция `ProductArt` в `components/storefront.tsx`, блок `.product-art`/`.tire-illustration` в `app/globals.css`, `components/product-details-page.tsx`, `server/tests/tire-illustration.test.ts`, `server/tools/export-tire-illustrations.ts`, одна строка `images:tires` в `package.json` | принято: commit 3a6ba90; руководитель проверил отдельно от чужих правок — lint, tsc, 37/37 тестов, production build; контактный лист просмотрен |
| T4 | Концепция узнаваемого дизайна + прототип | агент «design» | `docs/design-proposal/**` | принято: commit 66e1d6b; ждёт согласования заказчиком (D1) |
| T5a | Исправления безопасности (сервер): SEC-01 лимиты заказов и резервов, SEC-02 лимит OTP на адресата, SEC-03 IP клиента, SEC-04 постоянный rate limiter (миграция 007), SEC-05 заголовки, SEC-07 Origin, SEC-08 лимит тела, SEC-14 URL изображений, SEC-12 при наличии времени | агент «backend» | `server/**` (кроме файлов T3), `app/api/**`, `deploy/**`, `next.config.ts`, `public/_headers`, `.env.example`, vars в `wrangler.jsonc`, профильные docs | принято: commit 673258d; SEC-01/02/03/04/05/07/08/14 исправлены, SEC-12 частично; руководитель проверил отдельно от чужих правок — lint, tsc, 72/72 тестов, production build; агент: интеграция на PostgreSQL 16 — 40/40 |
| T5b | SEC-06: обновить next и eslint-config-next до 16.3.8 (выпуск 2026-09-30, исправляет advisory) | руководитель | `package.json`, `pnpm-lock.yaml` | принято: commit 6647b32; интеграция на общем коде — lint, tsc, 90/90, `pnpm build`, `pnpm build:worker`, локальный запуск воркера (wrangler dev): заголовки, noindex, `node:net` в воркере работает; остаточные advisory `sharp`, `source-map-js` — не достижимы извне (см. SITE_AUDIT) |
| T5c | Витрина: SEO-01 серверная первая страница каталога, SEO-02/03/04, A11Y-01…06, PERF-01, UX-01/02/03/10, SEC-15 | агент «storefront» | `components/storefront.tsx`, `store-provider.tsx`, `checkout-form.tsx`, `fitment-request-form.tsx`, `privacy-tools.tsx`, `lib/cookie-consent.ts`, `app/page.tsx`, `app/shiny`, `app/diski`, `app/globals.css`, `public/assets/**`, `lib/api/**` | принято: commit 6e0a274; руководитель проверил на HEAD с T5d — lint, tsc, 90/90, production build; агент: LCP 11,1 → 2,7 с, режим database на PostgreSQL 16, 61 клавиатурная проверка |
| T5d | SEO-страницы: страница товара + JSON-LD, Organization, canonical, robots preview, 404, noindex админки, контакты | агент «seo-pages» | `app/layout.tsx`, `app/robots.ts`, `app/sitemap*`, `app/contacts`, `app/legal`, `app/tires`, `app/wheels`, `app/not-found.*`, metadata `app/admin/page.tsx`, `components/product-details-page.*`, `product-purchase.tsx`, `lib/structured-data.ts` | принято: commit 586d587; руководитель проверил отдельно от чужих правок — lint, tsc, 90/90 тестов, production build; агент: режим database на PostgreSQL 16 |
| T5e | Доработки владельца по сообщениям T5a/T5d: X-Robots-Tag на preview, sitemap (юр. документы, только товары с ценой), текст ошибки Postbox, ссылка 2ГИС, пример CSV, документация URL фото | руководитель | `next.config.ts`, `public/_headers`, `server/services/sitemap-service.ts`, `app/sitemap.xml/route.ts`, `lib/auth/delivery.ts`, `config/business.ts`, `docs/PRODUCT_IMPORT.md`, `docs/examples/products-import.csv` | на проверке: commit 6785b8c; lint, tsc, 90/90; проверит T6 |
| T6 | Независимая QA-проверка T3/T5 и интеграции на HEAD 6647b32 | агент «qa» | только чтение; скрипты и отчёт вне репозитория | выполнено: 3 Major, 6 Minor, 4 Trivial; сквозные сценарии database/preview, безопасность и доступность — без регрессий, кроме найденного |
| T8c | Дефекты QA витрины: QA-01 (гонка загрузки корзины), QA-02 (PUT корзины при каждом просмотре + лимит), QA-04 (текст), QA-06 (`/legal` на 320), QA-07 (ограничение «+»), QA-09 (lazy фото), QA-10 (битое фото) | агент «storefront» | `components/store-provider.tsx`, `components/storefront.tsx`, `app/globals.css` | принято: commit 447bc72 (+ 97aefa1 руководитель: `product-purchase.tsx` ждёт результат сохранения); lint, tsc, 116/116, build |
| T8a | Дефекты QA сервера: QA-03 (Метрика не включается на VDS — `getCloudflareContext`/workerd), QA-04 (нет OTP_CODE_PEPPER), QA-07 (текст нехватки остатка, 409), QA-08 (415 в импорте), QA-13 (русские сообщения валидации) | агент «backend» | `next.config.ts`, `app/api/**`, `server/**`, `instrumentation.ts`, `.env.example`, профильные docs | принято: commit 2ac66c4; руководитель: точный остаток в сообщении только в режиме `exact` (D11), проверил QA-03 на `next start` — счётчик отдаётся, workerd нет |
| T8d | Дефекты QA страниц: QA-05 (500 вместо 404 на битых slug), QA-10 (битое фото на странице товара), QA-12 (sitemap вне диапазона) | агент «seo-pages» | `components/product-details-page.*`, `components/product-media.tsx`, `app/tires`, `app/wheels`, `app/legal/[slug]`, `app/sitemaps`, свои тесты | принято: commit 7107bd4; 500 на битом %-кодировании — в роутере Next.js, рекомендация (D10) |
| T9 | Повторная QA-проверка после T8 на HEAD 97aefa1 | агент «qa» | только чтение | в работе |
| T7 | Сводный отчёт аудита | руководитель | `docs/SITE_AUDIT.md` | черновик: commit b79356e; будет дополнен результатами T6 |

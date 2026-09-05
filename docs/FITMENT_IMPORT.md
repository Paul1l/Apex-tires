# Импорт применяемости

Шаблон: `docs/examples/fitments-import.csv`. Примерные технические строки имеют
verified=false и не участвуют в подборе. Их нельзя выдавать за проверенную базу.

`POST /api/admin/imports/fitments`, серверная роль manager/admin, UTF-8 text/csv.
Лимиты потока совпадают с товарным импортом; размер transaction задаётся
FITMENT_IMPORT_BATCH_SIZE (100–2000, default 1000).

Обязательны make, model, generation, product_type, verified. Для tire нужны
tire_width, tire_profile, tire_diameter. Для wheel нужны wheel_diameter,
wheel_width, bolt_count, pcd. При наличии добавляются dia, et_min, et_max,
year_from/year_to, modification, engine, axle и fitment_type.
axle: all/front/rear; fitment_type: factory/alternative/tuning;
source: manual/import/external_api. Проверяются диапазоны, последовательность
лет и ET. verified/verified_at/notes должны заполняться из проверенного источника.

Импорт upsert-ит марку, модель, поколение, модификацию и техническую запись.
Уникальность fitment учитывает автомобиль, ось, тип применяемости, размеры и
источник. Повтор обновляет verified/notes вместо дублирования. Изменившийся
размер считается отдельной записью; старую ошибочную применяемость необходимо
явно отозвать в БД/следующем административном этапе, импорт её не удаляет.

Ошибки отдельных записей хранятся в import_job_errors и не мешают валидным.
Журнал и error CSV находятся в том же разделе админки, что и товарный импорт.

import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { ProductDetails, ProductKind } from "@/lib/types";
import { createApplicationServices, databaseIsConfigured } from "@/server/bootstrap/application-services";
import { businessConfig } from "@/config/business";
import { formatPrice } from "@/lib/catalog-data";
import { getAvailabilityPresentation, hasValidDiscount } from "@/lib/product-presentation";
import {
  createBreadcrumbListJsonLd,
  createPageSeoMetadata,
  createProductJsonLd,
  getCatalogLabel,
  getCatalogPath,
  getProductBreadcrumbs,
  getProductPath,
  serializeJsonLd,
} from "@/lib/structured-data";
import { decodeProductRouteSlug } from "@/app/tires/route-slug";
import { BrandWordmark } from "./brand-wordmark";
import { ProductMedia } from "./product-media";
import { HeaderCartLink, ProductPurchase } from "./product-purchase";
import styles from "./product-details-page.module.css";

const loadProduct = cache(async (slug: string, kind: ProductKind) => {
  if (!databaseIsConfigured()) notFound();
  // Malformed encoding, control characters (NUL breaks the SQL query) or an
  // oversized value cannot be a stored slug: 404 without a database query.
  const decodedSlug = decodeProductRouteSlug(slug);
  if (!decodedSlug) notFound();
  const product = await createApplicationServices().catalogService.getProductBySlug(decodedSlug);
  if (!product || product.kind !== kind) notFound();
  // Canonical URLs are always built from the stored slug.
  return { product, slug: product.slug ?? decodedSlug };
});

const catalogIsPreview = businessConfig.catalog.dataMode === "preview";

const seasonLabels: Record<ProductDetails["season"], string | null> = {
  summer: "Летняя",
  winter: "Зимняя",
  "all-season": "Всесезонная",
  none: null,
};

const wheelTypeLabels: Record<NonNullable<ProductDetails["wheelType"]>, string | null> = {
  alloy: "Литой",
  steel: "Штампованный",
  other: null,
};

const conditionGradeLabels: Record<NonNullable<ProductDetails["conditionGrade"]>, string> = {
  excellent: "Отличное",
  good: "Хорошее",
  acceptable: "Удовлетворительное",
};

const decimalFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

function kindLabel(kind: ProductKind): string {
  return kind === "tire" ? "Шина" : "Диск";
}

function tireSize(product: ProductDetails): string | null {
  if (product.width > 0 && product.profile > 0 && product.diameter > 0) {
    return `${product.width}/${product.profile} R${product.diameter}`;
  }
  return null;
}

/** Load and speed index exactly as written in the subtitle ("95Y", "100/97T"). */
function tireIndexes(subtitle: string): { load: string; speed: string } | null {
  const match = /R\d{2}(?:[.,]5)?C?\s+(\d{2,3}(?:\/\d{2,3})?)\s?([JKLMNPQRSTUHVWYZ])\b/i.exec(subtitle);
  return match ? { load: match[1], speed: match[2].toUpperCase() } : null;
}

/** Rim width as written in the subtitle ("× 8.5J"). */
function rimWidth(subtitle: string): string | null {
  const match = /(\d{1,2}(?:[.,]\d{1,2})?)\s?J\b/.exec(subtitle);
  return match ? `${match[1].replace(".", ",")}J` : null;
}

/** "5x112" → "5×112"; a bare diameter from the database ("114.3") → "114,3 мм". */
function formatPcd(pcd: string): string {
  const value = pcd.trim();
  if (/^\d+(?:[.,]\d+)?$/.test(value)) return `${value.replace(".", ",")} мм`;
  return value.replace(/\s*[xх*]\s*/gi, "×");
}

interface SpecRow {
  label: string;
  value: string;
}

function productSpecs(product: ProductDetails): SpecRow[] {
  const rows: Array<SpecRow | null> = [
    { label: "Бренд", value: product.brand },
    product.model ? { label: "Модель", value: product.model } : null,
  ];

  if (product.kind === "tire") {
    const size = tireSize(product);
    const indexes = tireIndexes(product.subtitle);
    const season = seasonLabels[product.season];
    rows.push(
      size ? { label: "Типоразмер", value: size } : null,
      product.width > 0 ? { label: "Ширина профиля", value: `${product.width} мм` } : null,
      product.profile > 0 ? { label: "Высота профиля", value: `${product.profile} %` } : null,
      product.diameter > 0 ? { label: "Посадочный диаметр", value: `R${product.diameter}` } : null,
      indexes ? { label: "Индекс нагрузки", value: indexes.load } : null,
      indexes ? { label: "Индекс скорости", value: indexes.speed } : null,
      season ? { label: "Сезонность", value: season } : null,
      product.season === "winter" || product.studded
        ? { label: "Шипы", value: product.studded ? "Шипованная" : "Без шипов" }
        : null,
      { label: "Технология RunFlat", value: product.runflat ? "Да" : "Нет" },
      product.xl === undefined ? null : { label: "Усиленная (XL)", value: product.xl ? "Да" : "Нет" },
    );
  } else {
    const width = rimWidth(product.subtitle);
    const wheelType = product.wheelType ? wheelTypeLabels[product.wheelType] : null;
    rows.push(
      wheelType ? { label: "Тип диска", value: wheelType } : null,
      product.diameter > 0 ? { label: "Диаметр", value: `R${product.diameter}` } : null,
      width ? { label: "Ширина обода", value: width } : null,
      product.pcd ? { label: "PCD (разболтовка)", value: formatPcd(product.pcd) } : null,
      product.offset !== undefined ? { label: "Вылет (ET)", value: `${product.offset} мм` } : null,
      product.centerBore !== undefined
        ? { label: "Центральное отверстие (DIA)", value: `${decimalFormat.format(product.centerBore)} мм` }
        : null,
      product.color ? { label: "Цвет", value: product.color } : null,
    );
  }

  rows.push(
    product.country ? { label: "Страна производства", value: product.country } : null,
    product.manufactureYear ? { label: "Год выпуска", value: String(product.manufactureYear) } : null,
    { label: "Состояние", value: product.condition === "used" ? "Б/у" : "Новый товар" },
  );

  if (product.condition === "used") {
    rows.push(
      product.conditionGrade ? { label: "Оценка состояния", value: conditionGradeLabels[product.conditionGrade] } : null,
      product.treadDepth !== undefined
        ? { label: "Остаточная глубина протектора", value: `${decimalFormat.format(product.treadDepth)} мм` }
        : null,
      product.setQuantity ? { label: "Количество в комплекте", value: `${product.setQuantity} шт.` } : null,
      product.repairs ? { label: "Ремонты", value: product.repairs } : null,
      product.defects ? { label: "Дефекты", value: product.defects } : null,
      product.conditionComment ? { label: "Комментарий о состоянии", value: product.conditionComment } : null,
    );
  }

  rows.push({ label: "Артикул", value: product.sku });
  return rows.filter((row): row is SpecRow => row !== null);
}

function availabilityFor(product: ProductDetails) {
  return getAvailabilityPresentation(
    product,
    businessConfig.catalog.availabilityDisplayMode,
    catalogIsPreview,
  );
}

function productTitle(product: ProductDetails): string {
  const size = product.kind === "tire" ? tireSize(product) : null;
  return size && !product.name.includes(size) ? `${product.name} ${size}` : product.name;
}

export async function productMetadata(routeSlug: string, kind: ProductKind): Promise<Metadata> {
  const { product, slug } = await loadProduct(routeSlug, kind);
  const size = product.subtitle && !product.name.includes(product.subtitle) ? `, ${product.subtitle}` : "";
  const season = product.kind === "tire" ? seasonLabels[product.season]?.toLowerCase() : null;
  const summary =
    product.kind === "tire" ? ` — ${season ? `${season} шина` : "шина"}` : "";
  // Preview prices are demonstrations and never go into snippets.
  const commercial = catalogIsPreview ? "" : ` Цена ${formatPrice(product.price)}.`;
  return {
    title: productTitle(product),
    description:
      `${product.name}${size}${summary}.${commercial}` +
      ` Купить в ${businessConfig.location.cityPrepositional} — ${businessConfig.brandName}.`,
    ...createPageSeoMetadata(getProductPath(kind, slug), { image: product.image }),
  };
}

export async function ProductDetailsPage({ slug: routeSlug, kind }: { slug: string; kind: ProductKind }) {
  const { product, slug } = await loadProduct(routeSlug, kind);
  const availability = availabilityFor(product);
  const canAddToCart = availability.available && availability.availableQuantity > 0;
  const showDiscount = !catalogIsPreview && hasValidDiscount(product);
  const breadcrumbs = getProductBreadcrumbs(product, slug);
  const catalogPath = getCatalogPath(kind);
  const specs = productSpecs(product);
  const description = product.description.trim();

  const structuredData = [
    createProductJsonLd(product, slug, businessConfig),
    businessConfig.catalog.dataMode === "database"
      ? createBreadcrumbListJsonLd(breadcrumbs, businessConfig.siteUrl)
      : null,
  ].filter((item) => item !== null);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className="brand-logo" aria-label={`${businessConfig.brandName} — на главную`}>
            <span className="logo-mark"><i /><i /><i /></span>
            <BrandWordmark />
          </Link>
          <nav className={styles.nav} aria-label="Каталог">
            <Link href="/shiny">Шины</Link>
            <Link href="/diski">Диски</Link>
            <Link href="/contacts">Контакты</Link>
          </nav>
          <HeaderCartLink className={styles.cartLink} />
        </div>
      </header>

      <main className={styles.main}>
        <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
          <ol>
            {breadcrumbs.map((item, index) =>
              index === breadcrumbs.length - 1 ? (
                <li key={item.path} aria-current="page">{item.name}</li>
              ) : (
                <li key={item.path}><Link href={item.path}>{item.name}</Link></li>
              ),
            )}
          </ol>
        </nav>

        <div className={styles.hero}>
          <ProductMedia
            product={{
              kind: product.kind,
              name: product.name,
              image: product.image,
              brand: product.brand,
              model: product.model,
              season: product.season,
              studded: product.studded,
              runflat: product.runflat,
              width: product.width,
              profile: product.profile,
              diameter: product.diameter,
              xl: product.xl,
              tags: product.tags,
            }}
          />

          <section className={styles.summary} aria-labelledby="product-title">
            <p className="eyebrow">{kindLabel(kind)} · {product.brand}</p>
            <h1 id="product-title" className={styles.title}>{product.name}</h1>
            <p className={styles.subtitle}>{product.subtitle}</p>

            <div className={styles.availability}>
              <span
                className={availability.available ? styles.dot : `${styles.dot} ${styles.dotEmpty}`}
                aria-hidden="true"
              />
              {availability.label}
            </div>

            <div className={styles.price}>
              <strong>{formatPrice(product.price)}</strong>
              {showDiscount && (
                <del aria-label={`Старая цена ${formatPrice(product.oldPrice)}`}>{formatPrice(product.oldPrice)}</del>
              )}
            </div>
            {catalogIsPreview && (
              <p className={styles.note}>Демонстрационная цена — не является предложением.</p>
            )}

            <ProductPurchase product={product} canAddToCart={canAddToCart} className={styles.purchase} />
            {!canAddToCart && (
              <p className={styles.note}>
                Сейчас товар нельзя добавить в корзину. Уточните поставку в разделе{" "}
                <Link href="/contacts">«Контакты»</Link>.
              </p>
            )}
            <p className={styles.hint}>
              Параметры совместимости с автомобилем подтверждаются при обработке заказа.
            </p>
          </section>
        </div>

        <div className={styles.details}>
          <section className={styles.section} aria-labelledby="product-specs">
            <h2 id="product-specs">Характеристики</h2>
            <dl className={styles.specs}>
              {specs.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {(description || product.compatibleCars.length > 0) && (
            <div className={styles.aside}>
              {description && (
                <section className={styles.section} aria-labelledby="product-description">
                  <h2 id="product-description">Описание</h2>
                  <p className={styles.description}>{description}</p>
                </section>
              )}
              {product.compatibleCars.length > 0 && (
                <section className={styles.section} aria-labelledby="product-cars">
                  <h2 id="product-cars">Подходит для автомобилей</h2>
                  <ul className={styles.cars}>
                    {product.compatibleCars.map((car) => <li key={car}>{car}</li>)}
                  </ul>
                  <p className={styles.note}>Применимость уточняйте по параметрам вашего автомобиля.</p>
                </section>
              )}
            </div>
          )}
        </div>

        <Link className={styles.back} href={catalogPath}>
          ← Все {getCatalogLabel(kind).toLowerCase()} в каталоге
        </Link>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>{businessConfig.brandName} · шины и диски в {businessConfig.location.cityPrepositional}</span>
          <nav aria-label="Информация для покупателей">
            <Link href="/legal/delivery-payment-returns">Доставка и оплата</Link>
            <Link href="/legal/offer">Публичная оферта</Link>
            <Link href="/legal/requisites">Реквизиты</Link>
            <Link href="/contacts">Контакты</Link>
          </nav>
        </div>
      </footer>

      {structuredData.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
        />
      )}
    </div>
  );
}

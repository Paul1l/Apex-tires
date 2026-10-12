"use client";

import { ArrowLeft, ChevronRight, ExternalLink, PackageCheck, Save, Warehouse } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cloneElement, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { AdminApiError, adminApi, errorMessage, type AdminApiIssue } from "@/lib/admin/product-api";
import {
  changedCardValues,
  emptyProductForm,
  formatKopecks,
  productCardFromForm,
  productFormFromData,
  productPriceFromForm,
  productSourceLabels,
  productStockFromForm,
  suggestProductName,
  type ProductFormState,
} from "@/lib/admin/product-form";
import { missingRequiredFields } from "@/lib/admin/product-rules";
import type {
  AdminBrand,
  AdminCategory,
  AdminProductEditorData,
  AdminProductStockRow,
  AdminWarehouse,
} from "@/lib/admin/product-types";
import { ProductFitments } from "./product-fitments";
import { ProductImages } from "./product-images";
import { ProductReferenceSelect } from "./product-reference-select";
import styles from "./product-editor.module.css";

type Message = { tone: "success" | "error"; text: string };
type LoadState = "loading" | "ready" | "missing" | "error";

/** Back to the products section of the dashboard. */
const PRODUCTS_LIST_HREF = "/admin?section=products";

const seasonOptions = [
  { value: "summer", label: "Летняя" },
  { value: "winter", label: "Зимняя" },
  { value: "all-season", label: "Всесезонная" },
] as const;

const wheelTypeOptions = [
  { value: "alloy", label: "Литой" },
  { value: "steel", label: "Штампованный" },
  { value: "other", label: "Другой" },
] as const;

/** Server issue paths → form keys (stock rows are keyed by warehouse id). */
function issueKey(field: string, sentStock: ReadonlyArray<{ warehouseId: string }>): string {
  const stock = /^stock\.(\d+)/.exec(field);
  if (stock) return `stock:${sentStock[Number(stock[1])]?.warehouseId ?? ""}`;
  return field;
}

function sortByName<Item extends { name: string }>(items: Item[]): Item[] {
  return [...items].sort((first, second) => first.name.localeCompare(second.name, "ru"));
}

/** Accessibility attributes a field passes to its control. */
interface ControlProps {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/**
 * Labelled control. The error text sits outside the <label> (the accessible
 * name stays the label alone) and is linked with aria-describedby; an invalid
 * control gets aria-invalid, which also lets the editor focus it after a save.
 */
function Field({
  id,
  label,
  error,
  wide,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  wide?: boolean;
  children: ReactElement<ControlProps>;
}) {
  const errorId = `${id}-error`;
  return (
    <div className={`${styles.field} ${wide ? styles.wide : ""} ${error ? styles.invalid : ""}`}>
      <label htmlFor={id}><span>{label}</span></label>
      {cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errorId : undefined,
      })}
      {error && <small id={errorId} className={styles.fieldError}>{error}</small>}
    </div>
  );
}

export function ProductEditor({ productId, created = false }: { productId: string | null; created?: boolean }) {
  const router = useRouter();
  const isNew = productId === null;
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [data, setData] = useState<AdminProductEditorData | null>(null);
  const [brands, setBrands] = useState<AdminBrand[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [warehouses, setWarehouses] = useState<AdminProductStockRow[]>([]);
  const [form, setForm] = useState<ProductFormState>(() => emptyProductForm());
  const [initialForm, setInitialForm] = useState<ProductFormState>(() => emptyProductForm());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(
    created ? { tone: "success", text: "Товар создан. Добавьте фото и применимость ниже." } : null,
  );
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /** Incremented after a save attempt: focus moves to the first invalid field or the result message. */
  const [focusRequest, setFocusRequest] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    // A refresh after saving keeps the page on screen; only the first load shows "Загружаем…".
    setLoadState((current) => (current === "ready" ? current : "loading"));
    const references = Promise.all([
      adminApi<{ items: AdminBrand[] }>("/api/admin/brands", { signal }),
      adminApi<{ items: AdminCategory[] }>("/api/admin/categories", { signal }),
    ]);
    const load = isNew
      ? Promise.all([references, adminApi<{ items: AdminWarehouse[] }>("/api/admin/warehouses", { signal })]).then(
          ([[brandList, categoryList], warehouseList]) => {
            setBrands(brandList.items);
            setCategories(categoryList.items);
            setWarehouses(warehouseList.items.map((warehouse) => ({
              warehouseId: warehouse.id,
              warehouseCode: warehouse.code,
              warehouseName: warehouse.name,
              quantity: 0,
              reserved: 0,
            })));
            setData(null);
            setForm(emptyProductForm());
            setInitialForm(emptyProductForm());
          },
        )
      : Promise.all([references, adminApi<{ product: AdminProductEditorData }>(`/api/admin/products/${productId}`, { signal })]).then(
          ([[brandList, categoryList], result]) => {
            const state = productFormFromData(result.product.card, result.product.price, result.product.stock);
            setBrands(brandList.items);
            setCategories(categoryList.items);
            setData(result.product);
            setForm(state);
            setInitialForm(state);
            setConflict(false);
          },
        );
    load
      .then(() => setLoadState("ready"))
      .catch((error: unknown) => {
        if ((error as { name?: string }).name === "AbortError") return;
        if (error instanceof AdminApiError && (error.status === 404 || error.code === "INVALID_PRODUCT_ID")) {
          setLoadState("missing");
          return;
        }
        if (error instanceof AdminApiError && (error.status === 401 || error.status === 403)) {
          router.replace("/admin");
          return;
        }
        setLoadError(errorMessage(error, "Не удалось загрузить данные."));
        setLoadState("error");
      });
    return () => controller.abort();
  }, [isNew, productId, reloadKey, router]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialForm), [form, initialForm]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (focusRequest === 0) return;
    // The save button is disabled while saving, so focus would stay on <body>.
    const firstInvalid = contentRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)');
    (firstInvalid ?? messageRef.current)?.focus();
  }, [focusRequest]);

  const locked = useMemo(() => new Set(data?.lockedFields ?? []), [data]);
  const stockRows = isNew ? warehouses : data?.stock ?? [];
  const isLocked = (field: string) => locked.has(field);
  const brandName = brands.find((brand) => brand.id === form.brandId)?.name ?? data?.brandName ?? "";

  function update<Key extends keyof ProductFormState>(key: Key, value: ProductFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    const issueField = key === "price" ? "price.amountKopecks" : key === "oldPrice" ? "price.oldAmountKopecks" : `card.${key}`;
    setIssues((current) => {
      if (!current[issueField]) return current;
      const next = { ...current };
      delete next[issueField];
      return next;
    });
  }

  function showIssues(list: readonly AdminApiIssue[], sentStock: ReadonlyArray<{ warehouseId: string }> = []) {
    setIssues(Object.fromEntries(list.map((issue) => [issueKey(issue.field, sentStock), issue.message])));
  }

  async function createBrand(name: string) {
    const result = await adminApi<{ brand: AdminBrand }>("/api/admin/brands", { json: { name } });
    setBrands((current) => sortByName([...current.filter((brand) => brand.id !== result.brand.id), result.brand]));
    return result.brand;
  }

  async function createCategory(name: string) {
    const result = await adminApi<{ category: AdminCategory }>("/api/admin/categories", { json: { name, parentId: null } });
    setCategories((current) => sortByName([...current.filter((category) => category.id !== result.category.id), result.category]));
    return result.category;
  }

  async function save() {
    setMessage(null);
    setIssues({});
    const { card, errors: cardErrors } = productCardFromForm(form);
    const { price, errors: priceErrors } = productPriceFromForm(form);
    const { stock, errors: stockErrors } = productStockFromForm(form, stockRows);
    // Every missing required field at once (the server checks the same list).
    const cardChanged = isNew || (data !== null && Object.keys(changedCardValues(data.card, card)).length > 0);
    const requiredErrors = cardChanged
      ? missingRequiredFields(form as unknown as Record<string, unknown>, form.kind).map((missing) => ({ field: `card.${missing.field}`, message: missing.message }))
      : [];
    const localErrors = [
      ...cardErrors,
      ...requiredErrors.filter((required) => !cardErrors.some((error) => error.field === required.field)),
      ...priceErrors,
      ...stockErrors.map((error, index) => ({ ...error, field: `stock:${stockRows[index]?.warehouseId ?? ""}` })),
    ];
    if (localErrors.length > 0) {
      setIssues(Object.fromEntries(localErrors.map((error) => [error.field, error.message])));
      setMessage({ tone: "error", text: `Проверьте отмеченные поля (${localErrors.length}).` });
      setFocusRequest((value) => value + 1);
      return;
    }
    let sentStock: Array<{ warehouseId: string; quantity: number }> = [];
    setSaving(true);
    try {
      if (isNew) {
        sentStock = stock.filter((row) => row.quantity > 0);
        const result = await adminApi<{ product: { id: string } }>("/api/admin/products", {
          json: { card, price, stock: sentStock },
        });
        setInitialForm(form);
        router.replace(`/admin/products/${result.product.id}?created=1`);
        return;
      }
      if (!data) return;
      const payload: Record<string, unknown> = { version: data.version };
      const cardChanges = changedCardValues(data.card, card);
      if (Object.keys(cardChanges).length > 0) payload.card = cardChanges;
      if (!isLocked("price")) {
        if (!price && data.price) {
          setIssues({ "price.amountKopecks": "Цену нельзя удалить. Чтобы убрать товар с сайта, снимите «Показывать на сайте»." });
          setMessage({ tone: "error", text: "Проверьте отмеченные поля (1)." });
          setFocusRequest((value) => value + 1);
          return;
        }
        if (price && (price.amountKopecks !== data.price?.amountKopecks || price.oldAmountKopecks !== data.price?.oldAmountKopecks)) {
          payload.price = price;
        }
      }
      if (!isLocked("stock")) {
        sentStock = stock.filter((row) => row.quantity !== data.stock.find((stored) => stored.warehouseId === row.warehouseId)?.quantity);
        if (sentStock.length > 0) payload.stock = sentStock;
      }
      if (Object.keys(payload).length === 1) {
        setMessage({ tone: "success", text: "Изменений нет." });
        setFocusRequest((value) => value + 1);
        return;
      }
      const result = await adminApi<{ changed: boolean }>(`/api/admin/products/${data.id}`, { method: "PATCH", json: payload });
      setMessage({
        tone: "success",
        text: result.changed ? "Сохранено. Каталог на сайте обновится при следующем открытии страницы." : "Изменений нет.",
      });
      setReloadKey((value) => value + 1);
      setFocusRequest((value) => value + 1);
    } catch (error) {
      const fieldIssues = error instanceof AdminApiError ? error.issues : [];
      if (error instanceof AdminApiError) {
        if (error.code === "PRODUCT_VERSION_CONFLICT") setConflict(true);
        showIssues(fieldIssues, sentStock);
      }
      const text = errorMessage(error, "Изменения не сохранены.");
      setMessage({ tone: "error", text: fieldIssues.length > 1 ? `${text} Ошибок: ${fieldIssues.length}.` : text });
      setFocusRequest((value) => value + 1);
    } finally {
      setSaving(false);
    }
  }

  function reloadFresh() {
    if (dirty && !window.confirm("Ваши несохранённые правки будут заменены актуальными данными. Продолжить?")) return;
    setMessage(null);
    setIssues({});
    setReloadKey((value) => value + 1);
  }

  const header = (
    <header className="admin-topbar">
      <Link className={styles.backLink} href={PRODUCTS_LIST_HREF}><ArrowLeft size={15} /> К списку товаров</Link>
      <div className="admin-breadcrumb">Товары <ChevronRight size={13} /> <strong>{isNew ? "Новый товар" : data?.card.sku ?? "Товар"}</strong></div>
    </header>
  );

  if (loadState !== "ready") {
    return (
      <main className={styles.page}>
        {header}
        <div className="admin-content">
          <article className="admin-card">
            <div className={styles.state} role={loadState === "error" ? "alert" : "status"}>
              {loadState === "loading" && <span>Загружаем…</span>}
              {loadState === "missing" && <><strong>Товар не найден</strong><Link className="admin-secondary-button" href={PRODUCTS_LIST_HREF}>К списку товаров</Link></>}
              {loadState === "error" && <><strong>{loadError}</strong><button type="button" className="admin-secondary-button" onClick={() => setReloadKey((value) => value + 1)}>Повторить</button></>}
            </div>
          </article>
        </div>
      </main>
    );
  }

  const isTire = form.kind === "tire";
  const fieldError = (field: string) => issues[`card.${field}`];
  const otherIssues = Object.entries(issues).filter(([key]) => !key.startsWith("card.") && !key.startsWith("price.") && !key.startsWith("stock:"));
  const sourceLabel = data ? productSourceLabels[data.source] ?? data.source : "Вручную";
  const categoryIsTextOnly = Boolean(data && !data.card.categoryId && data.categoryName);

  return (
    <main className={styles.page}>
      {header}
      <div className="admin-content" ref={contentRef}>
        <div className="admin-page-intro">
          <div>
            <p className="eyebrow">Каталог</p>
            <div className={styles.titleRow}>
              <h1>{isNew ? "Новый товар" : data?.card.name}</h1>
              <span className={`${styles.badge} ${styles.muted}`}>Источник: {sourceLabel}</span>
              {data && <span className={`${styles.badge} ${data.card.isActive ? "" : styles.sand}`}>{data.card.isActive ? "На сайте" : "Скрыт"}</span>}
            </div>
            {data && <span>SKU {data.card.sku}{data.externalId ? ` · внешний ID ${data.externalId}` : ""} · изменён {new Date(data.updatedAt).toLocaleString("ru-RU")}</span>}
          </div>
          {data && data.card.isActive && data.price && (
            <a className="admin-secondary-button" href={data.publicPath} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Открыть на сайте</a>
          )}
        </div>

        {data?.source === "1c" && (
          <div className={styles.notice} role="note">
            <strong>Товар управляется 1С.</strong>
            Карточка, цена, остатки и активность приходят из учётной системы и здесь не меняются — следующий обмен всё равно их перезапишет.
            Здесь можно добавить свои фото и применимость к автомобилям.
          </div>
        )}
        {data?.source === "csv" && (
          <div className={styles.notice} role="note">
            <strong>Товар загружен из CSV.</strong>
            Правки сохранятся, но следующий импорт этого товара перезапишет карточку, цену и переданный в файле остаток.
          </div>
        )}
        {conflict && (
          <div className={styles.notice} role="alert">
            <strong>Товар изменили, пока форма была открыта.</strong>
            Загрузите актуальные данные и внесите правки снова.{" "}
            <button type="button" className={styles.linkButton} onClick={reloadFresh}>Загрузить актуальные данные</button>
          </div>
        )}

        <div className={styles.layout}>
          <div className={styles.column}>
            <article className="admin-card">
              <div className="admin-card-head"><div><p className="eyebrow">Карточка</p><h2>Основные данные</h2></div><PackageCheck /></div>
              <div className={styles.sectionBody}>
                <div className="admin-form-grid">
                  <div className={styles.field}>
                    <span className={styles.fieldLabel} id="product-kind-label">Тип товара</span>
                    {isNew ? (
                      <div className="admin-segmented" role="group" aria-labelledby="product-kind-label">
                        <button type="button" className={isTire ? "active" : ""} aria-pressed={isTire} onClick={() => update("kind", "tire")}>Шина</button>
                        <button type="button" className={!isTire ? "active" : ""} aria-pressed={!isTire} onClick={() => update("kind", "wheel")}>Диск</button>
                      </div>
                    ) : (
                      <input value={isTire ? "Шина" : "Диск"} aria-labelledby="product-kind-label" disabled readOnly />
                    )}
                  </div>
                  <Field id="product-sku" label="SKU" error={fieldError("sku")}>
                    <input value={form.sku} maxLength={100} disabled={isLocked("sku")} onChange={(event) => update("sku", event.target.value)} required />
                  </Field>
                  <Field id="product-article" label="Артикул производителя" error={fieldError("article")}>
                    <input value={form.article} maxLength={100} disabled={isLocked("article")} onChange={(event) => update("article", event.target.value)} />
                  </Field>
                  <Field id="product-country" label="Страна производства" error={fieldError("country")}>
                    <input value={form.country} maxLength={100} disabled={isLocked("country")} onChange={(event) => update("country", event.target.value)} />
                  </Field>
                  <ProductReferenceSelect
                    label="Бренд"
                    items={brands}
                    value={form.brandId}
                    onChange={(value) => update("brandId", value)}
                    onCreate={createBrand}
                    disabled={isLocked("brandId")}
                    error={fieldError("brandId")}
                    emptyLabel={data?.brandName && !form.brandId ? `Не выбран (сейчас «${data.brandName}»)` : "Выберите бренд"}
                    createLabel="+ Новый бренд"
                  />
                  <Field id="product-model" label="Модель" error={fieldError("model")}>
                    <input value={form.model} maxLength={160} disabled={isLocked("model")} onChange={(event) => update("model", event.target.value)} required />
                  </Field>
                  <ProductReferenceSelect
                    label="Категория"
                    items={categories}
                    value={form.categoryId}
                    onChange={(value) => update("categoryId", value)}
                    onCreate={createCategory}
                    disabled={isLocked("categoryId")}
                    error={fieldError("categoryId")}
                    emptyLabel={categoryIsTextOnly ? `Не выбрана (сейчас «${data?.categoryName}»)` : "Без категории"}
                    createLabel="+ Новая категория"
                  />
                  <Field id="product-isActive" label="Показывать на сайте" error={fieldError("isActive")}>
                    <select value={form.isActive ? "true" : "false"} disabled={isLocked("isActive")} onChange={(event) => update("isActive", event.target.value === "true")}>
                      <option value="true">Да — товар в каталоге</option>
                      <option value="false">Нет — скрыт</option>
                    </select>
                  </Field>
                  <Field id="product-name" label="Название (на странице товара)" error={fieldError("name")} wide>
                    <input value={form.name} maxLength={300} disabled={isLocked("name")} onChange={(event) => update("name", event.target.value)} required />
                  </Field>
                </div>
                {!isLocked("name") && (
                  <button type="button" className={styles.linkButton} onClick={() => update("name", suggestProductName(form, brandName))}>
                    Собрать название из бренда, модели и размера
                  </button>
                )}
                <div className="admin-form-grid">
                  <div className={`${styles.field} ${styles.wide} ${fieldError("description") ? styles.invalid : ""}`}>
                    <label htmlFor="product-description"><span>Описание</span></label>
                    <textarea
                      id="product-description"
                      className={styles.textarea}
                      value={form.description}
                      maxLength={20000}
                      disabled={isLocked("description")}
                      aria-invalid={fieldError("description") ? true : undefined}
                      aria-describedby={fieldError("description") ? "product-description-error" : undefined}
                      onChange={(event) => update("description", event.target.value)}
                    />
                    {fieldError("description") && <small id="product-description-error" className={styles.fieldError}>{fieldError("description")}</small>}
                  </div>
                </div>
              </div>
            </article>

            <article className="admin-card">
              <div className="admin-card-head"><div><p className="eyebrow">Характеристики</p><h2>{isTire ? "Размер и свойства шины" : "Размер и свойства диска"}</h2></div></div>
              <div className={styles.sectionBody}>
                {isTire ? (
                  <>
                    <div className="admin-form-grid">
                      <Field id="product-width" label="Ширина профиля, мм" error={fieldError("width")}><input inputMode="numeric" value={form.width} disabled={isLocked("width")} onChange={(event) => update("width", event.target.value)} placeholder="205" /></Field>
                      <Field id="product-profile" label="Высота профиля, %" error={fieldError("profile")}><input inputMode="numeric" value={form.profile} disabled={isLocked("profile")} onChange={(event) => update("profile", event.target.value)} placeholder="55" /></Field>
                      <Field id="product-diameter" label="Посадочный диаметр, R" error={fieldError("diameter")}><input inputMode="numeric" value={form.diameter} disabled={isLocked("diameter")} onChange={(event) => update("diameter", event.target.value)} placeholder="16" /></Field>
                      <Field id="product-season" label="Сезон" error={fieldError("season")}>
                        <select value={form.season} disabled={isLocked("season")} onChange={(event) => update("season", event.target.value as ProductFormState["season"])}>
                          <option value="">Выберите сезон</option>
                          {seasonOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </Field>
                      <Field id="product-loadIndex" label="Индекс нагрузки" error={fieldError("loadIndex")}><input value={form.loadIndex} maxLength={20} disabled={isLocked("loadIndex")} onChange={(event) => update("loadIndex", event.target.value)} placeholder="94" /></Field>
                      <Field id="product-speedIndex" label="Индекс скорости" error={fieldError("speedIndex")}><input value={form.speedIndex} maxLength={20} disabled={isLocked("speedIndex")} onChange={(event) => update("speedIndex", event.target.value)} placeholder="T" /></Field>
                    </div>
                    <div className="admin-toggle-row">
                      <label><input type="checkbox" checked={form.studded} disabled={isLocked("studded")} onChange={(event) => update("studded", event.target.checked)} /> Шипованная</label>
                      <label><input type="checkbox" checked={form.runflat} disabled={isLocked("runflat")} onChange={(event) => update("runflat", event.target.checked)} /> RunFlat</label>
                      <label><input type="checkbox" checked={form.xl} disabled={isLocked("xl")} onChange={(event) => update("xl", event.target.checked)} /> Усиленная (XL)</label>
                    </div>
                  </>
                ) : (
                  <div className="admin-form-grid">
                    <Field id="product-diameter" label="Посадочный диаметр, R" error={fieldError("diameter")}><input inputMode="numeric" value={form.diameter} disabled={isLocked("diameter")} onChange={(event) => update("diameter", event.target.value)} placeholder="18" /></Field>
                    <Field id="product-wheelWidth" label="Ширина диска, J" error={fieldError("wheelWidth")}><input inputMode="decimal" value={form.wheelWidth} disabled={isLocked("wheelWidth")} onChange={(event) => update("wheelWidth", event.target.value)} placeholder="8" /></Field>
                    <Field id="product-boltCount" label="Количество отверстий" error={fieldError("boltCount")}><input inputMode="numeric" value={form.boltCount} disabled={isLocked("boltCount")} onChange={(event) => update("boltCount", event.target.value)} placeholder="5" /></Field>
                    <Field id="product-pcd" label="PCD, мм" error={fieldError("pcd")}><input inputMode="decimal" value={form.pcd} disabled={isLocked("pcd")} onChange={(event) => update("pcd", event.target.value)} placeholder="112" /></Field>
                    <Field id="product-offset" label="Вылет ET, мм" error={fieldError("offset")}><input inputMode="numeric" value={form.offset} disabled={isLocked("offset")} onChange={(event) => update("offset", event.target.value)} placeholder="35" /></Field>
                    <Field id="product-centerBore" label="Центральное отверстие DIA, мм" error={fieldError("centerBore")}><input inputMode="decimal" value={form.centerBore} disabled={isLocked("centerBore")} onChange={(event) => update("centerBore", event.target.value)} placeholder="66,6" /></Field>
                    <Field id="product-wheelType" label="Тип диска" error={fieldError("wheelType")}>
                      <select value={form.wheelType} disabled={isLocked("wheelType")} onChange={(event) => update("wheelType", event.target.value as ProductFormState["wheelType"])}>
                        <option value="">Не указан</option>
                        {wheelTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </Field>
                    <Field id="product-color" label="Цвет" error={fieldError("color")}><input value={form.color} maxLength={100} disabled={isLocked("color")} onChange={(event) => update("color", event.target.value)} placeholder="серебристый" /></Field>
                  </div>
                )}
                <p className={styles.hint}>Эти поля используются фильтрами каталога и подбором по автомобилю.</p>
              </div>
            </article>
          </div>

          <div className={styles.column}>
            <article className="admin-card">
              <div className="admin-card-head"><div><p className="eyebrow">Цена</p><h2>Розничная цена{data?.price && <small> сейчас {formatKopecks(data.price.amountKopecks)}</small>}</h2></div></div>
              <div className={styles.sectionBody}>
                <div className="admin-form-grid">
                  <Field id="product-price" label="Цена, ₽" error={issues["price.amountKopecks"]}>
                    <input inputMode="decimal" value={form.price} disabled={isLocked("price")} onChange={(event) => update("price", event.target.value)} placeholder="12 990" />
                  </Field>
                  <Field id="product-oldPrice" label="Старая цена, ₽" error={issues["price.oldAmountKopecks"]}>
                    <input inputMode="decimal" value={form.oldPrice} disabled={isLocked("price")} onChange={(event) => update("oldPrice", event.target.value)} placeholder="не указана" />
                  </Field>
                </div>
                <p className={styles.hint}>Без цены товар не показывается в каталоге. Старая цена — только реальная прежняя цена, она должна быть больше текущей.</p>
              </div>
            </article>

            <article className="admin-card">
              <div className="admin-card-head"><div><p className="eyebrow">Остатки</p><h2>По складам</h2></div><Warehouse /></div>
              <div className={styles.sectionBody}>
                {stockRows.length === 0 ? (
                  <p className={styles.hint}>Активных складов нет. Склады появляются после импорта CSV с колонками warehouse_code и warehouse_name или после обмена с 1С.</p>
                ) : (
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead><tr><th>Склад</th><th>Остаток</th><th>Резерв</th><th>Свободно</th></tr></thead>
                      <tbody>
                        {stockRows.map((row) => {
                          const error = issues[`stock:${row.warehouseId}`];
                          const typed = Number(form.stock[row.warehouseId] ?? row.quantity);
                          return (
                            <tr key={row.warehouseId}>
                              <td><strong>{row.warehouseName}</strong><small>{row.warehouseCode}</small></td>
                              <td>
                                <input
                                  className={`${styles.stockInput} ${error ? styles.invalidInput : ""}`}
                                  inputMode="numeric"
                                  aria-label={`Остаток на складе ${row.warehouseName}`}
                                  aria-invalid={error ? true : undefined}
                                  aria-describedby={error ? `stock-${row.warehouseId}-error` : undefined}
                                  value={form.stock[row.warehouseId] ?? ""}
                                  disabled={isLocked("stock")}
                                  onChange={(event) => setForm((current) => ({ ...current, stock: { ...current.stock, [row.warehouseId]: event.target.value } }))}
                                />
                                {error && <small id={`stock-${row.warehouseId}-error`} className={styles.fieldError}>{error}</small>}
                              </td>
                              <td>{row.reserved}</td>
                              <td>{Number.isFinite(typed) ? Math.max(0, typed - row.reserved) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className={styles.hint}>Остаток — физическое количество на складе. Его нельзя сделать меньше резерва: зарезервированные единицы уже в заказах.</p>
              </div>
            </article>
          </div>
        </div>

        <div className={styles.saveBar}>
          {message && (
            <p ref={messageRef} tabIndex={-1} className={message.tone === "error" ? styles.error : styles.success} role={message.tone === "error" ? "alert" : "status"}>
              {message.text}
            </p>
          )}
          {!message && dirty && <p>Есть несохранённые изменения.</p>}
          {otherIssues.length > 0 && <ul className={styles.errorList}>{otherIssues.map(([key, text]) => <li key={key}>{text}</li>)}</ul>}
          <Link className="admin-secondary-button" href={PRODUCTS_LIST_HREF}>Отмена</Link>
          <button type="button" className="admin-primary-button" disabled={saving || (!isNew && !dirty)} onClick={() => void save()}>
            <Save size={15} /> {saving ? "Сохраняем…" : isNew ? "Создать товар" : "Сохранить"}
          </button>
        </div>

        {data && (
          <div className={`${styles.column} ${styles.afterSave}`}>
            <ProductImages key={`images-${data.id}`} productId={data.id} initialImages={data.images} uploads={data.uploads} />
            <ProductFitments productId={data.id} kind={data.card.kind} />
          </div>
        )}
      </div>
    </main>
  );
}

"use client";

import { Pencil, Plus, Search, Upload } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { seasonLabels } from "@/lib/catalog-data";
import { formatKopecks, productSourceLabels } from "@/lib/admin/product-form";
import type { AdminProductListItem, AdminProductListResponse } from "@/lib/admin/product-types";
import type { ProductKind } from "@/lib/types";
import { useStore } from "@/components/store-provider";
import { ImportJobs } from "@/components/admin/import-jobs";

interface CsvImportReport {
  jobId?: string;
  received: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ line: number; message: string }>;
}

function MiniArt({ product }: { product: AdminProductListItem }) {
  if (product.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className="admin-product-thumb image"><img src={product.image} alt="" /></span>;
  }
  return <span className={`admin-product-thumb ${product.kind}`}><i /><b /></span>;
}

function CsvImportForm({
  type,
  title,
}: {
  type: "products" | "fitments";
  title: string;
}) {
  const [report, setReport] = useState<CsvImportReport | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    setReport(null);
    try {
      const form = event.currentTarget;
      const file = (form.elements.namedItem("file") as HTMLInputElement | null)?.files?.[0];
      if (!file) throw new Error("Выберите CSV-файл.");
      const mode = (form.elements.namedItem("mode") as HTMLSelectElement | null)?.value;
      const response = await fetch(`/api/admin/imports/${type}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "X-File-Name": encodeURIComponent(file.name),
          "X-Import-Mode": mode === "full" ? "full" : "incremental",
        },
        body: file,
      });
      const result = (await response.json()) as {
        report?: CsvImportReport;
        message?: string;
      };
      if (!response.ok && response.status !== 207) {
        throw new Error(result.message || "Импорт не выполнен.");
      }
      if (!result.report) throw new Error("Сервер не вернул отчет об импорте.");
      setReport(result.report);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Импорт не выполнен.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="admin-card csv-import-card" onSubmit={submit}>
      <div className="admin-card-head"><div><p className="eyebrow">CSV</p><h2>{title}</h2></div><Upload /></div>
      <label><span>{type === "products" ? "CSV-файл товаров" : "CSV-файл применимости"}</span><input type="file" name="file" accept=".csv,text/csv" required /></label>
      {type === "products" && (
        <label><span>Режим</span><select name="mode" defaultValue="incremental"><option value="incremental">Добавить и обновить</option><option value="full">Полная синхронизация CSV</option></select></label>
      )}
      <button className="admin-primary-button" disabled={submitting}>{submitting ? "Проверяем и сохраняем…" : "Запустить импорт"}</button>
      {message && <p className="admin-login-message" role="alert">{message}</p>}
      {report && (
        <div className="import-report">
          <strong>Получено: {report.received}</strong>
          <span>Создано: {report.created}; обновлено: {report.updated}; ошибок: {report.failed}.</span>
          {report.jobId && <small>Задание: {report.jobId}</small>}
          {report.errors.slice(0, 20).map((error) => <small key={`${error.line}-${error.message}`}>Строка {error.line}: {error.message}</small>)}
        </div>
      )}
    </form>
  );
}

export function ProductsSection() {
  const { user } = useStore();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | ProductKind>("all");
  const [products, setProducts] = useState<AdminProductListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [message, setMessage] = useState("");
  const [activeFilter, setActiveFilter] = useState("true");
  const [sourceFilter, setSourceFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => setPage(1), [kind, query, activeFilter, sourceFilter]);
  useEffect(() => setSelectedIds([]), [page, kind, query, activeFilter, sourceFilter, refreshKey]);
  useEffect(() => {
    const abortController = new AbortController();
    const timeout = window.setTimeout(() => {
      const parameters = new URLSearchParams({ type: kind, page: String(page), pageSize: "24" });
      if (query.trim()) parameters.set("search", query.trim());
      parameters.set("active", activeFilter);
      if (sourceFilter) parameters.set("sourceSystem", sourceFilter);
      setMessage("Загружаем каталог…");
      void fetch(`/api/admin/products?${parameters.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: abortController.signal,
      }).then(async (response) => {
        const result = (await response.json()) as Partial<AdminProductListResponse> & { message?: string };
        if (!response.ok) throw new Error(result.message || "Каталог недоступен.");
        setProducts(result.items ?? []);
        setTotal(result.pagination?.total ?? 0);
        setTotalPages(result.pagination?.totalPages ?? 0);
        setMessage("");
      }).catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") {
          setProducts([]);
          setMessage(error instanceof Error ? error.message : "Каталог недоступен.");
        }
      });
    }, 300);
    return () => { window.clearTimeout(timeout); abortController.abort(); };
  }, [kind, page, query, activeFilter, sourceFilter, refreshKey]);

  async function updateSelected(action: "activate" | "deactivate") {
    if (!window.confirm(`${action === "activate" ? "Активировать" : "Скрыть"} выбранные товары (${selectedIds.length})?`)) return;
    try {
      const response = await fetch("/api/admin/products/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productIds: selectedIds, action, confirmed: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Изменения не сохранены.");
      setRefreshKey((current) => current + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Изменения не сохранены."); }
  }

  return (
    <>
      <div className="admin-page-intro">
        <div><p className="eyebrow">Управление каталогом</p><h1>Товары</h1><span>{total} позиций · рабочий источник PostgreSQL</span></div>
        <Link className="admin-primary-button" href="/admin/products/new"><Plus size={17} /> Добавить товар</Link>
      </div>
      <div className="admin-two-column">
        <CsvImportForm type="products" title="Импорт products.csv" />
        <CsvImportForm type="fitments" title="Импорт fitments.csv" />
      </div>
      <ImportJobs />
      <article className="admin-card products-card">
        <div className="admin-products-toolbar">
          <label className="admin-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SKU, артикул, название, модель или бренд" aria-label="Поиск товаров" /></label>
          <select aria-label="Активность товара" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}><option value="true">Активные</option><option value="false">Неактивные</option><option value="all">Все</option></select>
          <select aria-label="Источник товара" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">Все источники</option><option value="csv">CSV</option><option value="manual">Вручную</option><option value="1c">1С</option></select>
          <div className="admin-segmented"><button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>Все</button><button className={kind === "tire" ? "active" : ""} onClick={() => setKind("tire")}>Шины</button><button className={kind === "wheel" ? "active" : ""} onClick={() => setKind("wheel")}>Диски</button></div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table products-table">
            <thead><tr><th>Выбор</th><th>Товар</th><th>Тип / сезон</th><th>Цена</th><th>Доступно</th><th>Внешний ID</th><th>Обновлён</th><th>Действие</th></tr></thead>
            <tbody>{products.map((product) => (
              <tr key={product.id}>
                <td><input type="checkbox" aria-label={`Выбрать ${product.sku}`} checked={selectedIds.includes(product.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))} /></td>
                <td><div className="admin-product-cell"><MiniArt product={product} /><p><strong>{product.brand} {product.model}</strong><span>{product.subtitle}</span><small>{product.sku}{product.isActive ? "" : " · скрыт"}</small></p></div></td>
                <td>{product.kind === "tire" ? <><strong>Шина</strong><small>{seasonLabels[product.season]}</small></> : <><strong>Диск</strong><small>{product.color}</small></>}</td>
                <td>{product.priceKopecks === null ? <><strong>—</strong><small>Цена не задана</small></> : <><strong>{formatKopecks(product.priceKopecks)}</strong>{product.oldPriceKopecks !== null && <small><s>{formatKopecks(product.oldPriceKopecks)}</s></small>}</>}</td>
                <td><span className={`inventory-pill ${product.stock - product.reserved <= 6 ? "low" : ""}`}>{product.stock - product.reserved} шт.</span><small>резерв {product.reserved}</small></td>
                <td><code>{product.externalId || "—"}</code><small>{productSourceLabels[product.source] ?? product.source}</small></td>
                <td><span>{new Date(product.updatedAt).toLocaleDateString("ru-RU")}</span><small>{new Date(product.updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</small></td>
                <td><Link className="admin-secondary-button" href={`/admin/products/${product.id}`} aria-label={`Изменить ${product.sku}`}><Pencil size={14} /> Изменить</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {products.length === 0 && <div className="admin-empty"><Search /><strong>{message || "Товары не найдены"}</strong><span>Измените запрос или фильтр.</span></div>}
        {products.length > 0 && message && <p role="alert">{message}</p>}
        {user?.role === "admin" && selectedIds.length > 0 && <div><span>Выбрано: {selectedIds.length} </span><button onClick={() => void updateSelected("activate")}>Активировать</button><button onClick={() => void updateSelected("deactivate")}>Скрыть</button></div>}
        <div className="admin-table-footer"><span>Показано {products.length} из {total}. Импорт обрабатывается пакетами по 1000 строк.</span><div><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Назад</button><span>{page} / {Math.max(totalPages, 1)}</span><button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Далее</button></div></div>
      </article>
    </>
  );
}

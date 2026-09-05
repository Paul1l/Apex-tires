"use client";

import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Boxes,
  ChevronRight,
  CloudCog,
  Database,
  Download,
  FileJson,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
  Upload,
  X,
} from "lucide-react";
import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { formatPrice, seasonLabels } from "@/lib/catalog-data";
import { businessConfig, getSellerDisplayName } from "@/config/business";
import { validateBusinessConfig } from "@/config/business-validation";
import type { Product, ProductKind, UserProfile } from "@/lib/types";
import { useStore } from "@/components/store-provider";
import { ImportJobs } from "@/components/admin/import-jobs";
import { FitmentRequests } from "@/components/admin/fitment-requests";

type Section = "overview" | "products" | "orders" | "sync" | "settings" | "fitment-requests";

interface OneCGatewayHealth {
  ok: boolean;
  site: "healthy" | "degraded";
  database: "healthy" | "unavailable" | "not_configured";
  oneC: "healthy" | "unavailable" | "not_configured";
  timestamp: string;
  synchronization: {
    last_success_at: string | null;
    products_processed_24h: number;
    error_runs: number;
    recentErrors: Array<{
      entity_type: string;
      operation: string;
      status: string;
      error_summary: string | null;
      started_at: string;
    }>;
  };
  orders: Record<"pending" | "processing" | "synced" | "failed", number>;
}

function MiniArt({ product }: { product: Product }) {
  if (product.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className="admin-product-thumb image"><img src={product.image} alt="" /></span>;
  }
  return <span className={`admin-product-thumb ${product.kind}`}><i /><b /></span>;
}

function Overview({ onNavigate }: { onNavigate: (section: Section) => void }) {
  const { products } = useStore();
  const [catalogTotal, setCatalogTotal] = useState<number | null>(
    businessConfig.catalog.dataMode === "preview" ? products.length : null,
  );
  const configurationIssues = validateBusinessConfig(businessConfig);

  useEffect(() => {
    if (businessConfig.catalog.dataMode !== "database") return;
    const abortController = new AbortController();
    void fetch("/api/admin/products?page=1&pageSize=24", {
      credentials: "same-origin", cache: "no-store", signal: abortController.signal,
    }).then((response) => response.ok ? response.json() : null)
      .then((result: { pagination?: { total?: number } } | null) => setCatalogTotal(result?.pagination?.total ?? null))
      .catch(() => setCatalogTotal(null));
    return () => abortController.abort();
  }, []);

  return (
    <>
      <div className="admin-page-intro">
        <div><p className="eyebrow">Production readiness</p><h1>Состояние магазина</h1><span>Только фактические данные и статусы подключений.</span></div>
        <button className="admin-primary-button" onClick={() => onNavigate("products")}><Upload size={17} /> Импортировать каталог</button>
      </div>
      <div className="admin-kpi-grid">
        <article><span className="admin-kpi-icon green"><Boxes /></span><div><p>Каталог</p><strong>{catalogTotal ?? "—"}</strong><small>{businessConfig.catalog.dataMode === "database" ? "Источник: PostgreSQL" : "Демонстрационные позиции"}</small></div></article>
        <article><span className="admin-kpi-icon sand"><ShoppingCart /></span><div><p>Заказы</p><strong>—</strong><small>Появятся после подключения PostgreSQL</small></div></article>
        <article><span className="admin-kpi-icon blue"><Database /></span><div><p>Бизнес-данные</p><strong>{configurationIssues.length === 0 ? "Готово" : `${configurationIssues.length} полей`}</strong><small>{configurationIssues.length === 0 ? "Конфигурация заполнена" : "Требуют заполнения"}</small></div></article>
        <article><span className="admin-kpi-icon violet"><Activity /></span><div><p>Режим</p><strong>{businessConfig.deploymentStage === "production" ? "Production" : "Preview"}</strong><small>Без вымышленных показателей</small></div></article>
      </div>
      <article className="admin-card recent-orders"><div className="admin-card-head"><div><p className="eyebrow">Заказы</p><h2>Рабочих данных пока нет</h2></div><button onClick={() => onNavigate("orders")}>Открыть раздел <ChevronRight size={16} /></button></div><p>После подключения PostgreSQL здесь будут отображаться реальные заказы. Демонстрационные покупатели и суммы удалены.</p></article>
    </>
  );
}

interface CsvImportReport {
  jobId?: string;
  received: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ line: number; message: string }>;
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
      <input type="file" name="file" accept=".csv,text/csv" required />
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

function ProductsSection() {
  const { user } = useStore();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | ProductKind>("all");
  const [products, setProducts] = useState<Product[]>([]);
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
      const parameters = new URLSearchParams({ type: kind, page: String(page), pageSize: "24", sort: "newest" });
      if (query.trim()) parameters.set("search", query.trim());
      parameters.set("active", activeFilter);
      if (sourceFilter) parameters.set("sourceSystem", sourceFilter);
      setMessage("Загружаем каталог…");
      void fetch(`/api/admin/products?${parameters.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: abortController.signal,
      }).then(async (response) => {
        const result = (await response.json()) as {
          items?: Product[];
          pagination?: { total: number; totalPages: number };
          message?: string;
        };
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
      </div>
      <div className="admin-two-column">
        <CsvImportForm type="products" title="Импорт products.csv" />
        <CsvImportForm type="fitments" title="Импорт fitments.csv" />
      </div>
      <ImportJobs />
      <article className="admin-card products-card">
        <div className="admin-products-toolbar">
          <label className="admin-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, бренд или артикул" /></label>
          <select aria-label="Активность товара" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}><option value="true">Активные</option><option value="false">Неактивные</option></select>
          <select aria-label="Источник товара" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">Все источники</option><option value="csv">CSV</option><option value="manual">Вручную</option><option value="1c">1С</option></select>
          <div className="admin-segmented"><button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>Все</button><button className={kind === "tire" ? "active" : ""} onClick={() => setKind("tire")}>Шины</button><button className={kind === "wheel" ? "active" : ""} onClick={() => setKind("wheel")}>Диски</button></div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table products-table">
            <thead><tr><th>Выбор</th><th>Товар</th><th>Тип / сезон</th><th>Цена</th><th>Доступно</th><th>Внешний ID</th><th>Обновлён</th></tr></thead>
            <tbody>{products.map((product) => (
              <tr key={product.id}>
                <td><input type="checkbox" aria-label={`Выбрать ${product.sku}`} checked={selectedIds.includes(product.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))} /></td>
                <td><div className="admin-product-cell"><MiniArt product={product} /><p><strong>{product.brand} {product.model}</strong><span>{product.subtitle}</span><small>{product.sku}</small></p></div></td>
                <td>{product.kind === "tire" ? <><strong>Шина</strong><small>{seasonLabels[product.season]}</small></> : <><strong>Диск</strong><small>{product.color}</small></>}</td>
                <td><strong>{formatPrice(product.price)}</strong>{product.oldPrice && <small><s>{formatPrice(product.oldPrice)}</s></small>}</td>
                <td><span className={`inventory-pill ${product.stock - product.reserved <= 6 ? "low" : ""}`}>{product.stock - product.reserved} шт.</span><small>резерв {product.reserved}</small></td>
                <td><code>{product.externalId || "—"}</code></td>
                <td><span>{new Date(product.updatedAt).toLocaleDateString("ru-RU")}</span><small>{new Date(product.updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</small></td>
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

function OrdersSection() {
  const [orders, setOrders] = useState<Array<{
    id: string;
    number: string;
    status: string;
    paymentStatus: string;
    total: number;
    createdAt: string;
    items: Array<{ name: string; quantity: number }>;
  }>>([]);
  const [message, setMessage] = useState("Загружаем заказы…");
  const [actionMessage, setActionMessage] = useState("");

  async function updateStatus(orderId: string, status: string) {
    setActionMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/status`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Статус не обновлён.");
      setOrders((current) =>
        current.map((order) => (order.id === orderId ? { ...order, status } : order)),
      );
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Статус не обновлён.");
    }
  }

  useEffect(() => {
    const abortController = new AbortController();
    void fetch("/api/admin/orders", {
      credentials: "same-origin",
      cache: "no-store",
      signal: abortController.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          items?: typeof orders;
          message?: string;
        };
        if (!response.ok) throw new Error(result.message || "Заказы недоступны.");
        setOrders(result.items ?? []);
        setMessage("");
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") {
          setMessage(error instanceof Error ? error.message : "Заказы недоступны.");
        }
      });
    return () => abortController.abort();
  }, []);

  return (
    <>
      <div className="admin-page-intro"><div><p className="eyebrow">Продажи</p><h1>Заказы</h1><span>Данные загружаются из PostgreSQL через защищённый API.</span>{actionMessage && <small className="admin-login-message">{actionMessage}</small>}</div></div>
      {message ? (
        <article className="admin-card admin-empty"><ShoppingCart /><strong>{message}</strong></article>
      ) : orders.length === 0 ? (
        <article className="admin-card admin-empty"><ShoppingCart /><strong>Заказов пока нет</strong></article>
      ) : (
        <article className="admin-card products-card">
          <div className="admin-table-wrap">
            <table className="admin-table"><thead><tr><th>Номер</th><th>Дата</th><th>Состав</th><th>Статус</th><th>Сумма</th></tr></thead>
              <tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.number}</strong></td><td>{new Date(order.createdAt).toLocaleString("ru-RU")}</td><td>{order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</td><td><select value={order.status} onChange={(event) => void updateStatus(order.id, event.target.value)}><option value="new">Новый</option><option value="confirmed">Подтверждён</option><option value="processing">В работе</option><option value="ready_for_pickup">Готов к выдаче</option><option value="shipped">Отправлен</option><option value="completed">Завершён</option><option value="cancelled">Отменён</option></select><small>Оплата: {order.paymentStatus}</small></td><td><strong>{formatPrice(order.total)}</strong></td></tr>)}</tbody>
            </table>
          </div>
        </article>
      )}
    </>
  );
}

function SyncSection() {
  const [gatewayHealth, setGatewayHealth] =
    useState<OneCGatewayHealth | null>(null);
  const [gatewayCheckFailed, setGatewayCheckFailed] = useState(false);
  const [gatewayCheckInProgress, setGatewayCheckInProgress] = useState(false);
  const [retryMessage, setRetryMessage] = useState("");

  async function retryFailedOrders() {
    setRetryMessage("");
    try {
      const response = await fetch("/api/admin/integrations/1c/retry", {
        method: "POST",
        credentials: "same-origin",
      });
      const result = (await response.json()) as { retried?: number; message?: string };
      if (!response.ok) throw new Error(result.message || "Повтор не запущен.");
      setRetryMessage(`Возвращено в очередь: ${result.retried ?? 0}.`);
      await refreshGatewayHealth();
    } catch (error) {
      setRetryMessage(error instanceof Error ? error.message : "Повтор не запущен.");
    }
  }

  async function refreshGatewayHealth() {
    setGatewayCheckInProgress(true);
    setGatewayCheckFailed(false);

    try {
      const healthResponse = await fetch("/api/integration-status", {
        cache: "no-store",
      });
      if (!healthResponse.ok) throw new Error("Gateway health request failed");

      setGatewayHealth(
        (await healthResponse.json()) as OneCGatewayHealth,
      );
    } catch {
      setGatewayHealth(null);
      setGatewayCheckFailed(true);
    } finally {
      setGatewayCheckInProgress(false);
    }
  }

  useEffect(() => {
    void refreshGatewayHealth();
  }, []);

  return (
    <>
      <div className="admin-page-intro"><div><p className="eyebrow">Интеграции</p><h1>Обмен с 1С</h1><span>Импорт номенклатуры, цен и остатков. Экспорт заказов.</span></div><button className="admin-primary-button" onClick={() => void refreshGatewayHealth()} disabled={gatewayCheckInProgress}><RefreshCw size={16} /> {gatewayCheckInProgress ? "Проверяем…" : "Проверить шлюз"}</button></div>
      <div className="sync-status-card">
        <div className="sync-orbit"><CloudCog /><span /></div>
        <div><p className="eyebrow">Статус шлюза</p><h2>{gatewayHealth?.oneC === "healthy" ? "1С подключена" : gatewayHealth?.oneC === "unavailable" || gatewayCheckFailed ? "1С недоступна" : "1С не подключена"}</h2><p>{gatewayHealth?.oneC === "healthy" ? "Сервер сайта, PostgreSQL и HTTP-сервис 1С доступны." : gatewayHealth?.oneC === "unavailable" ? "Каталог продолжает работать из PostgreSQL. Ошибка соединения зафиксирована для администратора." : "Подготовлен production-контур. Для запуска нужны PostgreSQL, адрес HTTP-сервиса 1С и секреты окружения."}</p></div>
        <span className="sync-ready"><i /> {gatewayHealth?.oneC === "healthy" ? "Подключена" : gatewayHealth?.oneC === "unavailable" ? "Недоступна" : "Не подключена"}</span>
      </div>
      <div className="sync-grid">
        <article className="admin-card">
          <div className="admin-card-head"><div><p className="eyebrow">API endpoints</p><h2>HTTP JSON</h2></div><Database /></div>
          <div className="endpoint-list">
            <div><span className="method get">GET</span><code>/api/integrations/1c/v1/health</code><small>Проверка доступности</small></div>
            <div><span className="method post">POST</span><code>/api/integrations/1c/v1/products/batch</code><small>Номенклатура и свойства</small></div>
            <div><span className="method post">POST</span><code>/api/integrations/1c/v1/prices/batch</code><small>Цены</small></div>
            <div><span className="method post">POST</span><code>/api/integrations/1c/v1/stocks/batch</code><small>Остатки по складам</small></div>
            <div><span className="method post">POST</span><code>/api/integrations/1c/v1/fitments/batch</code><small>Применяемость по автомобилям</small></div>
            <div><span className="method get">GET</span><code>/api/integrations/1c/v1/orders</code><small>Заказы для 1С</small></div>
            <div><span className="method post">POST</span><code>/api/integrations/1c/v1/order-statuses/batch</code><small>Статусы заказов</small></div>
          </div>
          <div className="token-note"><strong>Авторизация</strong><code>X-Integration-Key: ••••••••••••</code><span>Ключ хранится только в серверном хранилище секретов и 1С.</span></div>
        </article>
        <article className="admin-card">
          <div className="admin-card-head"><div><p className="eyebrow">Состояние обмена</p><h2>Очередь и синхронизация</h2></div><FileJson /></div>
          <div className="endpoint-list">
            <div><strong>{gatewayHealth?.synchronization.products_processed_24h ?? 0}</strong><small>товаров обработано за 24 часа</small></div>
            <div><strong>{gatewayHealth?.orders.pending ?? 0}</strong><small>заказов ожидают отправки</small></div>
            <div><strong>{gatewayHealth?.orders.failed ?? 0}</strong><small>заказов требуют внимания</small></div>
          </div>
          <button className="admin-secondary-button full" type="button" disabled={(gatewayHealth?.orders.failed ?? 0) === 0} onClick={() => void retryFailedOrders()}><RefreshCw size={16} /> Повторить неудачные отправки</button>
          {retryMessage && <small>{retryMessage}</small>}
          <a className="admin-secondary-button full" href="/1c-integration.md" download>Скачать спецификацию <Download size={16} /></a>
        </article>
      </div>
      <article className="admin-card sync-log">
        <div className="admin-card-head"><div><p className="eyebrow">Журнал</p><h2>{gatewayHealth?.synchronization.last_success_at ? "Последние операции" : "Операций пока не было"}</h2></div><Activity /></div>
        <div className="sync-log-list">
          {(gatewayHealth?.synchronization.recentErrors.length ?? 0) > 0 ? gatewayHealth?.synchronization.recentErrors.map((error) => <div key={`${error.entity_type}-${error.started_at}`}><span className="log-icon"><CloudCog /></span><p><strong>{error.entity_type}</strong><span>{error.error_summary || "Часть записей не обработана"}</span></p><time>{new Date(error.started_at).toLocaleString("ru-RU")}</time><b>{error.status}</b></div>) : <div><span className="log-icon"><CloudCog /></span><p><strong>Рабочих обменов еще не было</strong><span>После подключения журнал будет читаться из PostgreSQL.</span></p><time>—</time><b>—</b></div>}
        </div>
      </article>
    </>
  );
}

function SettingsSection() {
  const configurationIssues = validateBusinessConfig(businessConfig);
  const sellerName = getSellerDisplayName();

  return (
    <>
      <div className="admin-page-intro"><div><p className="eyebrow">Конфигурация</p><h1>Настройки магазина</h1><span>Единый источник данных: config/business.ts и переменные окружения.</span></div></div>
      <div className="settings-grid">
        <article className="admin-card settings-card"><div className="admin-card-head"><div><p className="eyebrow">Магазин</p><h2>Публичные данные</h2></div><Settings /></div><label><span>Бренд</span><input value={businessConfig.brandName} readOnly /></label><label><span>Продавец</span><input value={sellerName ?? ""} placeholder="Не заполнено — требуется до запуска" readOnly /></label><label><span>Телефон</span><input value={businessConfig.contacts.phone ?? ""} placeholder="Не заполнено — требуется до запуска" readOnly /></label><label><span>Email</span><input value={businessConfig.contacts.email ?? ""} placeholder="Не заполнено — требуется до запуска" readOnly /></label><label><span>Адрес</span><input value={businessConfig.location.address ?? ""} placeholder="Не заполнено — требуется до запуска" readOnly /></label><label><span>График</span><input value={businessConfig.workingHours ?? ""} placeholder="Не заполнено" readOnly /></label></article>
        <article className="admin-card settings-card"><div className="admin-card-head"><div><p className="eyebrow">Возможности</p><h2>Подтвержденные услуги</h2></div><Gauge /></div><label className="settings-switch"><span><strong>Самовывоз</strong><small>Включать только после согласования адреса и правил</small></span><input type="checkbox" checked={businessConfig.delivery.pickup.enabled} readOnly /></label><label className="settings-switch"><span><strong>Доставка по городу</strong><small>Стоимость не задана автоматически</small></span><input type="checkbox" checked={businessConfig.delivery.cityDelivery.enabled} readOnly /></label><label className="settings-switch"><span><strong>Б/у товары</strong><small>Для комплектов используются индивидуальные фото</small></span><input type="checkbox" checked={businessConfig.catalog.usedProductsEnabled} readOnly /></label><label className="settings-switch"><span><strong>Рассрочка</strong><small>Только после подключения реального провайдера</small></span><input type="checkbox" checked={businessConfig.features.installmentEnabled} readOnly /></label></article>
        <article className="admin-card settings-card"><div className="admin-card-head"><div><p className="eyebrow">До запуска</p><h2>{configurationIssues.length} пунктов требуют внимания</h2></div><Activity /></div>{configurationIssues.map((issue) => <p key={issue.field}><strong>{issue.field}</strong><br /><small>{issue.message}</small></p>)}</article>
      </div>
    </>
  );
}

export function AdminDashboard({ authorizedUser }: { authorizedUser: UserProfile }) {
  const { user: hydratedUser, logout } = useStore();
  const user = hydratedUser ?? authorizedUser;
  const [section, setSection] = useState<Section>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigation = useMemo(
    () => [
      { id: "overview" as Section, label: "Обзор", icon: LayoutDashboard },
      { id: "products" as Section, label: "Товары", icon: Package },
      { id: "orders" as Section, label: "Заказы", icon: ShoppingCart },
      { id: "fitment-requests" as Section, label: "Заявки на подбор", icon: Search },
      { id: "sync" as Section, label: "Обмен с 1С", icon: RefreshCw },
      { id: "settings" as Section, label: "Настройки", icon: Settings },
    ],
    [],
  );

  function navigate(value: Section) {
    setSection(value);
    setSidebarOpen(false);
  }

  return (
    <main className="admin-shell">
      <aside className={sidebarOpen ? "admin-sidebar open" : "admin-sidebar"}>
        <div className="admin-sidebar-brand"><span className="admin-brand-mark"><i /><i /><i /></span><strong>{businessConfig.brandName}</strong><small>CONTROL</small><button onClick={() => setSidebarOpen(false)}><X /></button></div>
        <nav>{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={19} /><span>{label}</span></button>)}</nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-sync-mini"><span><i />1С</span><strong>Не подключена</strong><small>Ожидает production-настройки</small></div>
          <Link href="/"><ArrowLeft size={17} /> В магазин</Link>
        </div>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar">
          <button className="admin-mobile-menu" onClick={() => setSidebarOpen(true)}><Menu /></button>
          <div className="admin-breadcrumb">{businessConfig.brandName} CONTROL <ChevronRight size={13} /> <strong>{navigation.find((item) => item.id === section)?.label}</strong></div>
          <div className="admin-topbar-actions">
            <button className="admin-sync-button" onClick={() => navigate("sync")}><RefreshCw size={16} /> <span>1С: настройка</span></button>
            <button className="admin-user-button"><span>{user.name.slice(0, 1)}</span><p><strong>{user.name}</strong><small>Администратор</small></p></button>
            <button className="admin-logout" onClick={logout} aria-label="Выйти"><LogOut size={18} /></button>
          </div>
        </header>
        <div className="admin-content">
          {section === "overview" && <Overview onNavigate={navigate} />}
          {section === "products" && <ProductsSection />}
          {section === "orders" && <OrdersSection />}
          {section === "fitment-requests" && <FitmentRequests />}
          {section === "sync" && <SyncSection />}
          {section === "settings" && <SettingsSection />}
        </div>
      </section>
    </main>
  );
}

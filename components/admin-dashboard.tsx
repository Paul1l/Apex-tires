"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Boxes,
  ChevronRight,
  CloudCog,
  Database,
  Download,
  FileJson,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { businessConfig } from "@/config/business";
import { validateBusinessConfig } from "@/config/business-validation";
import type { UserProfile } from "@/lib/types";
import { useStore } from "@/components/store-provider";
import { FitmentRequests } from "@/components/admin/fitment-requests";
import { OrdersSection } from "@/components/admin/orders-section";
import { ProductsSection } from "@/components/admin/products-section";
import { SettingsSection } from "@/components/admin/settings-section";
import { StaffSection } from "@/components/admin/staff-section";

type Section = "overview" | "products" | "orders" | "sync" | "settings" | "fitment-requests" | "staff";

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

export function AdminDashboard({ authorizedUser }: { authorizedUser: UserProfile }) {
  const { user: hydratedUser, logout } = useStore();
  const router = useRouter();
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
      { id: "staff" as Section, label: "Сотрудники", icon: Users },
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
            <button className="admin-logout" onClick={async () => {
              // Re-render the server page: without a session it shows the sign-in message
              // instead of the already loaded dashboard data.
              if (await logout()) router.refresh();
              else window.alert("Не удалось выйти. Проверьте соединение и попробуйте ещё раз.");
            }} aria-label="Выйти"><LogOut size={18} /></button>
          </div>
        </header>
        <div className="admin-content">
          {section === "overview" && <Overview onNavigate={navigate} />}
          {section === "products" && <ProductsSection />}
          {section === "orders" && <OrdersSection />}
          {section === "fitment-requests" && <FitmentRequests />}
          {section === "sync" && <SyncSection />}
          {section === "staff" && <StaffSection />}
          {section === "settings" && <SettingsSection />}
        </div>
      </section>
    </main>
  );
}

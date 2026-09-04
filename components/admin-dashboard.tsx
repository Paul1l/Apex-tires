"use client";

import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
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
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatPrice, seasonLabels } from "@/lib/catalog-data";
import { businessConfig, getSellerDisplayName } from "@/config/business";
import { validateBusinessConfig } from "@/config/business-validation";
import { INITIAL_CATALOG_CAPACITY } from "@/lib/store-config";
import type { Product, ProductKind, Season } from "@/lib/types";
import { useStore } from "@/components/store-provider";

type Section = "overview" | "products" | "orders" | "sync" | "settings";

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

const blankProduct: Product = {
  id: "",
  sku: "",
  kind: "tire",
  condition: "new",
  brand: "",
  model: "",
  subtitle: "",
  width: 225,
  profile: 45,
  diameter: 18,
  season: "summer",
  studded: false,
  runflat: false,
  price: 0,
  priceUpdatedAt: new Date().toISOString(),
  stock: 0,
  reserved: 0,
  warehouse: "",
  tags: [],
  country: "",
  compatibleCars: [],
  updatedAt: new Date().toISOString(),
};

function MiniArt({ product }: { product: Product }) {
  if (product.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className="admin-product-thumb image"><img src={product.image} alt="" /></span>;
  }
  return <span className={`admin-product-thumb ${product.kind}`}><i /><b /></span>;
}

function AdminLogin() {
  const { login } = useStore();
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await login(String(form.get("email")), String(form.get("password")));
    setMessage(result.message);
  }

  return (
    <main className="admin-login-page">
      <Link href="/" className="admin-back"><ArrowLeft size={17} /> Вернуться в магазин</Link>
      <section className="admin-login-card">
        <div className="admin-login-brand"><span className="admin-brand-mark"><i /><i /><i /></span><strong>{businessConfig.brandName}</strong><small>CONTROL</small></div>
        <p className="eyebrow">Закрытая зона</p>
        <h1>Управление магазином</h1>
        <p>Каталог, заказы, остатки и синхронизация с 1С в одном интерфейсе.</p>
        <form onSubmit={submit}>
          <label><span>Электронная почта</span><input type="email" name="email" autoComplete="username" required /></label>
          <label><span>Пароль</span><input type="password" name="password" autoComplete="current-password" required /></label>
          {message && <small className="admin-login-message">{message}</small>}
          <button className="admin-primary-button">Войти <ArrowRight size={17} /></button>
        </form>
        <small className="admin-security-note">Демо-доступ отключен. В production доступ будет защищен серверной сессией, ролями и журналом действий.</small>
      </section>
    </main>
  );
}

function ProductEditor({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const { saveProduct } = useStore();
  const [draft, setDraft] = useState<Product>(product);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function update<K extends keyof Product>(key: K, value: Product[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function readImage(file?: File) {
    if (!file) return;
    if (file.size > 2_500_000) {
      window.alert("Для предпросмотра используйте изображение до 2,5 МБ.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => update("image", String(reader.result));
    reader.readAsDataURL(file);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized: Product = {
      ...draft,
      id: draft.id || `${draft.kind}-${draft.brand}-${draft.model}-${crypto.randomUUID().slice(0, 6)}`.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-"),
      sku: draft.sku || `AW-${Date.now().toString().slice(-8)}`,
      externalId: draft.externalId || `LOCAL-${Date.now()}`,
      subtitle:
        draft.subtitle ||
        (draft.kind === "tire"
          ? `${draft.width}/${draft.profile} R${draft.diameter}`
          : `R${draft.diameter} ${draft.pcd || ""}`.trim()),
      updatedAt: new Date().toISOString(),
      priceUpdatedAt:
        draft.price === product.price
          ? draft.priceUpdatedAt
          : new Date().toISOString(),
    };
    saveProduct(normalized);
    setDraft(normalized);
    setSaved(true);
    window.setTimeout(onClose, 650);
  }

  return (
    <div className="admin-modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="admin-product-editor" onSubmit={submit}>
        <div className="admin-editor-head">
          <div><p className="eyebrow">{product.id ? "Редактирование" : "Новый товар"}</p><h2>{product.id ? `${product.brand} ${product.model}` : "Добавить в каталог"}</h2></div>
          <button type="button" onClick={onClose}><X /></button>
        </div>
        <div className="admin-editor-body">
          <div className="admin-image-uploader" onClick={() => fileRef.current?.click()}>
            {draft.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.image} alt="Превью товара" />
            ) : (
              <div><Upload /><strong>Добавить фото</strong><span>PNG, JPG или WebP · до 2,5 МБ</span></div>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => readImage(e.target.files?.[0])} hidden />
          </div>
          {draft.image && <button type="button" className="remove-image" onClick={() => update("image", undefined)}>Удалить изображение</button>}
          <div className="admin-form-grid">
            <label><span>Тип товара</span><select value={draft.kind} onChange={(e) => update("kind", e.target.value as ProductKind)}><option value="tire">Шина</option><option value="wheel">Диск</option></select></label>
            {businessConfig.catalog.usedProductsEnabled && <label><span>Состояние</span><select value={draft.condition} onChange={(e) => update("condition", e.target.value as Product["condition"])}><option value="new">Новый</option><option value="used">Б/у комплект</option></select></label>}
            <label><span>Артикул</span><input value={draft.sku} onChange={(e) => update("sku", e.target.value)} placeholder="Будет создан автоматически" /></label>
            <label><span>ID в 1С</span><input value={draft.externalId || ""} onChange={(e) => update("externalId", e.target.value)} placeholder="1C-000001" /></label>
            <label><span>Бренд *</span><input value={draft.brand} onChange={(e) => update("brand", e.target.value)} required /></label>
            <label><span>Модель *</span><input value={draft.model} onChange={(e) => update("model", e.target.value)} required /></label>
            <label className="wide"><span>Маркировка / подзаголовок</span><input value={draft.subtitle} onChange={(e) => update("subtitle", e.target.value)} placeholder="225/45 R18 95Y XL" /></label>
            {draft.kind === "tire" ? (
              <>
                <label><span>Ширина</span><input type="number" value={draft.width} onChange={(e) => update("width", Number(e.target.value))} /></label>
                <label><span>Профиль</span><input type="number" value={draft.profile} onChange={(e) => update("profile", Number(e.target.value))} /></label>
                <label><span>Диаметр</span><input type="number" value={draft.diameter} onChange={(e) => update("diameter", Number(e.target.value))} /></label>
                <label><span>Сезон</span><select value={draft.season} onChange={(e) => update("season", e.target.value as Season)}><option value="summer">Летние</option><option value="winter">Зимние</option><option value="all-season">Всесезонные</option></select></label>
              </>
            ) : (
              <>
                <label><span>Диаметр</span><input type="number" value={draft.diameter} onChange={(e) => update("diameter", Number(e.target.value))} /></label>
                <label><span>Разболтовка</span><input value={draft.pcd || ""} onChange={(e) => update("pcd", e.target.value)} placeholder="5×112" /></label>
                <label><span>Вылет ET</span><input type="number" value={draft.offset || 0} onChange={(e) => update("offset", Number(e.target.value))} /></label>
                <label><span>Цвет</span><input value={draft.color || ""} onChange={(e) => update("color", e.target.value)} /></label>
                <label><span>Тип диска</span><select value={draft.wheelType || "alloy"} onChange={(e) => update("wheelType", e.target.value as Product["wheelType"])}><option value="alloy">Литой</option><option value="steel">Штампованный</option><option value="other">Другой подтвержденный тип</option></select></label>
              </>
            )}
            <label><span>Цена, ₽ *</span><input type="number" min="0" value={draft.price} onChange={(e) => update("price", Number(e.target.value))} required /></label>
            <label><span>Старая цена, ₽</span><input type="number" min="0" value={draft.oldPrice || ""} onChange={(e) => update("oldPrice", e.target.value ? Number(e.target.value) : undefined)} /></label>
            <label><span>Остаток</span><input type="number" min="0" value={draft.stock} onChange={(e) => update("stock", Number(e.target.value))} /></label>
            <label><span>Резерв</span><input type="number" min="0" value={draft.reserved} onChange={(e) => update("reserved", Number(e.target.value))} /></label>
            <label><span>Склад</span><input value={draft.warehouse} onChange={(e) => update("warehouse", e.target.value)} placeholder="Название из 1С или БД" /></label>
            <label><span>Страна</span><input value={draft.country} onChange={(e) => update("country", e.target.value)} /></label>
            <label className="wide"><span>Совместимые модели — через запятую</span><input value={draft.compatibleCars.join(", ")} onChange={(e) => update("compatibleCars", e.target.value.split(",").map((value) => value.trim()).filter(Boolean))} placeholder="BMW 3 Series, Audi A4" /></label>
          </div>
          <div className="admin-toggle-row">
            <label><input type="checkbox" checked={draft.featured || false} onChange={(e) => update("featured", e.target.checked)} /> Рекомендуемый товар</label>
            {draft.kind === "tire" && <label><input type="checkbox" checked={draft.studded} onChange={(e) => update("studded", e.target.checked)} /> Шипованный</label>}
            {draft.kind === "tire" && <label><input type="checkbox" checked={draft.runflat} onChange={(e) => update("runflat", e.target.checked)} /> RunFlat</label>}
            {draft.kind === "tire" && <label><input type="checkbox" checked={draft.xl || false} onChange={(e) => update("xl", e.target.checked)} /> XL</label>}
          </div>
          {businessConfig.catalog.usedProductsEnabled && draft.condition === "used" && (
            <div className="admin-form-grid">
              <label><span>Год производства</span><input type="number" min="1900" max="2200" value={draft.manufactureYear || ""} onChange={(e) => update("manufactureYear", e.target.value ? Number(e.target.value) : undefined)} /></label>
              <label><span>Остаток протектора, мм</span><input type="number" min="0" step="0.1" value={draft.treadDepth || ""} onChange={(e) => update("treadDepth", e.target.value ? Number(e.target.value) : undefined)} /></label>
              <label><span>Количество в комплекте</span><input type="number" min="1" value={draft.setQuantity || ""} onChange={(e) => update("setQuantity", e.target.value ? Number(e.target.value) : undefined)} /></label>
              <label className="wide"><span>Ремонты и дефекты</span><input value={draft.defects || ""} onChange={(e) => update("defects", e.target.value)} placeholder="Указать фактическое состояние" /></label>
            </div>
          )}
        </div>
        <div className="admin-editor-footer">
          <button type="button" className="admin-secondary-button" onClick={onClose}>Отмена</button>
          <button className="admin-primary-button">{saved ? <><Check size={17} /> Сохранено</> : "Сохранить товар"}</button>
        </div>
      </form>
    </div>
  );
}

function Overview({ onNavigate }: { onNavigate: (section: Section) => void }) {
  const { products } = useStore();
  const configurationIssues = validateBusinessConfig(businessConfig);

  return (
    <>
      <div className="admin-page-intro">
        <div><p className="eyebrow">Production readiness</p><h1>Состояние магазина</h1><span>Только фактические данные и статусы подключений.</span></div>
        <button className="admin-primary-button" onClick={() => onNavigate("products")}><Plus size={17} /> Добавить товар</button>
      </div>
      <div className="admin-kpi-grid">
        <article><span className="admin-kpi-icon green"><Boxes /></span><div><p>Каталог</p><strong>{products.length}</strong><small>{businessConfig.catalog.dataMode === "database" ? "Источник: PostgreSQL" : "Демонстрационные позиции"}</small></div></article>
        <article><span className="admin-kpi-icon sand"><ShoppingCart /></span><div><p>Заказы</p><strong>—</strong><small>Появятся после подключения PostgreSQL</small></div></article>
        <article><span className="admin-kpi-icon blue"><Database /></span><div><p>Бизнес-данные</p><strong>{configurationIssues.length === 0 ? "Готово" : `${configurationIssues.length} полей`}</strong><small>{configurationIssues.length === 0 ? "Конфигурация заполнена" : "Требуют заполнения"}</small></div></article>
        <article><span className="admin-kpi-icon violet"><Activity /></span><div><p>Режим</p><strong>{businessConfig.deploymentStage === "production" ? "Production" : "Preview"}</strong><small>Без вымышленных показателей</small></div></article>
      </div>
      <article className="admin-card recent-orders"><div className="admin-card-head"><div><p className="eyebrow">Заказы</p><h2>Рабочих данных пока нет</h2></div><button onClick={() => onNavigate("orders")}>Открыть раздел <ChevronRight size={16} /></button></div><p>После подключения PostgreSQL здесь будут отображаться реальные заказы. Демонстрационные покупатели и суммы удалены.</p></article>
    </>
  );
}

function ProductsSection({ onEdit }: { onEdit: (product: Product) => void }) {
  const { products, deleteProduct, resetProducts } = useStore();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | ProductKind>("all");
  const availablePreparedPositions = Math.max(
    INITIAL_CATALOG_CAPACITY - products.length,
    0,
  );
  const visible = products.filter((product) => {
    if (kind !== "all" && product.kind !== kind) return false;
    const haystack = `${product.brand} ${product.model} ${product.sku}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  return (
    <>
      <div className="admin-page-intro">
        <div><p className="eyebrow">Управление каталогом</p><h1>Товары</h1><span>{products.length} из {INITIAL_CATALOG_CAPACITY} подготовленных позиций · изменения сохраняются сразу</span></div>
        <button className="admin-primary-button" onClick={() => onEdit({ ...blankProduct })}><Plus size={17} /> Добавить товар</button>
      </div>
      <article className="admin-card products-card">
        <div className="admin-products-toolbar">
          <label className="admin-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, бренд или артикул" /></label>
          <div className="admin-segmented"><button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>Все</button><button className={kind === "tire" ? "active" : ""} onClick={() => setKind("tire")}>Шины</button><button className={kind === "wheel" ? "active" : ""} onClick={() => setKind("wheel")}>Диски</button></div>
          <button className="admin-secondary-button" onClick={() => {
            const blob = new Blob([JSON.stringify(products, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "apex-products.json";
            link.click();
            URL.revokeObjectURL(url);
          }}><Download size={16} /> Экспорт JSON</button>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table products-table">
            <thead><tr><th>Товар</th><th>Тип / сезон</th><th>Цена</th><th>Доступно</th><th>1С ID</th><th>Обновлён</th><th /></tr></thead>
            <tbody>{visible.map((product) => (
              <tr key={product.id}>
                <td><div className="admin-product-cell"><MiniArt product={product} /><p><strong>{product.brand} {product.model}</strong><span>{product.subtitle}</span><small>{product.sku}</small></p></div></td>
                <td>{product.kind === "tire" ? <><strong>Шина</strong><small>{seasonLabels[product.season]}</small></> : <><strong>Диск</strong><small>{product.color}</small></>}</td>
                <td><strong>{formatPrice(product.price)}</strong>{product.oldPrice && <small><s>{formatPrice(product.oldPrice)}</s></small>}</td>
                <td><span className={`inventory-pill ${product.stock - product.reserved <= 6 ? "low" : ""}`}>{product.stock - product.reserved} шт.</span><small>резерв {product.reserved}</small></td>
                <td><code>{product.externalId || "—"}</code></td>
                <td><span>{new Date(product.updatedAt).toLocaleDateString("ru-RU")}</span><small>{new Date(product.updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</small></td>
                <td><div className="admin-row-actions"><button onClick={() => onEdit(product)} aria-label="Редактировать"><Pencil size={16} /></button><button className="danger" onClick={() => { if (window.confirm(`Удалить ${product.brand} ${product.model}?`)) deleteProduct(product.id); }} aria-label="Удалить"><Trash2 size={16} /></button></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {visible.length === 0 && <div className="admin-empty"><Search /><strong>Товары не найдены</strong><span>Измените запрос или фильтр.</span></div>}
        <div className="admin-table-footer"><span>Показано {visible.length} из {products.length} · свободно {availablePreparedPositions} из {INITIAL_CATALOG_CAPACITY}</span><button onClick={() => { if (window.confirm("Вернуть исходный демо-каталог?")) resetProducts(); }}>Восстановить демо-данные</button></div>
      </article>
    </>
  );
}

function OrdersSection() {
  return (
    <>
      <div className="admin-page-intro"><div><p className="eyebrow">Продажи</p><h1>Заказы</h1><span>Раздел подготовлен к чтению заказов из PostgreSQL.</span></div></div>
      <article className="admin-card admin-empty"><ShoppingCart /><strong>Реальных заказов пока нет</strong><span>Демонстрационные имена, суммы и статусы удалены. После подключения защищенного admin API здесь появятся только заказы из базы данных.</span></article>
    </>
  );
}

function SyncSection() {
  const [gatewayHealth, setGatewayHealth] =
    useState<OneCGatewayHealth | null>(null);
  const [gatewayCheckFailed, setGatewayCheckFailed] = useState(false);
  const [gatewayCheckInProgress, setGatewayCheckInProgress] = useState(false);

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
          <button className="admin-secondary-button full" type="button" disabled title="Кнопка станет активной после подключения production-авторизации администратора"><RefreshCw size={16} /> Повторить неудачные отправки</button>
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

export function AdminDashboard() {
  const { user, logout } = useStore();
  const [section, setSection] = useState<Section>("overview");
  const [editor, setEditor] = useState<Product | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigation = useMemo(
    () => [
      { id: "overview" as Section, label: "Обзор", icon: LayoutDashboard },
      { id: "products" as Section, label: "Товары", icon: Package },
      { id: "orders" as Section, label: "Заказы", icon: ShoppingCart },
      { id: "sync" as Section, label: "Обмен с 1С", icon: RefreshCw },
      { id: "settings" as Section, label: "Настройки", icon: Settings },
    ],
    [],
  );

  if (!user || user.role !== "admin") return <AdminLogin />;

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
          {section === "products" && <ProductsSection onEdit={setEditor} />}
          {section === "orders" && <OrdersSection />}
          {section === "sync" && <SyncSection />}
          {section === "settings" && <SettingsSection />}
        </div>
      </section>
      {editor && <ProductEditor product={editor} onClose={() => setEditor(null)} />}
    </main>
  );
}

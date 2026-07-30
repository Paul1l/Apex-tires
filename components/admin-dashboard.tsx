"use client";

import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  ChevronRight,
  CircleDollarSign,
  CloudCog,
  Database,
  Download,
  Eye,
  FileJson,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useRef, useState } from "react";
import { formatPrice, seasonLabels, seedProducts } from "@/lib/catalog-data";
import type { Product, ProductKind, Season } from "@/lib/types";
import { useStore } from "@/components/store-provider";

type Section = "overview" | "products" | "orders" | "sync" | "settings";

const blankProduct: Product = {
  id: "",
  sku: "",
  kind: "tire",
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
  stock: 0,
  reserved: 0,
  warehouse: "Москва · Север",
  rating: 5,
  reviews: 0,
  tags: [],
  country: "",
  compatibleCars: [],
  updatedAt: new Date().toISOString(),
};

const demoOrders = [
  { id: "AW-10482", customer: "Андрей Волков", date: "30 июл, 10:24", amount: 73960, status: "Новый", items: "Michelin Pilot Sport 5 × 4" },
  { id: "AW-10481", customer: "Мария Орлова", date: "30 июл, 09:41", amount: 87560, status: "Комплектуется", items: "Rial Lucca × 4" },
  { id: "AW-10480", customer: "Илья Смирнов", date: "29 июл, 18:12", amount: 51560, status: "Доставлен", items: "Continental PremiumContact 7 × 4" },
  { id: "AW-10479", customer: "Никита Павлов", date: "29 июл, 15:03", amount: 67960, status: "Доставлен", items: "Ikon Hakkapeliitta 10 × 4" },
  { id: "AW-10478", customer: "Елена Коваль", date: "29 июл, 11:37", amount: 89960, status: "Отменён", items: "Goodyear Eagle F1 × 4" },
];

function MiniArt({ product }: { product: Product }) {
  if (product.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className="admin-product-thumb image"><img src={product.image} alt="" /></span>;
  }
  return <span className={`admin-product-thumb ${product.kind}`}><i /><b /></span>;
}

function AdminLogin() {
  const { login, loginAsDemoAdmin } = useStore();
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
        <div className="admin-login-brand"><span className="admin-brand-mark"><i /><i /><i /></span><strong>APEX</strong><small>CONTROL</small></div>
        <p className="eyebrow">Закрытая зона</p>
        <h1>Управление магазином</h1>
        <p>Каталог, заказы, остатки и синхронизация с 1С в одном интерфейсе.</p>
        <form onSubmit={submit}>
          <label><span>Электронная почта</span><input type="email" name="email" defaultValue="admin@apex.local" required /></label>
          <label><span>Пароль</span><input type="password" name="password" defaultValue="Apex2026!" required /></label>
          {message && <small className="admin-login-message">{message}</small>}
          <button className="admin-primary-button">Войти <ArrowRight size={17} /></button>
        </form>
        <button className="admin-demo-login" onClick={loginAsDemoAdmin}><Sparkles size={16} /> Быстрый вход в демо</button>
        <small className="admin-security-note">В production доступ защищается серверной сессией и ролями.</small>
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
      window.alert("Для демо используйте изображение до 2,5 МБ.");
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
              </>
            )}
            <label><span>Цена, ₽ *</span><input type="number" min="0" value={draft.price} onChange={(e) => update("price", Number(e.target.value))} required /></label>
            <label><span>Старая цена, ₽</span><input type="number" min="0" value={draft.oldPrice || ""} onChange={(e) => update("oldPrice", e.target.value ? Number(e.target.value) : undefined)} /></label>
            <label><span>Остаток</span><input type="number" min="0" value={draft.stock} onChange={(e) => update("stock", Number(e.target.value))} /></label>
            <label><span>Резерв</span><input type="number" min="0" value={draft.reserved} onChange={(e) => update("reserved", Number(e.target.value))} /></label>
            <label><span>Склад</span><select value={draft.warehouse} onChange={(e) => update("warehouse", e.target.value)}><option>Москва · Север</option><option>Москва · Юг</option><option>Москва · Запад</option></select></label>
            <label><span>Страна</span><input value={draft.country} onChange={(e) => update("country", e.target.value)} /></label>
            <label className="wide"><span>Совместимые модели — через запятую</span><input value={draft.compatibleCars.join(", ")} onChange={(e) => update("compatibleCars", e.target.value.split(",").map((value) => value.trim()).filter(Boolean))} placeholder="BMW 3 Series, Audi A4" /></label>
          </div>
          <div className="admin-toggle-row">
            <label><input type="checkbox" checked={draft.featured || false} onChange={(e) => update("featured", e.target.checked)} /> Рекомендуемый товар</label>
            {draft.kind === "tire" && <label><input type="checkbox" checked={draft.studded} onChange={(e) => update("studded", e.target.checked)} /> Шипованный</label>}
            {draft.kind === "tire" && <label><input type="checkbox" checked={draft.runflat} onChange={(e) => update("runflat", e.target.checked)} /> RunFlat</label>}
          </div>
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
  const totalStock = products.reduce((sum, item) => sum + item.stock - item.reserved, 0);
  const inventoryValue = products.reduce((sum, item) => sum + item.price * Math.max(0, item.stock - item.reserved), 0);
  const lowStock = products.filter((item) => item.stock - item.reserved <= 6);
  const bars = [42, 55, 39, 64, 58, 72, 61, 79, 68, 86, 74, 92];

  return (
    <>
      <div className="admin-page-intro">
        <div><p className="eyebrow">30 июля 2026</p><h1>Добрый день, Александр</h1><span>Вот что происходит в магазине прямо сейчас.</span></div>
        <button className="admin-primary-button" onClick={() => onNavigate("products")}><Plus size={17} /> Добавить товар</button>
      </div>
      <div className="admin-kpi-grid">
        <article><span className="admin-kpi-icon green"><CircleDollarSign /></span><div><p>Продажи за месяц</p><strong>3 842 760 ₽</strong><small className="positive"><TrendingUp size={13} /> 12,8% к июню</small></div></article>
        <article><span className="admin-kpi-icon sand"><ShoppingCart /></span><div><p>Заказы</p><strong>184</strong><small>23 требуют внимания</small></div></article>
        <article><span className="admin-kpi-icon blue"><Boxes /></span><div><p>Остаток на складах</p><strong>{totalStock} шт.</strong><small>{formatPrice(inventoryValue)} в товарах</small></div></article>
        <article><span className="admin-kpi-icon violet"><Users /></span><div><p>Новые клиенты</p><strong>96</strong><small className="positive"><TrendingUp size={13} /> 8,4% за месяц</small></div></article>
      </div>
      <div className="admin-dashboard-grid">
        <article className="admin-card sales-card">
          <div className="admin-card-head"><div><p className="eyebrow">Динамика продаж</p><h2>1 284 900 ₽ <small>за 14 дней</small></h2></div><select defaultValue="14"><option value="14">14 дней</option><option value="30">30 дней</option></select></div>
          <div className="sales-chart">
            <div className="chart-y"><span>120k</span><span>80k</span><span>40k</span><span>0</span></div>
            <div className="chart-bars">{bars.map((height, index) => <span key={index} style={{ height: `${height}%` }}><i>{index === 11 ? "112k" : ""}</i></span>)}</div>
          </div>
          <div className="chart-labels"><span>17 июл</span><span>21 июл</span><span>25 июл</span><span>30 июл</span></div>
        </article>
        <article className="admin-card stock-alerts">
          <div className="admin-card-head"><div><p className="eyebrow">Контроль остатков</p><h2>Заканчиваются</h2></div><button onClick={() => onNavigate("products")}>Все товары <ChevronRight size={16} /></button></div>
          <div className="stock-alert-list">
            {lowStock.slice(0, 4).map((product) => (
              <div key={product.id}><MiniArt product={product} /><p><strong>{product.brand} {product.model}</strong><span>{product.subtitle}</span></p><b className={product.stock - product.reserved <= 4 ? "critical" : ""}>{product.stock - product.reserved} шт.</b></div>
            ))}
          </div>
        </article>
      </div>
      <article className="admin-card recent-orders">
        <div className="admin-card-head"><div><p className="eyebrow">Операции</p><h2>Последние заказы</h2></div><button onClick={() => onNavigate("orders")}>Смотреть все <ChevronRight size={16} /></button></div>
        <div className="admin-table-wrap">
          <table className="admin-table"><thead><tr><th>Заказ</th><th>Клиент</th><th>Состав</th><th>Сумма</th><th>Статус</th><th /></tr></thead><tbody>
            {demoOrders.slice(0, 4).map((order) => <tr key={order.id}><td><strong>{order.id}</strong><small>{order.date}</small></td><td>{order.customer}</td><td>{order.items}</td><td><strong>{formatPrice(order.amount)}</strong></td><td><span className={`order-status ${order.status.toLowerCase()}`}>{order.status}</span></td><td><button><Eye size={17} /></button></td></tr>)}
          </tbody></table>
        </div>
      </article>
    </>
  );
}

function ProductsSection({ onEdit }: { onEdit: (product: Product) => void }) {
  const { products, deleteProduct, resetProducts } = useStore();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | ProductKind>("all");
  const visible = products.filter((product) => {
    if (kind !== "all" && product.kind !== kind) return false;
    const haystack = `${product.brand} ${product.model} ${product.sku}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  return (
    <>
      <div className="admin-page-intro">
        <div><p className="eyebrow">Управление каталогом</p><h1>Товары</h1><span>{products.length} позиций · изменения сохраняются сразу</span></div>
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
                <td><span>30.07.2026</span><small>11:42</small></td>
                <td><div className="admin-row-actions"><button onClick={() => onEdit(product)} aria-label="Редактировать"><Pencil size={16} /></button><button className="danger" onClick={() => { if (window.confirm(`Удалить ${product.brand} ${product.model}?`)) deleteProduct(product.id); }} aria-label="Удалить"><Trash2 size={16} /></button></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {visible.length === 0 && <div className="admin-empty"><Search /><strong>Товары не найдены</strong><span>Измените запрос или фильтр.</span></div>}
        <div className="admin-table-footer"><span>Показано {visible.length} из {products.length}</span><button onClick={() => { if (window.confirm("Вернуть исходный демо-каталог?")) resetProducts(); }}>Восстановить демо-данные</button></div>
      </article>
    </>
  );
}

function OrdersSection() {
  return (
    <>
      <div className="admin-page-intro"><div><p className="eyebrow">Продажи</p><h1>Заказы</h1><span>Обработка, статусы и выгрузка в 1С</span></div><button className="admin-secondary-button"><Download size={16} /> Выгрузить CSV</button></div>
      <div className="admin-order-stats"><span><b>2</b> новых</span><span><b>6</b> комплектуются</span><span><b>9</b> в доставке</span><span><b>167</b> завершено за месяц</span></div>
      <article className="admin-card">
        <div className="admin-products-toolbar"><label className="admin-search"><Search size={17} /><input placeholder="Номер заказа или клиент" /></label><select><option>Все статусы</option><option>Новый</option><option>Комплектуется</option><option>Доставлен</option></select></div>
        <div className="admin-table-wrap"><table className="admin-table orders-table"><thead><tr><th>Заказ</th><th>Клиент</th><th>Состав</th><th>Сумма</th><th>Статус</th><th>Канал</th><th /></tr></thead><tbody>
          {demoOrders.map((order) => <tr key={order.id}><td><strong>{order.id}</strong><small>{order.date}</small></td><td><strong>{order.customer}</strong><small>+7 9•• •••-••-••</small></td><td>{order.items}</td><td><strong>{formatPrice(order.amount)}</strong></td><td><select className={`status-select ${order.status.toLowerCase()}`} defaultValue={order.status}><option>Новый</option><option>Комплектуется</option><option>В доставке</option><option>Доставлен</option><option>Отменён</option></select></td><td><span className="channel-pill">Сайт</span></td><td><button><ChevronRight size={17} /></button></td></tr>)}
        </tbody></table></div>
      </article>
    </>
  );
}

function SyncSection() {
  const { saveProduct } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState("");

  function importJson(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const value = JSON.parse(String(reader.result));
        if (!Array.isArray(value)) throw new Error("Ожидался массив товаров");
        let count = 0;
        value.forEach((item) => {
          if (item?.id && item?.brand && item?.model && typeof item?.price === "number") {
            saveProduct({ ...blankProduct, ...item, updatedAt: new Date().toISOString() });
            count += 1;
          }
        });
        setImportMessage(`Импортировано: ${count} позиций`);
      } catch {
        setImportMessage("Файл не соответствует формату каталога");
      }
    };
    reader.readAsText(file);
  }

  return (
    <>
      <div className="admin-page-intro"><div><p className="eyebrow">Интеграции</p><h1>Обмен с 1С</h1><span>Импорт номенклатуры, цен и остатков. Экспорт заказов.</span></div><button className="admin-primary-button"><RefreshCw size={16} /> Запустить обмен</button></div>
      <div className="sync-status-card">
        <div className="sync-orbit"><CloudCog /><span /></div>
        <div><p className="eyebrow">Статус шлюза</p><h2>Контур подготовлен</h2><p>API доступен, схема данных версионирована. Для production задайте secret <code>ONEC_SHARED_SECRET</code> и подключите D1.</p></div>
        <span className="sync-ready"><i /> Ожидает настройки</span>
      </div>
      <div className="sync-grid">
        <article className="admin-card">
          <div className="admin-card-head"><div><p className="eyebrow">API endpoints</p><h2>HTTP JSON</h2></div><Database /></div>
          <div className="endpoint-list">
            <div><span className="method get">GET</span><code>/api/1c/health</code><small>Проверка доступности</small></div>
            <div><span className="method post">POST</span><code>/api/1c/import/products</code><small>Номенклатура и свойства</small></div>
            <div><span className="method post">POST</span><code>/api/1c/import/stock-prices</code><small>Цены и остатки</small></div>
            <div><span className="method get">GET</span><code>/api/1c/orders/export</code><small>Новые заказы для 1С</small></div>
          </div>
          <div className="token-note"><strong>Авторизация</strong><code>X-1C-Token: ••••••••••••</code><span>Токен хранится как secret, не в коде.</span></div>
        </article>
        <article className="admin-card">
          <div className="admin-card-head"><div><p className="eyebrow">Ручной обмен</p><h2>Импорт JSON</h2></div><FileJson /></div>
          <button className="json-dropzone" onClick={() => fileRef.current?.click()}><Upload /><strong>Выберите файл каталога</strong><span>Массив товаров в формате API v1</span></button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
          {importMessage && <p className="import-message">{importMessage}</p>}
          <a className="admin-secondary-button full" href="/1c-integration.md" download>Скачать спецификацию <Download size={16} /></a>
        </article>
      </div>
      <article className="admin-card sync-log">
        <div className="admin-card-head"><div><p className="eyebrow">Журнал</p><h2>Последние операции</h2></div><Activity /></div>
        <div className="sync-log-list">
          <div><span className="log-icon success"><Check /></span><p><strong>Импорт товаров</strong><span>1 248 позиций · создано 12 · обновлено 1 236</span></p><time>Сегодня, 08:00</time><b>42 сек.</b></div>
          <div><span className="log-icon success"><Check /></span><p><strong>Цены и остатки</strong><span>3 склада · 2 486 записей</span></p><time>Сегодня, 08:01</time><b>18 сек.</b></div>
          <div><span className="log-icon success"><Check /></span><p><strong>Экспорт заказов</strong><span>18 заказов передано в 1С</span></p><time>Вчера, 22:00</time><b>6 сек.</b></div>
        </div>
      </article>
    </>
  );
}

function SettingsSection() {
  return (
    <>
      <div className="admin-page-intro"><div><p className="eyebrow">Конфигурация</p><h1>Настройки</h1><span>Основные параметры магазина и уведомлений</span></div><button className="admin-primary-button"><Check size={17} /> Сохранить</button></div>
      <div className="settings-grid">
        <article className="admin-card settings-card"><div className="admin-card-head"><div><p className="eyebrow">Магазин</p><h2>Общие данные</h2></div><Settings /></div><label><span>Название</span><input defaultValue="APEX WHEELS" /></label><label><span>Телефон</span><input defaultValue="8 800 550-98-87" /></label><label><span>Электронная почта</span><input defaultValue="hello@apex-wheels.ru" /></label><label><span>Город по умолчанию</span><select defaultValue="Москва"><option>Москва</option><option>Санкт-Петербург</option></select></label></article>
        <article className="admin-card settings-card"><div className="admin-card-head"><div><p className="eyebrow">Заказы</p><h2>Бизнес-правила</h2></div><Gauge /></div><label><span>Бесплатная доставка от, ₽</span><input type="number" defaultValue="40000" /></label><label><span>Резерв товара, часов</span><input type="number" defaultValue="24" /></label><label className="settings-switch"><span><strong>Проверка совместимости</strong><small>Блокировать отгрузку до подтверждения</small></span><input type="checkbox" defaultChecked /></label><label className="settings-switch"><span><strong>Экспорт заказов в 1С</strong><small>Автоматически каждые 15 минут</small></span><input type="checkbox" defaultChecked /></label></article>
      </div>
    </>
  );
}

export function AdminDashboard() {
  const { user, logout } = useStore();
  const [section, setSection] = useState<Section>("overview");
  const [editor, setEditor] = useState<Product | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const navigation = useMemo(
    () => [
      { id: "overview" as Section, label: "Обзор", icon: LayoutDashboard },
      { id: "products" as Section, label: "Товары", icon: Package },
      { id: "orders" as Section, label: "Заказы", icon: ShoppingCart, badge: 2 },
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
        <div className="admin-sidebar-brand"><span className="admin-brand-mark"><i /><i /><i /></span><strong>APEX</strong><small>CONTROL</small><button onClick={() => setSidebarOpen(false)}><X /></button></div>
        <nav>{navigation.map(({ id, label, icon: Icon, badge }) => <button key={id} className={section === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={19} /><span>{label}</span>{badge && <b>{badge}</b>}</button>)}</nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-sync-mini"><span><i />1С</span><strong>Синхронизировано</strong><small>сегодня в 08:01</small></div>
          <Link href="/"><ArrowLeft size={17} /> В магазин</Link>
        </div>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar">
          <button className="admin-mobile-menu" onClick={() => setSidebarOpen(true)}><Menu /></button>
          <div className="admin-breadcrumb">APEX CONTROL <ChevronRight size={13} /> <strong>{navigation.find((item) => item.id === section)?.label}</strong></div>
          <div className="admin-topbar-actions">
            <button className="admin-sync-button" onClick={() => { setNotice("Синхронизация поставлена в очередь"); setTimeout(() => setNotice(""), 2500); }}><RefreshCw size={16} /> <span>1С: 08:01</span></button>
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
      {notice && <div className="admin-toast"><RefreshCw size={16} /> {notice}</div>}
    </main>
  );
}

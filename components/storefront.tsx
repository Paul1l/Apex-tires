"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  CircleUserRound,
  GitCompareArrows,
  Heart,
  MapPin,
  Menu,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { carCatalog, formatPrice, seasonLabels } from "@/lib/catalog-data";
import type { CatalogFilters, Product, ProductKind, Season } from "@/lib/types";
import { useStore } from "@/components/store-provider";

const initialFilters: CatalogFilters = {
  kind: "all",
  seasons: [],
  brands: [],
  width: "",
  profile: "",
  diameter: "",
  minPrice: 0,
  maxPrice: 60000,
  inStock: true,
  studded: false,
  runflat: false,
  carModel: "",
  query: "",
  sort: "popular",
};

function ProductArt({ product, compact = false }: { product: Product; compact?: boolean }) {
  if (product.image) {
    return (
      <div className={`product-art uploaded ${compact ? "compact" : ""}`}>
        {/* User-uploaded data URL or configured CDN URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={product.image} alt={`${product.brand} ${product.model}`} />
      </div>
    );
  }

  return (
    <div className={`product-art ${product.kind} ${compact ? "compact" : ""}`} aria-hidden="true">
      <span className="art-shadow" />
      <span className="art-wheel">
        <span className="art-rim">
          {Array.from({ length: product.kind === "wheel" ? 8 : 6 }).map((_, index) => (
            <i key={index} style={{ transform: `rotate(${index * (360 / (product.kind === "wheel" ? 8 : 6))}deg)` }} />
          ))}
          <b />
        </span>
      </span>
      <span className="art-caption">{product.kind === "tire" ? "TYRE" : "WHEEL"}</span>
    </div>
  );
}

function ProductCard({
  product,
  onQuickView,
  notify,
}: {
  product: Product;
  onQuickView: (product: Product) => void;
  notify: (message: string) => void;
}) {
  const {
    addToCart,
    favorites,
    compare,
    toggleFavorite,
    toggleCompare,
    cart,
  } = useStore();
  const inCart = cart.some((line) => line.productId === product.id);
  const favorite = favorites.includes(product.id);
  const compared = compare.includes(product.id);

  return (
    <article className="product-card">
      <div className="product-card-top">
        <div className="product-tags">
          {product.oldPrice && <span className="tag sale">−{Math.round((1 - product.price / product.oldPrice) * 100)}%</span>}
          {product.tags.slice(0, 1).map((tag) => (
            <span className="tag" key={tag}>{tag}</span>
          ))}
        </div>
        <div className="product-actions">
          <button
            className={compared ? "active" : ""}
            aria-label="Добавить к сравнению"
            onClick={() => {
              toggleCompare(product.id);
              notify(compared ? "Убрано из сравнения" : "Добавлено к сравнению");
            }}
          >
            <GitCompareArrows size={17} />
          </button>
          <button
            className={favorite ? "active" : ""}
            aria-label="Добавить в избранное"
            onClick={() => toggleFavorite(product.id)}
          >
            <Heart size={17} fill={favorite ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
      <button className="product-visual-button" onClick={() => onQuickView(product)} aria-label="Быстрый просмотр">
        <ProductArt product={product} />
      </button>
      <div className="product-copy">
        <div className="product-meta">
          <span>{product.kind === "tire" ? seasonLabels[product.season] : product.color}</span>
          <span className="rating"><Star size={13} fill="currentColor" /> {product.rating}</span>
        </div>
        <button className="product-title" onClick={() => onQuickView(product)}>
          <strong>{product.brand}</strong> {product.model}
        </button>
        <p className="product-size">{product.subtitle}</p>
        <div className="stock-line">
          <span className={product.stock > product.reserved ? "stock-dot" : "stock-dot empty"} />
          {product.stock > product.reserved ? `В наличии · ${product.stock - product.reserved} шт.` : "Под заказ"}
        </div>
        <div className="product-buy-row">
          <div className="price-block">
            <strong>{formatPrice(product.price)}</strong>
            {product.oldPrice && <del>{formatPrice(product.oldPrice)}</del>}
          </div>
          <button
            className={inCart ? "bag-button added" : "bag-button"}
            onClick={() => {
              addToCart(product.id);
              notify(inCart ? "Количество обновлено" : "Товар добавлен в корзину");
            }}
            aria-label="Добавить в корзину"
          >
            {inCart ? <Check size={19} /> : <ShoppingBag size={19} />}
          </button>
        </div>
        <p className="split-pay">от {formatPrice(Math.ceil(product.price / 4))} × 4 платежа</p>
      </div>
    </article>
  );
}

function Overlay({
  open,
  onClose,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={`overlay ${className}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      {children}
    </div>
  );
}

function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { login, register, loginAsDemoAdmin } = useStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "");
    const password = String(data.get("password") || "");
    const result =
      mode === "login"
        ? await login(email, password)
        : await register(String(data.get("name") || ""), email, password);
    setBusy(false);
    setMessage(result.message);
    if (result.ok) setTimeout(onClose, 450);
  }

  return (
    <Overlay open={open} onClose={onClose} className="modal-overlay">
      <section className="modal auth-modal">
        <button className="modal-close" onClick={onClose} aria-label="Закрыть"><X /></button>
        <div className="auth-brand">
          <span className="logo-mark small"><i /><i /><i /></span>
          APEX
        </div>
        <p className="eyebrow">{mode === "login" ? "С возвращением" : "Новый аккаунт"}</p>
        <h2>{mode === "login" ? "Войти в кабинет" : "Создать аккаунт"}</h2>
        <p className="muted">Сохраняйте автомобили, заказы и персональные подборки.</p>
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Вход</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Регистрация</button>
        </div>
        <form onSubmit={submit} className="stack-form">
          {mode === "register" && (
            <label>
              <span>Имя</span>
              <input name="name" required minLength={2} placeholder="Алексей" />
            </label>
          )}
          <label>
            <span>Электронная почта</span>
            <input name="email" type="email" required placeholder="name@example.ru" />
          </label>
          <label>
            <span>Пароль</span>
            <input name="password" type="password" required minLength={6} placeholder="Не менее 6 символов" />
          </label>
          {message && <p className="form-message">{message}</p>}
          <button className="primary-button full" disabled={busy}>
            {busy ? "Проверяем…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
          </button>
        </form>
        <button
          className="demo-admin-button"
          onClick={() => {
            loginAsDemoAdmin();
            onClose();
          }}
        >
          <Sparkles size={16} /> Войти в демо-админку
        </button>
        <p className="privacy-note">Продолжая, вы соглашаетесь с политикой конфиденциальности.</p>
      </section>
    </Overlay>
  );
}

function CartDrawer({ open, onClose, notify }: { open: boolean; onClose: () => void; notify: (m: string) => void }) {
  const { cart, products, setCartQuantity, clearCart, user } = useStore();
  const [ordered, setOrdered] = useState(false);
  const lines = cart
    .map((line) => ({ ...line, product: products.find((item) => item.id === line.productId) }))
    .filter((line): line is typeof line & { product: Product } => Boolean(line.product));
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  useEffect(() => {
    if (!open) setOrdered(false);
  }, [open]);

  return (
    <Overlay open={open} onClose={onClose} className="drawer-overlay">
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Ваш заказ</p>
            <h2>Корзина <span>{lines.length}</span></h2>
          </div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>
        {ordered ? (
          <div className="success-state">
            <span><Check size={30} /></span>
            <h3>Заказ принят</h3>
            <p>Менеджер проверит совместимость и свяжется с вами в течение 15 минут.</p>
            <button className="primary-button" onClick={onClose}>Вернуться в каталог</button>
          </div>
        ) : lines.length === 0 ? (
          <div className="empty-state">
            <ShoppingBag size={34} />
            <h3>Корзина пока пуста</h3>
            <p>Подберите комплект — мы бесплатно проверим совместимость.</p>
            <button className="primary-button" onClick={onClose}>Перейти к товарам</button>
          </div>
        ) : (
          <>
            <div className="drawer-lines">
              {lines.map(({ product, quantity }) => (
                <div className="cart-line" key={product.id}>
                  <ProductArt product={product} compact />
                  <div className="cart-line-copy">
                    <strong>{product.brand} {product.model}</strong>
                    <span>{product.subtitle}</span>
                    <div className="quantity">
                      <button onClick={() => setCartQuantity(product.id, quantity - 1)}><Minus size={14} /></button>
                      <b>{quantity}</b>
                      <button onClick={() => setCartQuantity(product.id, quantity + 1)}><Plus size={14} /></button>
                    </div>
                  </div>
                  <div className="cart-line-price">
                    <strong>{formatPrice(product.price * quantity)}</strong>
                    <button onClick={() => setCartQuantity(product.id, 0)}>Удалить</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="drawer-summary">
              <div><span>Товары</span><strong>{formatPrice(total)}</strong></div>
              <div><span>Доставка по Москве</span><strong className="accent-text">Бесплатно</strong></div>
              <div className="summary-total"><span>Итого</span><strong>{formatPrice(total)}</strong></div>
              {!user && <p className="summary-hint">Можно оформить без регистрации. Аккаунт пригодится для истории заказов.</p>}
              <button
                className="primary-button full"
                onClick={() => {
                  setOrdered(true);
                  clearCart();
                  notify("Заказ передан менеджеру");
                }}
              >
                Оформить заказ <ArrowRight size={17} />
              </button>
              <button className="clear-button" onClick={clearCart}>Очистить корзину</button>
            </div>
          </>
        )}
      </aside>
    </Overlay>
  );
}

function QuickView({ product, onClose, notify }: { product: Product | null; onClose: () => void; notify: (m: string) => void }) {
  const { addToCart, favorites, toggleFavorite } = useStore();
  if (!product) return null;
  const favorite = favorites.includes(product.id);

  return (
    <Overlay open={Boolean(product)} onClose={onClose} className="modal-overlay">
      <section className="modal product-modal">
        <button className="modal-close" onClick={onClose}><X /></button>
        <div className="product-modal-art"><ProductArt product={product} /></div>
        <div className="product-modal-copy">
          <div className="modal-badges">
            <span>{product.kind === "tire" ? "Шина" : "Легкосплавный диск"}</span>
            <span className="rating"><Star size={13} fill="currentColor" /> {product.rating} · {product.reviews} отзывов</span>
          </div>
          <h2><span>{product.brand}</span> {product.model}</h2>
          <p className="product-modal-size">{product.subtitle}</p>
          <div className="compatibility-ok"><BadgeCheck size={19} /> Проверим совместимость перед отправкой</div>
          <dl className="spec-list">
            <div><dt>Артикул</dt><dd>{product.sku}</dd></div>
            <div><dt>{product.kind === "tire" ? "Сезон" : "Цвет"}</dt><dd>{product.kind === "tire" ? seasonLabels[product.season] : product.color}</dd></div>
            <div><dt>Страна</dt><dd>{product.country}</dd></div>
            <div><dt>Склад</dt><dd>{product.warehouse}</dd></div>
          </dl>
          <div className="modal-price">
            <strong>{formatPrice(product.price)}</strong>
            {product.oldPrice && <del>{formatPrice(product.oldPrice)}</del>}
          </div>
          <div className="modal-buy-actions">
            <button
              className="primary-button"
              onClick={() => {
                addToCart(product.id, 4);
                notify("Комплект из 4 шт. добавлен в корзину");
                onClose();
              }}
            >
              Купить комплект <ArrowRight size={17} />
            </button>
            <button className={favorite ? "secondary-button active" : "secondary-button"} onClick={() => toggleFavorite(product.id)}>
              <Heart size={18} fill={favorite ? "currentColor" : "none"} />
            </button>
          </div>
          <div className="modal-benefits">
            <span><Truck size={16} /> Доставка завтра</span>
            <span><ShieldCheck size={16} /> Расширенная гарантия</span>
          </div>
        </div>
      </section>
    </Overlay>
  );
}

function AccountPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useStore();
  return (
    <Overlay open={open} onClose={onClose} className="drawer-overlay">
      <aside className="drawer account-drawer">
        <div className="drawer-head">
          <div><p className="eyebrow">Личный кабинет</p><h2>{user?.name}</h2></div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>
        <div className="profile-card">
          <span className="profile-avatar">{user?.name.slice(0, 1).toUpperCase()}</span>
          <div><strong>{user?.email}</strong><span>{user?.role === "admin" ? "Администратор" : "Покупатель"}</span></div>
        </div>
        {user?.role === "admin" && (
          <Link className="primary-button full" href="/admin">Открыть Apex Control <ArrowRight size={17} /></Link>
        )}
        <div className="account-section">
          <p className="eyebrow">Мои автомобили</p>
          <div className="saved-car">
            <span className="logo-mark small"><i /><i /><i /></span>
            <div><strong>Автомобиль не выбран</strong><span>Добавьте авто для точного подбора</span></div>
            <button onClick={onClose}>Добавить</button>
          </div>
        </div>
        <div className="account-section">
          <p className="eyebrow">История</p>
          <div className="empty-compact"><PackageCheck /><span>Заказов пока нет</span></div>
        </div>
        <button className="logout-button" onClick={() => { logout(); onClose(); }}>Выйти из аккаунта</button>
      </aside>
    </Overlay>
  );
}

function CollectionDrawer({ open, onClose, mode }: { open: boolean; onClose: () => void; mode: "favorites" | "compare" }) {
  const { favorites, compare, products, toggleFavorite, toggleCompare, addToCart } = useStore();
  const ids = mode === "favorites" ? favorites : compare;
  const items = ids.map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[];
  return (
    <Overlay open={open} onClose={onClose} className="drawer-overlay">
      <aside className="drawer collection-drawer">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">{mode === "favorites" ? "Сохранённое" : "Характеристики"}</p>
            <h2>{mode === "favorites" ? "Избранное" : "Сравнение"} <span>{items.length}</span></h2>
          </div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>
        {items.length === 0 ? (
          <div className="empty-state">
            {mode === "favorites" ? <Heart size={34} /> : <GitCompareArrows size={34} />}
            <h3>{mode === "favorites" ? "Нет избранных товаров" : "Список сравнения пуст"}</h3>
            <p>Добавляйте модели из каталога, чтобы вернуться к ним позже.</p>
          </div>
        ) : (
          <div className="collection-list">
            {items.map((product) => (
              <div className="collection-item" key={product.id}>
                <ProductArt product={product} compact />
                <div>
                  <strong>{product.brand} {product.model}</strong>
                  <span>{product.subtitle}</span>
                  {mode === "compare" && <small>{product.rating} / 5 · {product.stock} шт. · {product.country}</small>}
                  <b>{formatPrice(product.price)}</b>
                </div>
                <div className="collection-actions">
                  <button onClick={() => addToCart(product.id)}><ShoppingBag size={17} /></button>
                  <button onClick={() => mode === "favorites" ? toggleFavorite(product.id) : toggleCompare(product.id)}><X size={17} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </Overlay>
  );
}

export function Storefront() {
  const { products, cart, favorites, compare, user } = useStore();
  const [filters, setFilters] = useState<CatalogFilters>(initialFilters);
  const [selectorTab, setSelectorTab] = useState<"size" | "car">("size");
  const [heroKind, setHeroKind] = useState<ProductKind>("tire");
  const [heroWidth, setHeroWidth] = useState("225");
  const [heroProfile, setHeroProfile] = useState("45");
  const [heroDiameter, setHeroDiameter] = useState("18");
  const [carBrand, setCarBrand] = useState("BMW");
  const [carModel, setCarModel] = useState("3 Series");
  const [carYear, setCarYear] = useState("2022–2026");
  const [carGeneration, setCarGeneration] = useState("G20 LCI");
  const [visible, setVisible] = useState(8);
  const [quickView, setQuickView] = useState<Product | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collection, setCollection] = useState<"favorites" | "compare" | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState("");

  const brands = useMemo(() => [...new Set(products.map((p) => p.brand))].sort(), [products]);
  const dimensions = useMemo(
    () => ({
      widths: [...new Set(products.filter((p) => p.kind === "tire").map((p) => p.width))].sort((a, b) => a - b),
      profiles: [...new Set(products.filter((p) => p.kind === "tire").map((p) => p.profile))].sort((a, b) => a - b),
      diameters: [...new Set(products.map((p) => p.diameter))].sort((a, b) => a - b),
    }),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const list = products.filter((product) => {
      if (filters.kind !== "all" && product.kind !== filters.kind) return false;
      if (filters.seasons.length && !filters.seasons.includes(product.season)) return false;
      if (filters.brands.length && !filters.brands.includes(product.brand)) return false;
      if (filters.width && String(product.width) !== filters.width) return false;
      if (filters.profile && String(product.profile) !== filters.profile) return false;
      if (filters.diameter && String(product.diameter) !== filters.diameter) return false;
      if (product.price < filters.minPrice || product.price > filters.maxPrice) return false;
      if (filters.inStock && product.stock - product.reserved <= 0) return false;
      if (filters.studded && !product.studded) return false;
      if (filters.runflat && !product.runflat) return false;
      if (
        filters.carModel &&
        !product.compatibleCars.some(
          (car) => car === filters.carModel || car.endsWith(` ${filters.carModel}`),
        )
      ) return false;
      if (filters.query) {
        const haystack = `${product.brand} ${product.model} ${product.subtitle} ${product.sku}`.toLowerCase();
        if (!haystack.includes(filters.query.toLowerCase())) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      if (filters.sort === "price-asc") return a.price - b.price;
      if (filters.sort === "price-desc") return b.price - a.price;
      if (filters.sort === "rating") return b.rating - a.rating;
      return Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || b.reviews - a.reviews;
    });
  }, [filters, products]);

  const carModels = Object.keys(carCatalog[carBrand] || {});
  const carDetails = carCatalog[carBrand]?.[carModel];

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function scrollToCatalog() {
    document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function submitHeroSearch() {
    if (selectorTab === "size") {
      setFilters((current) => ({
        ...current,
        kind: heroKind,
        width: heroKind === "tire" ? heroWidth : "",
        profile: heroKind === "tire" ? heroProfile : "",
        diameter: heroDiameter,
        carModel: "",
      }));
      notify("Подбор по размеру применён");
    } else {
      setFilters((current) => ({ ...current, kind: "all", carModel }));
      notify(`Показываем товары для ${carBrand} ${carModel}`);
    }
    setVisible(8);
    scrollToCatalog();
  }

  function toggleMulti<K extends "brands" | "seasons">(key: K, value: CatalogFilters[K][number]) {
    setFilters((current) => {
      const values = current[key] as CatalogFilters[K][number][];
      return {
        ...current,
        [key]: values.includes(value)
          ? values.filter((item) => item !== value)
          : [...values, value],
      };
    });
  }

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const filterPanel = (
    <div className="filters-panel">
      <div className="filters-mobile-head">
        <h3>Фильтры</h3>
        <button onClick={() => setFiltersOpen(false)}><X /></button>
      </div>
      <div className="filter-group">
        <p>Категория</p>
        <div className="segmented">
          {[
            ["all", "Все"],
            ["tire", "Шины"],
            ["wheel", "Диски"],
          ].map(([value, label]) => (
            <button key={value} className={filters.kind === value ? "active" : ""} onClick={() => setFilters((f) => ({ ...f, kind: value as CatalogFilters["kind"], width: value === "wheel" ? "" : f.width, profile: value === "wheel" ? "" : f.profile }))}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {filters.kind !== "wheel" && (
        <div className="filter-group">
          <p>Сезон</p>
          <label className="check-row"><input type="checkbox" checked={filters.seasons.includes("summer")} onChange={() => toggleMulti("seasons", "summer" as Season)} /><span>Летние</span><small>{products.filter((p) => p.season === "summer").length}</small></label>
          <label className="check-row"><input type="checkbox" checked={filters.seasons.includes("winter")} onChange={() => toggleMulti("seasons", "winter" as Season)} /><span>Зимние</span><small>{products.filter((p) => p.season === "winter").length}</small></label>
          <label className="check-row"><input type="checkbox" checked={filters.seasons.includes("all-season")} onChange={() => toggleMulti("seasons", "all-season" as Season)} /><span>Всесезонные</span><small>{products.filter((p) => p.season === "all-season").length}</small></label>
        </div>
      )}
      <div className="filter-group">
        <p>Цена до <strong>{formatPrice(filters.maxPrice)}</strong></p>
        <input className="price-range" type="range" min="10000" max="60000" step="1000" value={filters.maxPrice} onChange={(event) => setFilters((f) => ({ ...f, maxPrice: Number(event.target.value) }))} />
        <div className="range-labels"><span>10 000 ₽</span><span>60 000 ₽</span></div>
      </div>
      <div className="filter-group">
        <p>Размер</p>
        <div className="triple-select">
          {filters.kind !== "wheel" && (
            <>
              <label><span>Ширина</span><select value={filters.width} onChange={(e) => setFilters((f) => ({ ...f, width: e.target.value }))}><option value="">Все</option>{dimensions.widths.map((v) => <option key={v}>{v}</option>)}</select></label>
              <label><span>Профиль</span><select value={filters.profile} onChange={(e) => setFilters((f) => ({ ...f, profile: e.target.value }))}><option value="">Все</option>{dimensions.profiles.map((v) => <option key={v}>{v}</option>)}</select></label>
            </>
          )}
          <label><span>Диаметр</span><select value={filters.diameter} onChange={(e) => setFilters((f) => ({ ...f, diameter: e.target.value }))}><option value="">Все</option>{dimensions.diameters.map((v) => <option key={v} value={v}>R{v}</option>)}</select></label>
        </div>
      </div>
      <div className="filter-group brand-filter">
        <p>Бренд</p>
        {brands.map((brand) => (
          <label className="check-row" key={brand}><input type="checkbox" checked={filters.brands.includes(brand)} onChange={() => toggleMulti("brands", brand)} /><span>{brand}</span><small>{products.filter((p) => p.brand === brand).length}</small></label>
        ))}
      </div>
      <div className="filter-group">
        <label className="switch-row"><span><strong>Только в наличии</strong><small>Можно забрать сегодня</small></span><input type="checkbox" checked={filters.inStock} onChange={(e) => setFilters((f) => ({ ...f, inStock: e.target.checked }))} /></label>
        {filters.kind !== "wheel" && (
          <>
            <label className="switch-row"><span><strong>Шипованные</strong><small>Для сложной зимы</small></span><input type="checkbox" checked={filters.studded} onChange={(e) => setFilters((f) => ({ ...f, studded: e.target.checked }))} /></label>
            <label className="switch-row"><span><strong>RunFlat</strong><small>До 80 км без давления</small></span><input type="checkbox" checked={filters.runflat} onChange={(e) => setFilters((f) => ({ ...f, runflat: e.target.checked }))} /></label>
          </>
        )}
      </div>
      <button className="reset-button" onClick={() => setFilters(initialFilters)}>Сбросить все фильтры</button>
      <button className="primary-button full filters-apply" onClick={() => setFiltersOpen(false)}>Показать {filteredProducts.length}</button>
    </div>
  );

  return (
    <main>
      <div className="utility-bar">
        <div className="container utility-inner">
          <div className="utility-location"><MapPin size={14} /> Москва <ChevronDown size={13} /></div>
          <div className="utility-promise">Бесплатная доставка комплекта от 40 000 ₽</div>
          <div className="utility-links"><span>Для бизнеса</span><span>Доставка и оплата</span><span>Гарантия</span></div>
        </div>
      </div>
      <header className="site-header">
        <div className="container header-inner">
          <button className="mobile-menu-button" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Открыть меню"><Menu /></button>
          <Link href="/" className="brand-logo" aria-label="Apex Wheels">
            <span className="logo-mark"><i /><i /><i /></span>
            <span>APEX<small>WHEELS</small></span>
          </Link>
          <nav className={mobileMenu ? "main-nav open" : "main-nav"}>
            <button onClick={() => { setFilters((f) => ({ ...f, kind: "tire" })); scrollToCatalog(); setMobileMenu(false); }}>Шины</button>
            <button onClick={() => { setFilters((f) => ({ ...f, kind: "wheel", seasons: [], width: "", profile: "" })); scrollToCatalog(); setMobileMenu(false); }}>Диски</button>
            <button onClick={() => { setSelectorTab("car"); document.getElementById("selector")?.scrollIntoView({ behavior: "smooth" }); setMobileMenu(false); }}>По автомобилю</button>
            <a href="#services" onClick={() => setMobileMenu(false)}>Шиномонтаж</a>
            <a href="#about" onClick={() => setMobileMenu(false)}>О нас</a>
          </nav>
          <div className="header-contact"><span>Ежедневно 9:00–21:00</span><a href="tel:+78005509887">8 800 550-98-87</a></div>
          <div className="header-actions">
            <button aria-label="Сравнение" onClick={() => setCollection("compare")}><GitCompareArrows />{compare.length > 0 && <b>{compare.length}</b>}<span>Сравнить</span></button>
            <button aria-label="Избранное" onClick={() => setCollection("favorites")}><Heart />{favorites.length > 0 && <b>{favorites.length}</b>}<span>Избранное</span></button>
            <button aria-label="Аккаунт" onClick={() => user ? setAccountOpen(true) : setAuthOpen(true)}><CircleUserRound /><span>{user ? user.name.split(" ")[0] : "Войти"}</span></button>
            <button className="cart-header-button" aria-label="Корзина" onClick={() => setCartOpen(true)}><ShoppingBag />{cartCount > 0 && <b>{cartCount}</b>}<span>Корзина</span></button>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="hero-image" />
        <div className="hero-shade" />
        <div className="container hero-inner">
          <div className="hero-copy">
            <span className="hero-kicker"><Sparkles size={15} /> Новый уровень подбора</span>
            <h1>Держим<br /><em>дорогу.</em></h1>
            <p>Точные шины и диски для вашего автомобиля. Гарантия совместимости, доставка завтра.</p>
            <div className="hero-proof">
              <span><strong>12 лет</strong> экспертизы</span>
              <span><strong>4.9 / 5</strong> рейтинг</span>
              <span><strong>24 000+</strong> клиентов</span>
            </div>
          </div>
          <div className="selector-card" id="selector">
            <div className="selector-head">
              <div>
                <p className="eyebrow">Умный подбор</p>
                <h2>Найдём идеальную пару</h2>
              </div>
              <span className="selector-badge"><BadgeCheck size={16} /> 100% совместимость</span>
            </div>
            <div className="selector-tabs">
              <button className={selectorTab === "size" ? "active" : ""} onClick={() => setSelectorTab("size")}>По параметрам</button>
              <button className={selectorTab === "car" ? "active" : ""} onClick={() => setSelectorTab("car")}>По автомобилю</button>
            </div>
            {selectorTab === "size" ? (
              <div className="selector-content">
                <div className="product-type-toggle">
                  <button className={heroKind === "tire" ? "active" : ""} onClick={() => setHeroKind("tire")}>Шины</button>
                  <button className={heroKind === "wheel" ? "active" : ""} onClick={() => setHeroKind("wheel")}>Диски</button>
                </div>
                <div className={`selector-fields ${heroKind === "wheel" ? "wheel-mode" : ""}`}>
                  {heroKind === "tire" && (
                    <>
                      <label><span>Ширина</span><select value={heroWidth} onChange={(e) => setHeroWidth(e.target.value)}>{dimensions.widths.map((v) => <option key={v}>{v}</option>)}</select></label>
                      <span className="field-divider">/</span>
                      <label><span>Профиль</span><select value={heroProfile} onChange={(e) => setHeroProfile(e.target.value)}>{dimensions.profiles.map((v) => <option key={v}>{v}</option>)}</select></label>
                    </>
                  )}
                  <span className="field-divider">R</span>
                  <label><span>Диаметр</span><select value={heroDiameter} onChange={(e) => setHeroDiameter(e.target.value)}>{dimensions.diameters.map((v) => <option key={v}>{v}</option>)}</select></label>
                </div>
                <p className="selector-hint">Размер указан на боковине: например, 225/45 R18</p>
              </div>
            ) : (
              <div className="selector-content car-selector">
                <div className="car-fields">
                  <label><span>Марка</span><select value={carBrand} onChange={(e) => { const brand = e.target.value; const model = Object.keys(carCatalog[brand])[0]; const details = carCatalog[brand][model]; setCarBrand(brand); setCarModel(model); setCarYear(details.years[0]); setCarGeneration(details.generations[0]); }}>{Object.keys(carCatalog).map((value) => <option key={value}>{value}</option>)}</select></label>
                  <label><span>Модель</span><select value={carModel} onChange={(e) => { const model = e.target.value; const details = carCatalog[carBrand][model]; setCarModel(model); setCarYear(details.years[0]); setCarGeneration(details.generations[0]); }}>{carModels.map((value) => <option key={value}>{value}</option>)}</select></label>
                  <label><span>Год</span><select value={carYear} onChange={(e) => setCarYear(e.target.value)}>{carDetails?.years.map((value) => <option key={value}>{value}</option>)}</select></label>
                  <label><span>Поколение</span><select value={carGeneration} onChange={(e) => setCarGeneration(e.target.value)}>{carDetails?.generations.map((value) => <option key={value}>{value}</option>)}</select></label>
                </div>
                <p className="selector-hint">Каталог учитывает заводские размеры и допустимые альтернативы.</p>
              </div>
            )}
            <button className="selector-submit" onClick={submitHeroSearch}><Search size={19} /> Показать подходящие <ArrowRight size={18} /></button>
          </div>
        </div>
      </section>

      <section className="trust-bar">
        <div className="container trust-grid">
          <div><span><ShieldCheck /></span><p><strong>Гарантия совместимости</strong>Проверим каждую позицию</p></div>
          <div><span><Truck /></span><p><strong>Доставка завтра</strong>По Москве и области</p></div>
          <div><span><Wrench /></span><p><strong>Монтаж без очереди</strong>Запись вместе с заказом</p></div>
          <div><span><PackageCheck /></span><p><strong>90 дней на возврат</strong>Если товар не устанавливался</p></div>
        </div>
      </section>

      <section className="catalog-section" id="catalog">
        <div className="container">
          <div className="catalog-heading">
            <div>
              <p className="eyebrow">Каталог</p>
              <h2>Подбор без компромиссов</h2>
              <p>Только проверенные бренды, актуальные остатки и честные характеристики.</p>
            </div>
            <div className="catalog-search">
              <Search size={18} />
              <input value={filters.query} onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))} placeholder="Бренд, модель или артикул" />
            </div>
          </div>
          {filters.carModel && (
            <div className="active-car-filter">
              <BadgeCheck size={18} />
              Подходит для <strong>{carBrand} {filters.carModel}</strong>
              <button onClick={() => setFilters((f) => ({ ...f, carModel: "" }))}><X size={15} /> Сбросить</button>
            </div>
          )}
          <div className="catalog-layout">
            <aside className="catalog-sidebar">{filterPanel}</aside>
            <div className="catalog-main">
              <div className="catalog-toolbar">
                <button className="mobile-filter-button" onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={18} /> Фильтры</button>
                <span>Найдено <strong>{filteredProducts.length}</strong></span>
                <label>Сортировка
                  <select value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as CatalogFilters["sort"] }))}>
                    <option value="popular">По популярности</option>
                    <option value="price-asc">Сначала дешевле</option>
                    <option value="price-desc">Сначала дороже</option>
                    <option value="rating">По рейтингу</option>
                  </select>
                </label>
              </div>
              {filteredProducts.length > 0 ? (
                <>
                  <div className="product-grid">
                    {filteredProducts.slice(0, visible).map((product) => (
                      <ProductCard key={product.id} product={product} onQuickView={setQuickView} notify={notify} />
                    ))}
                  </div>
                  {visible < filteredProducts.length && (
                    <button className="load-more" onClick={() => setVisible((n) => n + 8)}>Показать ещё <Plus size={17} /></button>
                  )}
                </>
              ) : (
                <div className="no-results">
                  <Search size={34} />
                  <h3>Ничего не нашли</h3>
                  <p>Попробуйте изменить параметры или оставьте запрос эксперту.</p>
                  <button className="secondary-button" onClick={() => setFilters(initialFilters)}>Сбросить фильтры</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="service-section" id="services">
        <div className="container service-grid">
          <div className="service-visual">
            <span className="service-number">01</span>
            <div className="service-wheel"><span /><i /><i /><i /><i /><i /></div>
            <div className="service-caption"><strong>APEX CARE</strong><span>Сервис, которому доверяют</span></div>
          </div>
          <div className="service-copy">
            <p className="eyebrow">Сервис полного цикла</p>
            <h2>Не просто продаём.<br />Отвечаем за результат.</h2>
            <p>Эксперт проверит размер, индекс нагрузки, вылет и посадочные параметры. Привезём комплект в сервис и установим в удобное время.</p>
            <div className="service-steps">
              <div><span>01</span><p><strong>Подбор</strong>По VIN или параметрам автомобиля</p></div>
              <div><span>02</span><p><strong>Проверка</strong>Двойной контроль совместимости</p></div>
              <div><span>03</span><p><strong>Установка</strong>Монтаж с гарантией работ</p></div>
            </div>
            <button className="dark-outline-button" onClick={() => { setSelectorTab("car"); document.getElementById("selector")?.scrollIntoView({ behavior: "smooth" }); }}>Подобрать по автомобилю <ArrowRight size={17} /></button>
          </div>
        </div>
      </section>

      <section className="consult-section">
        <div className="container consult-inner">
          <div>
            <p className="eyebrow">Остались вопросы?</p>
            <h2>Эксперт перезвонит<br />за 5 минут</h2>
          </div>
          <div className="consult-copy"><p>Поможем с размером, бюджетом и датой монтажа. Без навязчивых продаж.</p><a href="tel:+78005509887"><Phone size={17} /> 8 800 550-98-87</a></div>
          <form onSubmit={(event) => { event.preventDefault(); notify("Спасибо! Эксперт скоро позвонит"); (event.currentTarget as HTMLFormElement).reset(); }}>
            <input required type="tel" placeholder="+7 (___) ___-__-__" />
            <button className="light-button">Перезвоните мне <ArrowRight size={17} /></button>
            <small>Нажимая кнопку, вы соглашаетесь с обработкой данных.</small>
          </form>
        </div>
      </section>

      <footer id="about">
        <div className="container footer-grid">
          <div className="footer-brand">
            <Link href="/" className="brand-logo light"><span className="logo-mark"><i /><i /><i /></span><span>APEX<small>WHEELS</small></span></Link>
            <p>Шины и диски с гарантией совместимости. Москва и вся Россия.</p>
            <strong>8 800 550-98-87</strong>
            <span>Ежедневно с 9:00 до 21:00</span>
          </div>
          <div><h4>Каталог</h4><button onClick={() => { setFilters((f) => ({ ...f, kind: "tire" })); scrollToCatalog(); }}>Шины</button><button onClick={() => { setFilters((f) => ({ ...f, kind: "wheel" })); scrollToCatalog(); }}>Диски</button><button onClick={() => { setSelectorTab("car"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Подбор по авто</button><a href="#services">Шиномонтаж</a></div>
          <div><h4>Покупателям</h4><span>Доставка и оплата</span><span>Гарантия и возврат</span><span>Пункты выдачи</span><span>Корпоративным клиентам</span></div>
          <div><h4>Компания</h4><span>О нас</span><span>Контакты</span><span>Вакансии</span><Link href="/admin">Apex Control</Link></div>
        </div>
        <div className="container footer-bottom"><span>© 2026 APEX WHEELS</span><span>Информация на сайте не является публичной офертой.</span><span>Политика конфиденциальности</span></div>
      </footer>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} notify={notify} />
      <QuickView product={quickView} onClose={() => setQuickView(null)} notify={notify} />
      <AccountPanel open={accountOpen} onClose={() => setAccountOpen(false)} />
      <CollectionDrawer open={Boolean(collection)} onClose={() => setCollection(null)} mode={collection || "favorites"} />
      <Overlay open={filtersOpen} onClose={() => setFiltersOpen(false)} className="filter-overlay"><aside className="mobile-filters">{filterPanel}</aside></Overlay>
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </main>
  );
}

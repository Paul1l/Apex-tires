"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Car,
  Check,
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
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatPrice, seasonLabels } from "@/lib/catalog-data";
import { openCookieSettings } from "@/lib/cookie-consent";
import type {
  CatalogFilters,
  Product,
  ProductKind,
  Season,
  UserProfile,
} from "@/lib/types";
import type { VehicleMake, VehicleModel } from "@/lib/vehicle-catalog";
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
  carMake: "",
  carModel: "",
  carYear: "",
  carGeneration: "",
  query: "",
  sort: "popular",
};

interface SearchableVehicleOption {
  id: string;
  name: string;
}

interface SearchableVehicleSelectProps {
  id: string;
  label: string;
  value: string;
  options: SearchableVehicleOption[];
  placeholder: string;
  helperText: string;
  loading?: boolean;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  onOptionSelect: (option: SearchableVehicleOption) => void;
}

function normalizeVehicleSearchText(value: string): string {
  return value.trim().toLocaleLowerCase("ru");
}

/**
 * Searchable combobox used for vehicle makes and models. Clicking the field
 * opens the complete scrollable list; typing filters it immediately.
 */
function SearchableVehicleSelect({
  id,
  label,
  value,
  options,
  placeholder,
  helperText,
  loading = false,
  disabled = false,
  onValueChange,
  onOptionSelect,
}: SearchableVehicleSelectProps) {
  const containerReference = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [filterIsActive, setFilterIsActive] = useState(false);
  const normalizedValue = normalizeVehicleSearchText(value);
  const exactOptionIsSelected = options.some(
    (option) => normalizeVehicleSearchText(option.name) === normalizedValue,
  );
  const matchingOptions = useMemo(() => {
    if (!normalizedValue || !filterIsActive) return options;

    return options.filter((option) => {
      const normalizedOptionName = normalizeVehicleSearchText(option.name);
      return (
        normalizedOptionName.startsWith(normalizedValue) ||
        normalizedOptionName
          .split(/[\s/-]+/)
          .some((word) => word.startsWith(normalizedValue))
      );
    });
  }, [filterIsActive, normalizedValue, options]);

  useEffect(() => {
    function closeWhenClickingOutside(event: MouseEvent) {
      if (
        containerReference.current &&
        !containerReference.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", closeWhenClickingOutside);
    return () =>
      document.removeEventListener("mousedown", closeWhenClickingOutside);
  }, []);

  function selectOption(option: SearchableVehicleOption) {
    onOptionSelect(option);
    setFilterIsActive(false);
    setIsOpen(false);
  }

  return (
    <div className="car-field">
      <label htmlFor={id}>{label}</label>
      <div className="vehicle-search-select" ref={containerReference}>
        <input
          id={id}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          disabled={disabled}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={`${id}-options`}
          onFocus={(event) => {
            setIsOpen(true);
            setFilterIsActive(false);
            if (exactOptionIsSelected) {
              window.requestAnimationFrame(() => event.target.select());
            }
          }}
          onClick={() => setIsOpen(true)}
          onChange={(event) => {
            onValueChange(event.target.value);
            setFilterIsActive(true);
            setIsOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsOpen(false);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
            }
            if (
              event.key === "Enter" &&
              isOpen &&
              matchingOptions.length === 1
            ) {
              event.preventDefault();
              selectOption(matchingOptions[0]);
            }
          }}
        />
        {isOpen && !disabled && (
          <div
            className="vehicle-options-popover"
            id={`${id}-options`}
            role="listbox"
          >
            <div className="vehicle-options-summary">
              {loading
                ? "Загружаем список…"
                : `Вариантов: ${matchingOptions.length}`}
            </div>
            {!loading &&
              matchingOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={
                    normalizeVehicleSearchText(option.name) === normalizedValue
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  {option.name}
                </button>
              ))}
            {!loading && matchingOptions.length === 0 && (
              <p>Совпадений нет. Измените запрос и выберите вариант из списка.</p>
            )}
          </div>
        )}
      </div>
      <small>{helperText}</small>
    </div>
  );
}

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
  const { authenticateUser, loginAsDemoAdmin } = useStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [code, setCode] = useState("");
  const [personalDataConsent, setPersonalDataConsent] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timerId = window.setTimeout(
      () => setResendCountdown((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearTimeout(timerId);
  }, [resendCountdown]);

  useEffect(() => {
    if (open) return;
    setStep("email");
    setChallengeId("");
    setCode("");
    setMessage("");
  }, [open]);

  function changeMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setStep("email");
    setChallengeId("");
    setCode("");
    setMessage("");
  }

  async function requestEmailCode(
    requestedEmail: string,
    requestedName: string,
    requestedPersonalDataConsent: boolean,
    requestedTermsAccepted: boolean,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: requestedEmail,
          intent: mode,
        }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
        challengeId?: string;
        maskedEmail?: string;
        resendAfterSeconds?: number;
      };
      if (!response.ok || !result.ok || !result.challengeId) {
        setMessage(result.message || "Не удалось отправить код.");
        return;
      }

      setEmail(requestedEmail.trim().toLowerCase());
      setName(requestedName.trim());
      setPersonalDataConsent(requestedPersonalDataConsent);
      setTermsAccepted(requestedTermsAccepted);
      setChallengeId(result.challengeId);
      setMaskedEmail(result.maskedEmail || requestedEmail);
      setCode("");
      setStep("code");
      setResendCountdown(result.resendAfterSeconds ?? 60);
      setMessage("Письмо отправлено. Проверьте также папку «Спам».");
    } catch {
      setMessage("Нет связи с сервером регистрации. Попробуйте позже.");
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await requestEmailCode(
      String(formData.get("email") || ""),
      String(formData.get("name") || ""),
      formData.get("personalDataConsent") === "on",
      formData.get("termsAccepted") === "on",
    );
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId,
          code,
          email,
          name,
          personalDataConsent,
          termsAccepted,
        }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
        user?: UserProfile;
      };
      if (!response.ok || !result.ok || !result.user) {
        setMessage(result.message || "Не удалось подтвердить код.");
        return;
      }

      authenticateUser(result.user);
      setMessage(mode === "register" ? "Аккаунт создан." : "Вход выполнен.");
      window.setTimeout(onClose, 450);
    } catch {
      setMessage("Нет связи с сервером регистрации. Попробуйте позже.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay open={open} onClose={onClose} className="modal-overlay">
      <section className="modal auth-modal">
        <button className="modal-close" onClick={onClose} aria-label="Закрыть"><X /></button>
        <div className="auth-brand">
          <span className="logo-mark small"><i /><i /><i /></span>
          APEX
        </div>
        <p className="eyebrow">
          {step === "code"
            ? "Подтверждение почты"
            : mode === "login"
              ? "С возвращением"
              : "Новый аккаунт"}
        </p>
        <h2>
          {step === "code"
            ? "Введите код из письма"
            : mode === "login"
              ? "Войти в кабинет"
              : "Создать аккаунт"}
        </h2>
        <p className="muted">
          {step === "code"
            ? `Мы отправили 6-значный код на ${maskedEmail}. Он действует 10 минут.`
            : "Без пароля: отправим одноразовый 6-значный код на вашу почту."}
        </p>
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>Вход</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => changeMode("register")}>Регистрация</button>
        </div>
        {step === "email" ? (
          <form onSubmit={submitEmail} className="stack-form">
            {mode === "register" && (
              <label>
                <span>Имя</span>
                <input name="name" required minLength={2} maxLength={80} placeholder="Алексей" autoComplete="name" />
              </label>
            )}
            <label>
              <span>Электронная почта</span>
              <input name="email" type="email" required maxLength={254} placeholder="name@example.ru" autoComplete="email" />
              <small>Адреса @gmail.com и @googlemail.com не поддерживаются.</small>
            </label>
            {mode === "register" && (
              <>
                <label className="consent-row">
                  <input name="personalDataConsent" type="checkbox" required />
                  <span>
                    Даю отдельное{" "}
                    <Link href="/legal/personal-data-consent" target="_blank">
                      согласие на обработку персональных данных
                    </Link>
                    .
                  </span>
                </label>
                <label className="consent-row">
                  <input name="termsAccepted" type="checkbox" required />
                  <span>
                    Принимаю{" "}
                    <Link href="/legal/terms" target="_blank">
                      правила пользования сайтом
                    </Link>
                    .
                  </span>
                </label>
              </>
            )}
            {message && <p className="form-message">{message}</p>}
            <button className="primary-button full" disabled={busy}>
              {busy ? "Отправляем…" : "Получить код"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="stack-form">
            <label>
              <span>Код подтверждения</span>
              <input
                className="otp-code-input"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                placeholder="000000"
              />
            </label>
            {message && <p className="form-message">{message}</p>}
            <button className="primary-button full" disabled={busy || code.length !== 6}>
              {busy ? "Проверяем…" : mode === "login" ? "Войти" : "Подтвердить регистрацию"}
            </button>
            <div className="otp-actions">
              <button type="button" onClick={() => setStep("email")}>Изменить почту</button>
              <button
                type="button"
                disabled={busy || resendCountdown > 0}
                onClick={() =>
                  void requestEmailCode(
                    email,
                    name,
                    personalDataConsent,
                    termsAccepted,
                  )
                }
              >
                {resendCountdown > 0
                  ? `Повторить через ${resendCountdown} с`
                  : "Отправить код ещё раз"}
              </button>
            </div>
          </form>
        )}
        <button
          className="demo-admin-button"
          onClick={() => {
            loginAsDemoAdmin();
            onClose();
          }}
        >
          <Sparkles size={16} /> Войти в демо-админку
        </button>
        <p className="privacy-note">
          Как мы защищаем данные — в{" "}
          <Link href="/legal/privacy">политике конфиденциальности</Link>.
        </p>
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
              <div><span>Доставка по Кемерово</span><strong className="accent-text">Бесплатно</strong></div>
              <div className="summary-total"><span>Итого</span><strong>{formatPrice(total)}</strong></div>
              {!user && <p className="summary-hint">Можно оформить без регистрации. Аккаунт пригодится для истории заказов.</p>}
              <label className="consent-row checkout-consent">
                <input form="apex-demo-order" type="checkbox" required />
                <span>
                  Принимаю{" "}
                  <Link href="/legal/offer" target="_blank">
                    публичную оферту
                  </Link>{" "}
                  и{" "}
                  <Link href="/legal/delivery-payment-returns" target="_blank">
                    условия доставки и возврата
                  </Link>
                  .
                </span>
              </label>
              <label className="consent-row checkout-consent">
                <input form="apex-demo-order" type="checkbox" required />
                <span>
                  Даю отдельное{" "}
                  <Link href="/legal/personal-data-consent" target="_blank">
                    согласие на обработку персональных данных
                  </Link>
                  .
                </span>
              </label>
              <form
                id="apex-demo-order"
                onSubmit={(event) => {
                  event.preventDefault();
                  setOrdered(true);
                  clearCart();
                  notify("Заказ передан менеджеру");
                }}
              >
                <button className="primary-button full" type="submit">
                  Оформить заказ <ArrowRight size={17} />
                </button>
              </form>
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
  const [carModel, setCarModel] = useState("");
  const [carYear, setCarYear] = useState("2024");
  const [carGeneration, setCarGeneration] = useState("");
  const [vehicleMakes, setVehicleMakes] = useState<VehicleMake[]>([]);
  const [vehicleModels, setVehicleModels] = useState<VehicleModel[]>([]);
  const [vehicleMakesLoading, setVehicleMakesLoading] = useState(false);
  const [vehicleModelsLoading, setVehicleModelsLoading] = useState(false);
  const [vehicleCatalogMessage, setVehicleCatalogMessage] = useState("");
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

  const vehicleYears = useMemo(() => {
    const latestModelYear = new Date().getUTCFullYear() + 1;
    return Array.from(
      { length: latestModelYear - 1950 + 1 },
      (_, index) => String(latestModelYear - index),
    );
  }, []);

  const selectedVehicleFitmentCount = useMemo(() => {
    if (!filters.carMake || !filters.carModel) return 0;
    const selectedVehicleName =
      `${filters.carMake} ${filters.carModel}`.trim().toLocaleLowerCase("ru");
    return products.filter((product) =>
      product.compatibleCars.some(
        (compatibleCar) =>
          compatibleCar.trim().toLocaleLowerCase("ru") === selectedVehicleName,
      ),
    ).length;
  }, [filters.carMake, filters.carModel, products]);

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
        selectedVehicleFitmentCount > 0 &&
        filters.carMake &&
        filters.carModel &&
        !product.compatibleCars.some(
          (compatibleCar) =>
            compatibleCar.trim().toLocaleLowerCase("ru") ===
            `${filters.carMake} ${filters.carModel}`
              .trim()
              .toLocaleLowerCase("ru"),
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
  }, [filters, products, selectedVehicleFitmentCount]);

  const selectedMakeIsKnown = vehicleMakes.some(
    (make) => make.name.toLocaleLowerCase("ru") === carBrand.toLocaleLowerCase("ru"),
  );
  const selectedModelIsKnown = vehicleModels.some(
    (model) =>
      model.name.toLocaleLowerCase("ru") ===
      carModel.trim().toLocaleLowerCase("ru"),
  );

  useEffect(() => {
    if (selectorTab !== "car" || vehicleMakes.length > 0) return;

    const abortController = new AbortController();
    setVehicleMakesLoading(true);
    setVehicleCatalogMessage("");
    void fetch("/api/vehicles/makes", {
      cache: "no-store",
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{
          source: string;
          items: VehicleMake[];
        }>;
      })
      .then((result) => {
        setVehicleMakes(result.items);
        setVehicleCatalogMessage(
          result.source === "regional-fallback"
            ? "Используется резервный справочник марок."
            : `Доступно марок: ${result.items.length}.`,
        );
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") {
          setVehicleCatalogMessage(
            "Не удалось загрузить справочник. Попробуйте ещё раз.",
          );
        }
      })
      .finally(() => setVehicleMakesLoading(false));

    return () => abortController.abort();
  }, [selectorTab, vehicleMakes.length]);

  useEffect(() => {
    if (
      selectorTab !== "car" ||
      !selectedMakeIsKnown ||
      !carBrand ||
      !carYear
    ) {
      return;
    }

    const abortController = new AbortController();
    setVehicleModelsLoading(true);
    void fetch(
      `/api/vehicles/models?make=${encodeURIComponent(carBrand)}&year=${encodeURIComponent(carYear)}`,
      { cache: "no-store", signal: abortController.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ items: VehicleModel[] }>;
      })
      .then((result) => setVehicleModels(result.items))
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") {
          setVehicleModels([]);
          setVehicleCatalogMessage(
            "Модели временно недоступны — попробуйте выбрать год ещё раз.",
          );
        }
      })
      .finally(() => setVehicleModelsLoading(false));

    return () => abortController.abort();
  }, [carBrand, carYear, selectedMakeIsKnown, selectorTab]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function scrollToCatalog() {
    document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateSelectedCarBrand(nextBrand: string) {
    setCarBrand(nextBrand);
    setCarModel("");
    setCarGeneration("");
    const exactMake = vehicleMakes.find(
      (make) =>
        make.name.toLocaleLowerCase("ru") ===
        nextBrand.trim().toLocaleLowerCase("ru"),
    );
    if (exactMake) {
      setCarBrand(exactMake.name);
    }
  }

  function updateSelectedCarYear(nextYear: string) {
    setCarYear(nextYear);
    setCarModel("");
    setCarGeneration("");
  }

  function submitHeroSearch() {
    if (selectorTab === "size") {
      setFilters((current) => ({
        ...current,
        kind: heroKind,
        width: heroKind === "tire" ? heroWidth : "",
        profile: heroKind === "tire" ? heroProfile : "",
        diameter: heroDiameter,
        carMake: "",
        carModel: "",
        carYear: "",
        carGeneration: "",
      }));
      notify("Подбор по размеру применён");
    } else {
      if (!selectedMakeIsKnown || !selectedModelIsKnown) {
        notify("Сначала выберите марку и модель из справочника");
        return;
      }
      setFilters((current) => ({
        ...current,
        kind: "all",
        carMake: carBrand,
        carModel: carModel.trim(),
        carYear,
        carGeneration: carGeneration.trim(),
      }));
      const selectedVehicleName =
        `${carBrand} ${carModel}`.trim().toLocaleLowerCase("ru");
      const fitmentIsMapped = products.some((product) =>
        product.compatibleCars.some(
          (compatibleCar) =>
            compatibleCar.trim().toLocaleLowerCase("ru") ===
            selectedVehicleName,
        ),
      );
      notify(
        fitmentIsMapped
          ? `Показываем товары для ${carBrand} ${carModel}`
          : "Автомобиль выбран — размеры будут доступны после загрузки применяемости",
      );
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
          <div className="utility-location"><MapPin size={14} /> Кемерово</div>
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
            <p>Точные шины и диски для вашего автомобиля. Проверка совместимости и доставка по Кемерово.</p>
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
              <span className="selector-badge"><BadgeCheck size={16} /> Проверка по базе</span>
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
                  <SearchableVehicleSelect
                    id="vehicle-make"
                    label="Марка"
                    value={carBrand}
                    options={vehicleMakes}
                    placeholder={
                      vehicleMakesLoading
                        ? "Загружаем марки…"
                        : "Выберите или начните вводить"
                    }
                    helperText={
                      vehicleMakesLoading
                        ? "Загрузка полного справочника"
                        : selectedMakeIsKnown
                          ? "Марка найдена"
                          : "Введите первую букву для фильтрации"
                    }
                    loading={vehicleMakesLoading}
                    onValueChange={updateSelectedCarBrand}
                    onOptionSelect={(option) =>
                      updateSelectedCarBrand(option.name)
                    }
                  />
                  <SearchableVehicleSelect
                    id="vehicle-model"
                    label="Модель"
                    value={carModel}
                    options={vehicleModels}
                    placeholder={
                      vehicleModelsLoading
                        ? "Загружаем модели…"
                        : "Выберите или начните вводить"
                    }
                    helperText={
                      vehicleModelsLoading
                        ? "Обновляем список для выбранного года"
                        : selectedModelIsKnown
                          ? "Модель выбрана"
                        : vehicleModels.length > 0
                          ? `Выберите одну из ${vehicleModels.length} моделей`
                          : "Для этого года модели не найдены"
                    }
                    loading={vehicleModelsLoading}
                    disabled={!selectedMakeIsKnown || vehicleModelsLoading}
                    onValueChange={(nextModel) => {
                      setCarModel(nextModel);
                      setCarGeneration("");
                    }}
                    onOptionSelect={(option) => {
                      setCarModel(option.name);
                      setCarGeneration("");
                    }}
                  />
                  <label>
                    <span>Год выпуска</span>
                    <select
                      value={carYear}
                      onChange={(event) => updateSelectedCarYear(event.target.value)}
                    >
                      {vehicleYears.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Поколение / кузов</span>
                    <input
                      value={carGeneration}
                      onChange={(event) => setCarGeneration(event.target.value)}
                      placeholder="Необязательно"
                    />
                    <small>Например: G20, XV70 или рестайлинг</small>
                  </label>
                </div>
                <p className="selector-hint">
                  {vehicleCatalogMessage ||
                    "Марки и модели загружаются из автомобильного справочника."}
                </p>
                <p className="selector-fitment-note">
                  Точная применяемость шин и дисков появится после загрузки таблицы
                  соответствий из 1С.
                </p>
              </div>
            )}
            <button
              className="selector-submit"
              onClick={submitHeroSearch}
              disabled={
                selectorTab === "car" &&
                (!selectedMakeIsKnown ||
                  !selectedModelIsKnown ||
                  vehicleModelsLoading)
              }
            >
              <Search size={19} /> Показать подходящие <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>

      <section className="trust-bar">
        <div className="container trust-grid">
          <div><span><ShieldCheck /></span><p><strong>Гарантия совместимости</strong>Проверим каждую позицию</p></div>
          <div><span><Truck /></span><p><strong>Доставка по Кемерово</strong>Срок подтвердит менеджер</p></div>
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
            <div
              className={`active-car-filter ${
                selectedVehicleFitmentCount === 0 ? "fitment-pending" : ""
              }`}
            >
              {selectedVehicleFitmentCount > 0 ? (
                <BadgeCheck size={18} />
              ) : (
                <Car size={18} />
              )}
              <div>
                <span>
                  {selectedVehicleFitmentCount > 0
                    ? "Подбор по применяемости"
                    : "Автомобиль выбран"}
                </span>
                <strong>
                  {filters.carMake} {filters.carModel}
                  {filters.carYear ? `, ${filters.carYear}` : ""}
                  {filters.carGeneration ? `, ${filters.carGeneration}` : ""}
                </strong>
                {selectedVehicleFitmentCount === 0 && (
                  <small>
                    Размеры будут отфильтрованы после загрузки применяемости из 1С.
                  </small>
                )}
              </div>
              <button
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    carMake: "",
                    carModel: "",
                    carYear: "",
                    carGeneration: "",
                  }))
                }
              >
                <X size={15} /> Сбросить
              </button>
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
            <input name="phone" required type="tel" placeholder="+7 (___) ___-__-__" aria-label="Номер телефона" />
            <label className="consent-row consult-consent">
              <input name="personalDataConsent" type="checkbox" required />
              <span>
                Даю отдельное{" "}
                <Link href="/legal/personal-data-consent" target="_blank">
                  согласие на обработку персональных данных
                </Link>
                .
              </span>
            </label>
            <button className="light-button">Перезвоните мне <ArrowRight size={17} /></button>
          </form>
        </div>
      </section>

      <footer id="about">
        <div className="container footer-grid">
          <div className="footer-brand">
            <Link href="/" className="brand-logo light"><span className="logo-mark"><i /><i /><i /></span><span>APEX<small>WHEELS</small></span></Link>
            <p>Шины и диски с проверкой совместимости. Работаем только в Кемерово.</p>
            <strong>8 800 550-98-87</strong>
            <span>Ежедневно с 9:00 до 21:00</span>
          </div>
          <div><h4>Каталог</h4><button onClick={() => { setFilters((f) => ({ ...f, kind: "tire" })); scrollToCatalog(); }}>Шины</button><button onClick={() => { setFilters((f) => ({ ...f, kind: "wheel" })); scrollToCatalog(); }}>Диски</button><button onClick={() => { setSelectorTab("car"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Подбор по авто</button><a href="#services">Шиномонтаж</a></div>
          <div><h4>Покупателям</h4><Link href="/legal/delivery-payment-returns">Доставка и оплата</Link><Link href="/legal/delivery-payment-returns">Гарантия и возврат</Link><Link href="/legal/offer">Публичная оферта</Link><Link href="/legal/terms">Правила пользования</Link></div>
          <div><h4>Компания</h4><Link href="/legal/requisites">Реквизиты и контакты</Link><Link href="/legal/privacy">Персональные данные</Link><button type="button" onClick={openCookieSettings}>Настройки cookie</button><Link href="/admin">Apex Control</Link></div>
        </div>
        <div className="container footer-bottom"><span>© 2026 APEX WHEELS</span><Link href="/legal">Правовая информация</Link><Link href="/legal/privacy">Политика конфиденциальности</Link></div>
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

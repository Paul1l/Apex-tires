"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  Car,
  Check,
  CircleAlert,
  CircleUserRound,
  GitCompareArrows,
  Heart,
  MapPin,
  Menu,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  RotateCw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  businessConfig,
  normalizeTelephoneHref,
} from "@/config/business";
import { BrandWordmark } from "@/components/brand-wordmark";
import { formatPrice, seasonLabels } from "@/lib/catalog-data";
import { openCookieSettings } from "@/lib/cookie-consent";
import { CheckoutForm } from "@/components/checkout-form";
import { FitmentRequestForm } from "@/components/fitment-request-form";
import { TireIllustration } from "@/components/tire-illustration";
import { ProductPhoto } from "@/components/product-photo";
import { useDialogFocus } from "@/components/use-dialog-focus";
import {
  buildCatalogSearchParams,
  CATALOG_MAX_PRICE_FILTER,
  createDefaultCatalogFilters,
  EMPTY_CATALOG_FACETS,
  type CatalogFacets,
  type InitialCatalog,
} from "@/lib/api/catalog-query";
import type {
  CatalogFilters,
  Product,
  ProductKind,
  Season,
  UserProfile,
} from "@/lib/types";
import type { VehicleMake, VehicleModel } from "@/lib/vehicle-catalog";
import { sortVehiclesByName } from "@/lib/vehicle-name-sorting";
import {
  getAvailabilityPresentation,
  hasValidDiscount,
} from "@/lib/product-presentation";
import {
  getCartLineLimit,
  MAX_CART_LINE_QUANTITY,
  useStore,
  type CartChangeResult,
} from "@/components/store-provider";

const initialFilters: CatalogFilters = createDefaultCatalogFilters();

/** Smooth scrolling unless the visitor asked the system to reduce motion. */
function scrollBehavior(): ScrollBehavior {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

function productName(product: Pick<Product, "brand" | "model">): string {
  return `${product.brand} ${product.model}`;
}

type ToastTone = "success" | "error";
type Notify = (message: string, tone?: ToastTone) => void;

function cartLimitText(maxQuantity: number): string {
  if (maxQuantity === 0) return "товара нет в наличии";
  return maxQuantity < MAX_CART_LINE_QUANTITY
    ? `в наличии ${maxQuantity} шт.`
    : `в одной позиции не больше ${MAX_CART_LINE_QUANTITY} шт.`;
}

/**
 * Toast for an "add to cart" action that reflects what was actually saved:
 * a save error, the stock or line limit, or success.
 */
function reportCartAddition(
  result: CartChangeResult,
  previousQuantity: number,
  notify: Notify,
  successMessage: string,
) {
  if (!result.ok) {
    notify(`Корзина не сохранена. ${result.message ?? ""}`.trim(), "error");
  } else if (result.quantity <= previousQuantity) {
    notify(`Больше добавить нельзя: ${cartLimitText(result.maxQuantity)}`, "error");
  } else if (result.limited) {
    notify(`В корзине ${result.quantity} шт. — больше добавить нельзя: ${cartLimitText(result.maxQuantity)}`);
  } else {
    notify(successMessage);
  }
}

function useDebouncedValue<T>(value: T, delayMilliseconds: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMilliseconds);
    return () => window.clearTimeout(timeoutId);
  }, [value, delayMilliseconds]);
  return debouncedValue;
}

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
  const alphabetizedOptions = useMemo(
    () => sortVehiclesByName(options),
    [options],
  );
  const matchingOptions = useMemo(() => {
    if (!normalizedValue || !filterIsActive) return alphabetizedOptions;

    return alphabetizedOptions.filter((option) => {
      const normalizedOptionName = normalizeVehicleSearchText(option.name);
      return (
        normalizedOptionName.startsWith(normalizedValue) ||
        normalizedOptionName
          .split(/[\s/-]+/)
          .some((word) => word.startsWith(normalizedValue))
      );
    });
  }, [alphabetizedOptions, filterIsActive, normalizedValue]);

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
    // A missing or broken photo falls back to the generated art below.
    return (
      <ProductPhoto
        src={product.image}
        alt={`${product.brand} ${product.model}`}
        className={`product-art uploaded ${compact ? "compact" : ""}`}
        fallback={<GeneratedProductArt product={product} compact={compact} />}
      />
    );
  }
  return <GeneratedProductArt product={product} compact={compact} />;
}

/** Tire illustration or the wheel placeholder, used when there is no photo. */
function GeneratedProductArt({ product, compact }: { product: Product; compact: boolean }) {
  if (product.kind === "tire") {
    // Compact rows (cart, favorites, compare) print the name next to the image,
    // so the picture is decorative there. Full-size art keeps a descriptive alt:
    // in the quick view it is the main image; in the catalog card it sits in a
    // button with its own aria-label, which already overrides the content.
    return (
      <div className={`product-art tire tire-illustration ${compact ? "compact" : ""}`} aria-hidden={compact || undefined}>
        <TireIllustration product={product} decorative={compact} />
        {!compact && <span className="tire-illustration-caption" aria-hidden="true">Иллюстрация</span>}
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
      <span className="art-caption">WHEEL</span>
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
  notify: Notify;
}) {
  const {
    addToCart,
    favorites,
    compare,
    toggleFavorite,
    toggleCompare,
    cart,
  } = useStore();
  const quantityInCart = cart.find((line) => line.productId === product.id)?.quantity ?? 0;
  const inCart = quantityInCart > 0;
  const favorite = favorites.includes(product.id);
  const compared = compare.includes(product.id);
  const catalogIsPreview = businessConfig.catalog.dataMode === "preview";
  const availability = getAvailabilityPresentation(
    product,
    businessConfig.catalog.availabilityDisplayMode,
    catalogIsPreview,
  );
  const showDiscount = !catalogIsPreview && hasValidDiscount(product);

  const name = productName(product);
  const productPath = product.slug
    ? `/${product.kind === "tire" ? "tires" : "wheels"}/${encodeURIComponent(product.slug)}`
    : null;

  return (
    <article className="product-card">
      <div className="product-card-top">
        <div className="product-tags">
          {showDiscount && <span className="tag sale">−{Math.round((1 - product.price / product.oldPrice) * 100)}%</span>}
          {product.tags.slice(0, 1).map((tag) => (
            <span className="tag" key={tag}>{tag}</span>
          ))}
        </div>
        <div className="product-actions">
          <button
            type="button"
            className={compared ? "active" : ""}
            aria-label={`Сравнить: ${name}`}
            aria-pressed={compared}
            onClick={() => {
              toggleCompare(product.id);
              notify(compared ? "Убрано из сравнения" : "Добавлено к сравнению");
            }}
          >
            <GitCompareArrows size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={favorite ? "active" : ""}
            aria-label={`В избранное: ${name}`}
            aria-pressed={favorite}
            onClick={() => {
              toggleFavorite(product.id);
              notify(favorite ? "Убрано из избранного" : "Добавлено в избранное");
            }}
          >
            <Heart size={17} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
          </button>
        </div>
      </div>
      <button type="button" className="product-visual-button" onClick={() => onQuickView(product)} aria-label={`Быстрый просмотр: ${name}`}>
        <ProductArt product={product} />
      </button>
      <div className="product-copy">
        <div className="product-meta">
          <span>{product.kind === "tire" ? seasonLabels[product.season] : product.color}</span>
          {businessConfig.catalog.ratingsEnabled && product.rating && (
            <span className="rating"><Star size={13} fill="currentColor" aria-hidden="true" /> {product.rating}</span>
          )}
        </div>
        <h3 className="product-card-heading">
          {productPath && !catalogIsPreview ? (
            <Link className="product-title" href={productPath}>
              <strong>{product.brand}</strong> {product.model}
            </Link>
          ) : (
            <button type="button" className="product-title" onClick={() => onQuickView(product)}><strong>{product.brand}</strong> {product.model}</button>
          )}
        </h3>
        <p className="product-size">{product.subtitle}</p>
        <div className="stock-line">
          <span className={availability.available ? "stock-dot" : "stock-dot empty"} aria-hidden="true" />
          {availability.label}
        </div>
        <div className="product-buy-row">
          <div className="price-block">
            <strong>{formatPrice(product.price)}</strong>
            {showDiscount && <del>{formatPrice(product.oldPrice)}</del>}
          </div>
          <button
            type="button"
            className={inCart ? "bag-button added" : "bag-button"}
            onClick={async () => {
              const result = await addToCart(product.id);
              reportCartAddition(result, quantityInCart, notify, inCart ? "Количество обновлено" : "Товар добавлен в корзину");
            }}
            aria-label={`${inCart ? "Добавить ещё в корзину" : "Добавить в корзину"}: ${name}`}
          >
            {inCart ? <Check size={19} aria-hidden="true" /> : <ShoppingBag size={19} aria-hidden="true" />}
          </button>
        </div>
        {catalogIsPreview && <p className="split-pay">Демонстрационная цена</p>}
        {businessConfig.features.installmentEnabled && !catalogIsPreview && (
          <p className="split-pay">Условия оплаты частями сообщит подключенный платежный партнер</p>
        )}
      </div>
    </article>
  );
}

function ProductCardSkeleton() {
  return (
    <div className="product-card product-card-skeleton" aria-hidden="true">
      <div className="skeleton-art" />
      <div className="product-copy">
        <span className="skeleton-line short" />
        <span className="skeleton-line" />
        <span className="skeleton-line medium" />
        <span className="skeleton-line price" />
      </div>
    </div>
  );
}

/**
 * Backdrop for modal dialogs and drawers. The child panel carries
 * role="dialog", aria-modal and its accessible name; this component handles
 * focus (see useDialogFocus), Escape, clicks on the backdrop and scroll lock.
 */
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
  const overlayReference = useRef<HTMLDivElement>(null);
  useDialogFocus(open, overlayReference, onClose);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("no-scroll");
    return () => {
      document.body.classList.remove("no-scroll");
    };
  }, [open]);

  if (!open) return null;
  return (
    <div ref={overlayReference} className={`overlay ${className}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      {children}
    </div>
  );
}

function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { authenticateUser } = useStore();
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
  const titleId = useId();

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
      <section className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть окно входа"><X aria-hidden="true" /></button>
        <div className="auth-brand">
          <span className="logo-mark small"><i /><i /><i /></span>
          {businessConfig.brandName}
        </div>
        <p className="eyebrow">
          {step === "code"
            ? "Подтверждение почты"
            : mode === "login"
              ? "С возвращением"
              : "Новый аккаунт"}
        </p>
        <h2 id={titleId}>
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
          <button type="button" className={mode === "login" ? "active" : ""} aria-pressed={mode === "login"} onClick={() => changeMode("login")}>Вход</button>
          <button type="button" className={mode === "register" ? "active" : ""} aria-pressed={mode === "register"} onClick={() => changeMode("register")}>Регистрация</button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">{message}</p>
        {step === "email" ? (
          <form onSubmit={submitEmail} className="stack-form">
            {mode === "register" && (
              <label>
                <span>Имя</span>
                <input name="name" required minLength={2} maxLength={80} placeholder="Алексей" autoComplete="name" data-autofocus />
              </label>
            )}
            <label>
              <span>Электронная почта</span>
              <input name="email" type="email" required maxLength={254} placeholder="name@example.ru" autoComplete="email" data-autofocus={mode === "register" ? undefined : true} />
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
        <p className="privacy-note">
          Как мы защищаем данные — в{" "}
          <Link href="/legal/privacy">политике конфиденциальности</Link>.
        </p>
      </section>
    </Overlay>
  );
}

function CartDrawer({ open, onClose, notify }: { open: boolean; onClose: () => void; notify: Notify }) {
  const { cart, products, setCartQuantity, clearCart, user, cartError } = useStore();
  const [ordered, setOrdered] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const titleId = useId();
  const lines = cart
    .map((line) => ({ ...line, product: products.find((item) => item.id === line.productId) }))
    .filter((line): line is typeof line & { product: Product } => Boolean(line.product));
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  useEffect(() => {
    if (!open) {
      setOrdered(false);
      setOrderNumber("");
    }
  }, [open]);

  return (
    <Overlay open={open} onClose={onClose} className="drawer-overlay">
      <section className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Ваш заказ</p>
            <h2 id={titleId}>Корзина <span>{itemCount}</span></h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть корзину"><X aria-hidden="true" /></button>
        </div>
        {cartError && <p className="checkout-error" role="alert">{cartError}</p>}
        {ordered ? (
          <div className="success-state">
            <span aria-hidden="true"><Check size={30} /></span>
            <h3>Заказ принят</h3>
            <p>{orderNumber ? `Номер ${orderNumber}. ` : ""}Менеджер проверит совместимость и свяжется с вами.</p>
            <button className="primary-button" onClick={onClose}>Вернуться в каталог</button>
          </div>
        ) : lines.length === 0 ? (
          <div className="empty-state">
            <ShoppingBag size={34} aria-hidden="true" />
            <h3>Корзина пока пуста</h3>
            <p>Добавьте товары из каталога, чтобы оформить заказ.</p>
            <button className="primary-button" onClick={onClose}>Перейти к товарам</button>
          </div>
        ) : (
          <>
            <ul className="drawer-lines" aria-label="Товары в корзине">
              {lines.map(({ product, quantity }) => {
                const limit = getCartLineLimit(product);
                const atLimit = quantity >= limit;
                return (
                <li className="cart-line" key={product.id}>
                  <ProductArt product={product} compact />
                  <div className="cart-line-copy">
                    <strong>{product.brand} {product.model}</strong>
                    <span>{product.subtitle}</span>
                    <div className="quantity" role="group" aria-label={`Количество: ${productName(product)}`}>
                      <button type="button" aria-label="Уменьшить количество" onClick={() => void setCartQuantity(product.id, quantity - 1)}><Minus size={14} aria-hidden="true" /></button>
                      <b aria-live="polite">{quantity}</b>
                      <button
                        type="button"
                        aria-label={atLimit ? `Увеличить количество: ${cartLimitText(limit)}` : "Увеличить количество"}
                        title={atLimit ? `Больше добавить нельзя: ${cartLimitText(limit)}` : undefined}
                        aria-disabled={atLimit || undefined}
                        onClick={() => {
                          if (!atLimit) void setCartQuantity(product.id, quantity + 1);
                        }}
                      >
                        <Plus size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="cart-line-price">
                    <strong>{formatPrice(product.price * quantity)}</strong>
                    <button type="button" aria-label={`Удалить из корзины: ${productName(product)}`} onClick={() => void setCartQuantity(product.id, 0)}>Удалить</button>
                  </div>
                </li>
                );
              })}
            </ul>
            <div className="drawer-summary">
              <div><span>Товары</span><strong>{formatPrice(total)}</strong></div>
              <div>
                <span>Получение</span>
                <strong>
                  {businessConfig.delivery.pickup.enabled ||
                  businessConfig.delivery.cityDelivery.enabled
                    ? "Выберите ниже"
                    : "Условия уточняются"}
                </strong>
              </div>
              <div className="summary-total"><span>Итого</span><strong>{formatPrice(total)}</strong></div>
              {!user && <p className="summary-hint">Можно оформить без регистрации. Аккаунт пригодится для истории заказов.</p>}
              <CheckoutForm
                user={user}
                items={lines.map(({ product, quantity }) => ({
                  productId: product.id,
                  quantity,
                }))}
                onSuccess={(number) => {
                  setOrderNumber(number);
                  setOrdered(true);
                  clearCart();
                  notify(`Заказ ${number} сохранен`);
                }}
              />
              <button type="button" className="clear-button" onClick={clearCart}>Очистить корзину</button>
            </div>
          </>
        )}
      </section>
    </Overlay>
  );
}

function QuickView({ product, onClose, notify }: { product: Product | null; onClose: () => void; notify: Notify }) {
  const { addToCart, cart, favorites, toggleFavorite } = useStore();
  const titleId = useId();
  if (!product) return null;
  const favorite = favorites.includes(product.id);
  const catalogIsPreview = businessConfig.catalog.dataMode === "preview";
  const showDiscount = !catalogIsPreview && hasValidDiscount(product);

  return (
    <Overlay open={Boolean(product)} onClose={onClose} className="modal-overlay">
      <section className="modal product-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть быстрый просмотр"><X aria-hidden="true" /></button>
        <div className="product-modal-art"><ProductArt product={product} /></div>
        <div className="product-modal-copy">
          <div className="modal-badges">
            <span>{product.kind === "tire" ? "Шина" : "Легкосплавный диск"}</span>
            {businessConfig.catalog.ratingsEnabled && product.rating && (
              <span className="rating"><Star size={13} fill="currentColor" /> {product.rating}{product.reviews ? ` · ${product.reviews} отзывов` : ""}</span>
            )}
          </div>
          <h2 id={titleId}><span>{product.brand}</span> {product.model}</h2>
          <p className="product-modal-size">{product.subtitle}</p>
          <div className="compatibility-ok"><BadgeCheck size={19} aria-hidden="true" /> Параметры совместимости будут подтверждены при обработке заказа</div>
          <dl className="spec-list">
            <div><dt>Артикул</dt><dd>{product.sku}</dd></div>
            <div><dt>{product.kind === "tire" ? "Сезон" : "Цвет"}</dt><dd>{product.kind === "tire" ? seasonLabels[product.season] : product.color}</dd></div>
            <div><dt>Страна</dt><dd>{product.country}</dd></div>
            <div><dt>Склад</dt><dd>{product.warehouse}</dd></div>
          </dl>
          <div className="modal-price">
            <strong>{formatPrice(product.price)}</strong>
            {showDiscount && <del>{formatPrice(product.oldPrice)}</del>}
          </div>
          <div className="modal-buy-actions">
            <button
              type="button"
              className="primary-button"
              onClick={async () => {
                const previousQuantity = cart.find((line) => line.productId === product.id)?.quantity ?? 0;
                onClose();
                const result = await addToCart(product.id, 4);
                reportCartAddition(result, previousQuantity, notify, "Комплект из 4 шт. добавлен в корзину");
              }}
            >
              Купить комплект <ArrowRight size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={favorite ? "secondary-button icon-only active" : "secondary-button icon-only"}
              aria-label={`В избранное: ${productName(product)}`}
              aria-pressed={favorite}
              onClick={() => {
                toggleFavorite(product.id);
                notify(favorite ? "Убрано из избранного" : "Добавлено в избранное");
              }}
            >
              <Heart size={18} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
            </button>
          </div>
          {catalogIsPreview && <p className="split-pay">Карточка содержит демонстрационные коммерческие данные</p>}
        </div>
      </section>
    </Overlay>
  );
}

function AccountPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useStore();
  const [orders, setOrders] = useState<Array<{
    id: string;
    number: string;
    status: string;
    paymentStatus: string;
    total: number;
    createdAt: string;
  }>>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersMessage, setOrdersMessage] = useState("");
  const titleId = useId();

  useEffect(() => {
    if (!open || !user) return;
    const abortController = new AbortController();
    setOrdersLoading(true);
    setOrdersMessage("");
    void fetch("/api/v1/account/orders", {
      cache: "no-store",
      credentials: "same-origin",
      signal: abortController.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          items?: typeof orders;
          message?: string;
        };
        if (!response.ok) throw new Error(result.message || "История заказов недоступна.");
        setOrders(result.items ?? []);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") {
          setOrdersMessage(error instanceof Error ? error.message : "История заказов недоступна.");
        }
      })
      .finally(() => setOrdersLoading(false));
    return () => abortController.abort();
  }, [open, user]);

  return (
    <Overlay open={open} onClose={onClose} className="drawer-overlay">
      <section className="drawer account-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="drawer-head">
          <div><p className="eyebrow">Личный кабинет</p><h2 id={titleId}>{user?.name}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть личный кабинет"><X aria-hidden="true" /></button>
        </div>
        <div className="profile-card">
          <span className="profile-avatar">{user?.name.slice(0, 1).toUpperCase()}</span>
          <div><strong>{user?.email}</strong><span>{user?.role === "admin" ? "Администратор" : user?.role === "manager" ? "Менеджер" : "Покупатель"}</span></div>
        </div>
        {(user?.role === "admin" || user?.role === "manager") && (
          <Link className="primary-button full" href="/admin">Открыть панель управления <ArrowRight size={17} aria-hidden="true" /></Link>
        )}
        <div className="account-section">
          <p className="eyebrow">Мои автомобили</p>
          <div className="saved-car">
            <span className="logo-mark small" aria-hidden="true"><i /><i /><i /></span>
            <div><strong>Автомобиль не выбран</strong><span>Добавьте авто для точного подбора</span></div>
            <button type="button" onClick={onClose}>Добавить</button>
          </div>
        </div>
        <div className="account-section">
          <p className="eyebrow">История</p>
          {ordersLoading ? (
            <div className="empty-compact"><PackageCheck /><span>Загружаем заказы…</span></div>
          ) : ordersMessage ? (
            <div className="empty-compact"><PackageCheck /><span>{ordersMessage}</span></div>
          ) : orders.length === 0 ? (
            <div className="empty-compact"><PackageCheck /><span>Заказов пока нет</span></div>
          ) : (
            <div className="account-orders">
              {orders.map((order) => (
                <article key={order.id} className="account-order">
                  <div><strong>{order.number}</strong><span>{new Date(order.createdAt).toLocaleDateString("ru-RU")}</span></div>
                  <div><strong>{formatPrice(order.total)}</strong><span>Статус: {order.status}</span></div>
                </article>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="logout-button" onClick={() => { logout(); onClose(); }}>Выйти из аккаунта</button>
      </section>
    </Overlay>
  );
}

function CollectionDrawer({ open, onClose, mode, notify }: { open: boolean; onClose: () => void; mode: "favorites" | "compare"; notify: Notify }) {
  const { cart, favorites, compare, products, toggleFavorite, toggleCompare, addToCart } = useStore();
  const ids = mode === "favorites" ? favorites : compare;
  const items = ids.map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[];
  const titleId = useId();
  const title = mode === "favorites" ? "Избранное" : "Сравнение";
  return (
    <Overlay open={open} onClose={onClose} className="drawer-overlay">
      <section className="drawer collection-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="drawer-head">
          <div>
            <p className="eyebrow">{mode === "favorites" ? "Сохранённое" : "Характеристики"}</p>
            <h2 id={titleId}>{title} <span>{items.length}</span></h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={`Закрыть: ${title}`}><X aria-hidden="true" /></button>
        </div>
        {items.length === 0 ? (
          <div className="empty-state">
            {mode === "favorites" ? <Heart size={34} aria-hidden="true" /> : <GitCompareArrows size={34} aria-hidden="true" />}
            <h3>{mode === "favorites" ? "Нет избранных товаров" : "Список сравнения пуст"}</h3>
            <p>Добавляйте модели из каталога, чтобы вернуться к ним позже.</p>
          </div>
        ) : (
          <ul className="collection-list" aria-label={title}>
            {items.map((product) => (
              <li className="collection-item" key={product.id}>
                <ProductArt product={product} compact />
                <div>
                  <strong>{product.brand} {product.model}</strong>
                  <span>{product.subtitle}</span>
                  {mode === "compare" && <small>{product.subtitle} · {product.country}</small>}
                  <b>{formatPrice(product.price)}</b>
                </div>
                <div className="collection-actions">
                  <button type="button" aria-label={`Добавить в корзину: ${productName(product)}`} onClick={async () => {
                    const previousQuantity = cart.find((line) => line.productId === product.id)?.quantity ?? 0;
                    reportCartAddition(await addToCart(product.id), previousQuantity, notify, "Товар добавлен в корзину");
                  }}><ShoppingBag size={17} aria-hidden="true" /></button>
                  <button type="button" aria-label={`${mode === "favorites" ? "Убрать из избранного" : "Убрать из сравнения"}: ${productName(product)}`} onClick={() => mode === "favorites" ? toggleFavorite(product.id) : toggleCompare(product.id)}><X size={17} aria-hidden="true" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Overlay>
  );
}

interface StorefrontProps {
  initialKind?: "all" | ProductKind;
  /** First catalog page rendered on the server (database mode). */
  initialCatalog?: InitialCatalog | null;
  /** Page heading (H1). */
  heading: string;
  /** Short factual introduction shown in the hero. */
  intro: string;
}

type CatalogStatus = "loading" | "ready" | "error";

/** Keeps a controlled <select> on an existing option when facets change. */
function pickAvailableOption(value: string, options: number[]): string {
  return options.length === 0 || options.some((option) => String(option) === value)
    ? value
    : String(options[0]);
}

function isModifiedClick(event: React.MouseEvent) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export function Storefront({
  initialKind = "all",
  initialCatalog = null,
  heading,
  intro,
}: StorefrontProps) {
  const { products, cart, favorites, compare, user, mergeCatalogProducts } = useStore();
  const pathname = usePathname();
  const databaseCatalogEnabled = businessConfig.catalog.dataMode === "database";
  const defaultFilters = useMemo<CatalogFilters>(
    () => ({ ...initialFilters, kind: initialKind }),
    [initialKind],
  );
  const [filters, setFilters] = useState<CatalogFilters>(defaultFilters);
  const [selectorTab, setSelectorTab] = useState<"size" | "car">("size");
  const [heroKind, setHeroKind] = useState<ProductKind>(initialKind === "wheel" ? "wheel" : "tire");
  const [heroWidth, setHeroWidth] = useState("225");
  const [heroProfile, setHeroProfile] = useState("45");
  const [heroDiameter, setHeroDiameter] = useState("18");
  const [carBrand, setCarBrand] = useState("");
  const [carModel, setCarModel] = useState("");
  const [carYear, setCarYear] = useState(databaseCatalogEnabled ? "" : "2024");
  const [carGeneration, setCarGeneration] = useState("");
  const [carModification, setCarModification] = useState("");
  const [vehicleModifications, setVehicleModifications] = useState<VehicleModel[]>([]);
  const [modificationsLoading, setModificationsLoading] = useState(false);
  const [vehicleMakes, setVehicleMakes] = useState<VehicleMake[]>([]);
  const [vehicleModels, setVehicleModels] = useState<VehicleModel[]>([]);
  const [vehicleGenerations, setVehicleGenerations] = useState<VehicleModel[]>([]);
  const [vehicleMakesLoading, setVehicleMakesLoading] = useState(false);
  const [vehicleModelsLoading, setVehicleModelsLoading] = useState(false);
  const [vehicleGenerationsLoading, setVehicleGenerationsLoading] = useState(false);
  const [fitmentLookupLoading, setFitmentLookupLoading] = useState(false);
  const [vehicleCatalogMessage, setVehicleCatalogMessage] = useState("");
  const [visible, setVisible] = useState(8);
  const [quickView, setQuickView] = useState<Product | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collection, setCollection] = useState<"favorites" | "compare" | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const mobileMenuButtonReference = useRef<HTMLButtonElement>(null);
  const mainNavigationReference = useRef<HTMLElement>(null);
  const [toast, setToast] = useState<{ id: number; message: string; tone: ToastTone } | null>(null);
  const toastTimeoutReference = useRef<number | undefined>(undefined);
  const catalogFilterKey = JSON.stringify(filters);
  // The page number belongs to one set of filters: any filter change starts
  // again from page 1 without an extra render or request.
  const [catalogPageState, setCatalogPageState] = useState({
    filterKey: catalogFilterKey,
    page: 1,
  });
  const catalogPage =
    catalogPageState.filterKey === catalogFilterKey ? catalogPageState.page : 1;
  const [serverCatalogProducts, setServerCatalogProducts] = useState<Product[]>(
    initialCatalog?.items ?? [],
  );
  const [serverCatalogTotal, setServerCatalogTotal] = useState(initialCatalog?.total ?? 0);
  const [serverCatalogTotalPages, setServerCatalogTotalPages] = useState(
    initialCatalog?.totalPages ?? 0,
  );
  const [serverFacets, setServerFacets] = useState<CatalogFacets>(
    initialCatalog?.facets ?? EMPTY_CATALOG_FACETS,
  );
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>(
    databaseCatalogEnabled && !initialCatalog ? "loading" : "ready",
  );
  const [catalogReloadToken, setCatalogReloadToken] = useState(0);
  // Query string of the products currently shown (database mode). Starts
  // with the server-rendered page, so the browser does not request it again.
  const loadedCatalogQueryReference = useRef<string | null>(initialCatalog?.queryKey ?? null);
  const previousCatalogFiltersReference = useRef<CatalogFilters | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("cart") === "open") setCartOpen(true);
    if (window.location.hash === "#selector") setSelectorTab("car");
  }, []);

  useEffect(() => {
    if (initialCatalog?.items.length) mergeCatalogProducts(initialCatalog.items);
  }, [initialCatalog, mergeCatalogProducts]);

  const brands = useMemo(
    () => databaseCatalogEnabled ? serverFacets.brands : [...new Set(products.map((p) => p.brand))].sort(),
    [databaseCatalogEnabled, products, serverFacets.brands],
  );
  const dimensions = useMemo(
    () => databaseCatalogEnabled ? {
      widths: serverFacets.widths,
      profiles: serverFacets.profiles,
      diameters: serverFacets.diameters,
    } : ({
      widths: [...new Set(products.filter((p) => p.kind === "tire").map((p) => p.width))].sort((a, b) => a - b),
      profiles: [...new Set(products.filter((p) => p.kind === "tire").map((p) => p.profile))].sort((a, b) => a - b),
      diameters: [...new Set(products.map((p) => p.diameter))].sort((a, b) => a - b),
    }),
    [databaseCatalogEnabled, products, serverFacets],
  );
  const heroWidthValue = pickAvailableOption(heroWidth, dimensions.widths);
  const heroProfileValue = pickAvailableOption(heroProfile, dimensions.profiles);
  const heroDiameterValue = pickAvailableOption(heroDiameter, dimensions.diameters);

  const catalogQueryKey = useMemo(
    () => buildCatalogSearchParams(filters, catalogPage).toString(),
    [filters, catalogPage],
  );

  useEffect(() => {
    if (!databaseCatalogEnabled) return;
    const previousFilters = previousCatalogFiltersReference.current;
    previousCatalogFiltersReference.current = filters;
    if (loadedCatalogQueryReference.current === catalogQueryKey) {
      // Already on screen: the server-rendered first page, or a return to
      // the filters whose results are still displayed.
      setCatalogStatus("ready");
      setFitmentLookupLoading(false);
      return;
    }
    // Wait for a pause only while the visitor types a search or drags the
    // price slider; every other change loads immediately.
    const continuousInput =
      previousFilters !== null &&
      (previousFilters.query !== filters.query ||
        previousFilters.maxPrice !== filters.maxPrice);
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setCatalogStatus("loading");
      setFitmentLookupLoading(Boolean(filters.carMake));
      void fetch(`/api/v1/products?${catalogQueryKey}`, {
        cache: "no-store",
        signal: abortController.signal,
      }).then(async (response) => {
        const result = (await response.json().catch(() => null)) as {
          items?: Product[];
          pagination?: { total: number; totalPages: number };
          facets?: CatalogFacets;
          message?: string;
        } | null;
        if (!response.ok || !result) throw new Error(result?.message || "Каталог временно недоступен.");
        const items = result.items ?? [];
        setServerCatalogProducts(items);
        mergeCatalogProducts(items);
        setServerCatalogTotal(result.pagination?.total ?? 0);
        setServerCatalogTotalPages(result.pagination?.totalPages ?? 0);
        if (result.facets) setServerFacets(result.facets);
        loadedCatalogQueryReference.current = catalogQueryKey;
        setCatalogStatus("ready");
      }).catch(() => {
        if (!abortController.signal.aborted) setCatalogStatus("error");
      }).finally(() => {
        if (!abortController.signal.aborted) setFitmentLookupLoading(false);
      });
    }, continuousInput ? 300 : 0);
    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [catalogQueryKey, catalogReloadToken, databaseCatalogEnabled, filters, mergeCatalogProducts]);

  const vehicleYears = useMemo(() => {
    const latestModelYear = new Date().getUTCFullYear() + 1;
    return Array.from(
      { length: latestModelYear - 1950 + 1 },
      (_, index) => String(latestModelYear - index),
    );
  }, []);

  const selectedVehicleFitmentCount = useMemo(() => {
    if (!filters.carMake || !filters.carModel) return 0;
    if (databaseCatalogEnabled) return serverCatalogTotal;
    const selectedVehicleName =
      `${filters.carMake} ${filters.carModel}`.trim().toLocaleLowerCase("ru");
    return products.filter((product) =>
      product.compatibleCars.some(
        (compatibleCar) =>
          compatibleCar.trim().toLocaleLowerCase("ru") === selectedVehicleName,
      ),
    ).length;
  }, [databaseCatalogEnabled, filters.carMake, filters.carModel, products, serverCatalogTotal]);

  const filteredProducts = useMemo(() => {
    if (databaseCatalogEnabled) return serverCatalogProducts;
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
        businessConfig.catalog.dataMode === "preview" &&
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
      if (filters.sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
      return Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || (b.reviews ?? 0) - (a.reviews ?? 0);
    });
  }, [databaseCatalogEnabled, filters, products, selectedVehicleFitmentCount, serverCatalogProducts]);

  const selectedMakeIsKnown = vehicleMakes.some(
    (make) => make.name.toLocaleLowerCase("ru") === carBrand.toLocaleLowerCase("ru"),
  );
  const selectedModelIsKnown = vehicleModels.some(
    (model) =>
      model.name.toLocaleLowerCase("ru") ===
      carModel.trim().toLocaleLowerCase("ru"),
  );
  const selectedGenerationIsKnown =
    (!databaseCatalogEnabled && !carGeneration) ||
    vehicleGenerations.some(
      (generation) =>
        generation.name.toLocaleLowerCase("ru") ===
        carGeneration.trim().toLocaleLowerCase("ru"),
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
            ? "Показываем основной список марок."
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
      (!databaseCatalogEnabled && !carYear)
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
  }, [carBrand, carYear, selectedMakeIsKnown, selectorTab, databaseCatalogEnabled]);

  useEffect(() => {
    if (
      businessConfig.catalog.dataMode !== "database" ||
      selectorTab !== "car" ||
      !selectedMakeIsKnown ||
      !selectedModelIsKnown
    ) {
      setVehicleGenerations([]);
      return;
    }
    const abortController = new AbortController();
    setVehicleGenerationsLoading(true);
    void fetch(
      `/api/vehicles/generations?make=${encodeURIComponent(carBrand)}&model=${encodeURIComponent(carModel)}&year=${encodeURIComponent(carYear)}`,
      { cache: "no-store", signal: abortController.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ items: VehicleModel[] }>;
      })
      .then((result) => setVehicleGenerations(result.items))
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") {
          setVehicleGenerations([]);
          setVehicleCatalogMessage("Поколения автомобиля временно недоступны.");
        }
      })
      .finally(() => setVehicleGenerationsLoading(false));
    return () => abortController.abort();
  }, [carBrand, carModel, carYear, selectedMakeIsKnown, selectedModelIsKnown, selectorTab]);

  useEffect(() => {
    setCarModification("");
    setVehicleModifications([]);
    setModificationsLoading(false);
    if (!databaseCatalogEnabled || !carGeneration || !selectedGenerationIsKnown) return;
    const controller = new AbortController();
    setModificationsLoading(true);
    const parameters = new URLSearchParams({make:carBrand,model:carModel,generation:carGeneration});
    void fetch(`/api/vehicles/modifications?${parameters}`, {signal:controller.signal,cache:"no-store"})
      .then(async (response) => { if (!response.ok) throw new Error("Модификации временно недоступны."); return response.json() as Promise<{items:string[]}>; })
      .then((result) => setVehicleModifications(result.items.map((name) => ({id:name,name}))))
      .catch((error: unknown) => { if (!controller.signal.aborted) setVehicleCatalogMessage(error instanceof Error ? error.message : "Модификации недоступны."); })
      .finally(() => {if (!controller.signal.aborted) setModificationsLoading(false);});
    return () => controller.abort();
  }, [databaseCatalogEnabled,carBrand,carModel,carGeneration,selectedGenerationIsKnown]);

  const notify = useCallback<Notify>((message, tone = "success") => {
    window.clearTimeout(toastTimeoutReference.current);
    setToast((current) => ({ id: (current?.id ?? 0) + 1, message, tone }));
    // Errors stay longer: they usually ask the visitor to do something.
    toastTimeoutReference.current = window.setTimeout(() => setToast(null), tone === "error" ? 6000 : 2600);
  }, []);

  function scrollToCatalog() {
    document.getElementById("catalog")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  }

  function goToCatalogPage(page: number) {
    setCatalogPageState({ filterKey: catalogFilterKey, page });
    scrollToCatalog();
  }

  function showCategory(kind: ProductKind) {
    setFilters((current) =>
      kind === "tire"
        ? { ...current, kind: "tire" }
        : { ...current, kind: "wheel", seasons: [], width: "", profile: "", studded: false, runflat: false },
    );
    setVisible(8);
    scrollToCatalog();
  }

  /**
   * Category links lead to /shiny and /diski (crawlable URLs). On the
   * category page itself the click filters the catalog in place instead.
   */
  function handleCategoryLinkClick(event: React.MouseEvent<HTMLAnchorElement>, kind: ProductKind) {
    setMobileMenu(false);
    if (isModifiedClick(event) || pathname !== (kind === "tire" ? "/shiny" : "/diski")) return;
    event.preventDefault();
    showCategory(kind);
  }

  /** "По автомобилю": every storefront page has the selector, so stay here. */
  function handleCarSelectorLinkClick(event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) {
    setMobileMenu(false);
    if (isModifiedClick(event) || !document.getElementById("selector")) return;
    event.preventDefault();
    setSelectorTab("car");
    document.getElementById("selector")?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    window.requestAnimationFrame(() =>
      document.getElementById("selector-tab-car")?.focus({ preventScroll: true }),
    );
  }

  useEffect(() => {
    if (!mobileMenu) return;
    // Disclosure menu: move focus to its first link (the menu button is only
    // visible in the compact layout, where the navigation is collapsed).
    if (mobileMenuButtonReference.current?.offsetParent) {
      mainNavigationReference.current?.querySelector<HTMLElement>("a, button")?.focus();
    }
    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMobileMenu(false);
      mobileMenuButtonReference.current?.focus();
    }
    document.addEventListener("keydown", closeMenuOnEscape);
    return () => document.removeEventListener("keydown", closeMenuOnEscape);
  }, [mobileMenu]);

  useEffect(() => {
    if (!filtersOpen) return;
    // The filter dialog exists only in the mobile layout.
    const desktopLayout = window.matchMedia("(min-width: 761px)");
    const closeOnDesktop = () => {
      if (desktopLayout.matches) setFiltersOpen(false);
    };
    closeOnDesktop();
    desktopLayout.addEventListener("change", closeOnDesktop);
    return () => desktopLayout.removeEventListener("change", closeOnDesktop);
  }, [filtersOpen]);

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

  async function submitHeroSearch() {
    if (selectorTab === "size") {
      setFilters((current) => ({
        ...current,
        kind: heroKind,
        width: heroKind === "tire" ? heroWidthValue : "",
        profile: heroKind === "tire" ? heroProfileValue : "",
        diameter: heroDiameterValue,
        ...(heroKind === "wheel" ? { seasons: [], studded: false, runflat: false } : {}),
        carMake: "",
        carModel: "",
        carYear: "",
        carGeneration: "",
      }));
      notify("Подбор по размеру применён");
    } else {
      if (!selectedMakeIsKnown || !selectedModelIsKnown || !selectedGenerationIsKnown || modificationsLoading || (vehicleModifications.length > 0 && !vehicleModifications.some((item) => item.name === carModification))) {
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
        carModification: carModification.trim(),
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
      if (businessConfig.catalog.dataMode === "preview") {
        notify(
          fitmentIsMapped
            ? `Показываем товары для ${carBrand} ${carModel}`
            : "Автомобиль выбран — размеры будут доступны после загрузки применяемости",
        );
      }
      if (databaseCatalogEnabled) notify(`Проверяем применяемость для ${carBrand} ${carModel}`);
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
  const foundCount = databaseCatalogEnabled ? serverCatalogTotal : filteredProducts.length;
  const catalogAnnouncement = useDebouncedValue(
    catalogStatus === "loading"
      ? ""
      : catalogStatus === "error"
        ? "Не удалось загрузить каталог."
        : `Найдено товаров: ${foundCount}.`,
    700,
  );

  function resetFilters() {
    setFilters(defaultFilters);
    setVisible(8);
  }

  function selectCategoryFilter(kind: CatalogFilters["kind"]) {
    setFilters((current) =>
      kind === "wheel"
        ? { ...current, kind, seasons: [], width: "", profile: "", studded: false, runflat: false }
        : { ...current, kind },
    );
  }

  function renderFilterPanel(variant: "sidebar" | "dialog") {
    const idPrefix = `filters-${variant}`;
    return (
      <div className="filters-panel">
        {variant === "dialog" && (
          <div className="filters-mobile-head">
            <h2 id="mobile-filters-title">Фильтры</h2>
            <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Закрыть фильтры"><X aria-hidden="true" /></button>
          </div>
        )}
        <div className="filter-group" role="group" aria-labelledby={`${idPrefix}-kind`}>
          <p id={`${idPrefix}-kind`}>Категория</p>
          <div className="segmented">
            {([
              ["all", "Все"],
              ["tire", "Шины"],
              ["wheel", "Диски"],
            ] as const).map(([value, label]) => (
              <button type="button" key={value} className={filters.kind === value ? "active" : ""} aria-pressed={filters.kind === value} onClick={() => selectCategoryFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {filters.kind !== "wheel" && (
          <div className="filter-group" role="group" aria-labelledby={`${idPrefix}-season`}>
            <p id={`${idPrefix}-season`}>Сезон</p>
            <label className="check-row"><input type="checkbox" checked={filters.seasons.includes("summer")} onChange={() => toggleMulti("seasons", "summer" as Season)} /><span>Летние</span>{!databaseCatalogEnabled && <small>{products.filter((p) => p.season === "summer").length}</small>}</label>
            <label className="check-row"><input type="checkbox" checked={filters.seasons.includes("winter")} onChange={() => toggleMulti("seasons", "winter" as Season)} /><span>Зимние</span>{!databaseCatalogEnabled && <small>{products.filter((p) => p.season === "winter").length}</small>}</label>
            <label className="check-row"><input type="checkbox" checked={filters.seasons.includes("all-season")} onChange={() => toggleMulti("seasons", "all-season" as Season)} /><span>Всесезонные</span>{!databaseCatalogEnabled && <small>{products.filter((p) => p.season === "all-season").length}</small>}</label>
          </div>
        )}
        <div className="filter-group">
          <p id={`${idPrefix}-price`}>Цена до <strong>{formatPrice(filters.maxPrice)}</strong></p>
          <input className="price-range" type="range" min="10000" max={CATALOG_MAX_PRICE_FILTER} step="1000" value={filters.maxPrice} aria-label="Максимальная цена" aria-valuetext={formatPrice(filters.maxPrice)} onChange={(event) => setFilters((f) => ({ ...f, maxPrice: Number(event.target.value) }))} />
          <div className="range-labels" aria-hidden="true"><span>10 000 ₽</span><span>60 000 ₽</span></div>
        </div>
        <div className="filter-group" role="group" aria-labelledby={`${idPrefix}-size`}>
          <p id={`${idPrefix}-size`}>Размер</p>
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
        <div className="filter-group brand-filter" role="group" aria-labelledby={`${idPrefix}-brand`}>
          <p id={`${idPrefix}-brand`}>Бренд</p>
          {brands.map((brand) => (
            <label className="check-row" key={brand}><input type="checkbox" checked={filters.brands.includes(brand)} onChange={() => toggleMulti("brands", brand)} /><span>{brand}</span>{!databaseCatalogEnabled && <small>{products.filter((p) => p.brand === brand).length}</small>}</label>
          ))}
        </div>
        <div className="filter-group">
          <label className="switch-row"><span><strong>Только в наличии</strong><small>Есть доступный остаток</small></span><input type="checkbox" role="switch" checked={filters.inStock} onChange={(e) => setFilters((f) => ({ ...f, inStock: e.target.checked }))} /></label>
          {filters.kind !== "wheel" && (
            <>
              <label className="switch-row"><span><strong>Шипованные</strong><small>Для сложной зимы</small></span><input type="checkbox" role="switch" checked={filters.studded} onChange={(e) => setFilters((f) => ({ ...f, studded: e.target.checked }))} /></label>
              <label className="switch-row"><span><strong>RunFlat</strong><small>Проверьте требования производителя</small></span><input type="checkbox" role="switch" checked={filters.runflat} onChange={(e) => setFilters((f) => ({ ...f, runflat: e.target.checked }))} /></label>
            </>
          )}
        </div>
        <button type="button" className="reset-button" onClick={resetFilters}>Сбросить все фильтры</button>
        {variant === "dialog" && (
          <button type="button" className="primary-button full filters-apply" onClick={() => setFiltersOpen(false)}>Показать {foundCount}</button>
        )}
      </div>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Перейти к основному содержанию</a>
      <div className="utility-bar">
        <div className="container utility-inner">
          <div className="utility-location"><MapPin size={14} aria-hidden="true" /> {businessConfig.location.city}</div>
          <div className="utility-promise">
            {businessConfig.catalog.dataMode === "preview"
              ? "Предварительная версия · реквизиты, цены и наличие требуют подтверждения"
              : businessConfig.brandName}
          </div>
          <div className="utility-links"><Link href="/contacts">Контакты</Link><Link href="/legal/delivery-payment-returns">Условия покупки</Link></div>
        </div>
      </div>
      <header className="site-header">
        <div className="container header-inner">
          <button
            ref={mobileMenuButtonReference}
            type="button"
            className="mobile-menu-button"
            onClick={() => setMobileMenu((open) => !open)}
            aria-label={mobileMenu ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={mobileMenu}
            aria-controls="main-navigation"
          >
            {mobileMenu ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
          <Link href="/" className="brand-logo" aria-label={`${businessConfig.brandName} — на главную`}>
            <span className="logo-mark" aria-hidden="true"><i /><i /><i /></span>
            <BrandWordmark />
          </Link>
          <nav id="main-navigation" ref={mainNavigationReference} className={mobileMenu ? "main-nav open" : "main-nav"} aria-label="Основное меню">
            <Link href="/shiny#catalog" aria-current={pathname === "/shiny" ? "page" : undefined} onClick={(event) => handleCategoryLinkClick(event, "tire")}>Шины</Link>
            <Link href="/diski#catalog" aria-current={pathname === "/diski" ? "page" : undefined} onClick={(event) => handleCategoryLinkClick(event, "wheel")}>Диски</Link>
            <Link href="/#selector" onClick={handleCarSelectorLinkClick}>По автомобилю</Link>
            {businessConfig.services.tireService && <a href="#services" onClick={() => setMobileMenu(false)}>Шиномонтаж</a>}
            <Link href="/contacts" onClick={() => setMobileMenu(false)}>Контакты</Link>
          </nav>
          <div className="header-contact">
            {businessConfig.workingHours && <span>{businessConfig.workingHours}</span>}
            {businessConfig.contacts.phone ? (
              <a href={normalizeTelephoneHref(businessConfig.contacts.phone)}>{businessConfig.contacts.phone}</a>
            ) : (
              <Link href="/contacts">Контактные данные</Link>
            )}
          </div>
          <div className="header-actions">
            <button type="button" aria-label={compare.length > 0 ? `Сравнение, товаров: ${compare.length}` : "Сравнение"} aria-haspopup="dialog" onClick={() => setCollection("compare")}><GitCompareArrows aria-hidden="true" />{compare.length > 0 && <b aria-hidden="true">{compare.length}</b>}<span aria-hidden="true">Сравнить</span></button>
            <button type="button" aria-label={favorites.length > 0 ? `Избранное, товаров: ${favorites.length}` : "Избранное"} aria-haspopup="dialog" onClick={() => setCollection("favorites")}><Heart aria-hidden="true" />{favorites.length > 0 && <b aria-hidden="true">{favorites.length}</b>}<span aria-hidden="true">Избранное</span></button>
            <button type="button" aria-label={user ? `Личный кабинет: ${user.name}` : "Войти в личный кабинет"} aria-haspopup="dialog" onClick={() => user ? setAccountOpen(true) : setAuthOpen(true)}><CircleUserRound aria-hidden="true" /><span aria-hidden="true">{user ? user.name.split(" ")[0] : "Войти"}</span></button>
            <button type="button" className="cart-header-button" aria-label={cartCount > 0 ? `Корзина, товаров: ${cartCount}` : "Корзина"} aria-haspopup="dialog" onClick={() => setCartOpen(true)}><ShoppingBag aria-hidden="true" />{cartCount > 0 && <b aria-hidden="true">{cartCount}</b>}<span aria-hidden="true">Корзина</span></button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
      <section className="hero">
        <picture className="hero-image">
          <source type="image/avif" srcSet="/assets/apex-hero-1804.avif" />
          <source type="image/webp" srcSet="/assets/apex-hero-1804.webp" />
          {/* Decorative LCP image: discovered in the HTML and fetched first. */}
          <img src="/assets/apex-hero-1804.jpg" alt="" width={1804} height={872} fetchPriority="high" />
        </picture>
        <div className="hero-shade" />
        <div className="container hero-inner">
          <div className="hero-copy">
            <h1 className="hero-kicker"><MapPin size={15} aria-hidden="true" /> {heading}</h1>
            <p className="hero-slogan">Держим <br /><em>дорогу.</em></p>
            <p className="hero-intro">{intro}</p>
            <div className="hero-proof">
              <span><strong>Размер</strong> ширина, профиль, диаметр</span>
              <span><strong>Автомобиль</strong> марка и модель</span>
              <span><strong>Без регистрации</strong> гостевой заказ</span>
              {businessConfig.marketing.yearsExperience !== null && (
                <span><strong>{businessConfig.marketing.yearsExperience} лет</strong> подтверждённый срок работы</span>
              )}
              {businessConfig.marketing.clientCount !== null && (
                <span><strong>{businessConfig.marketing.clientCount.toLocaleString("ru-RU")}</strong> подтверждённых клиентов</span>
              )}
            </div>
          </div>
          <div className="selector-card" id="selector">
            <div className="selector-head">
              <div>
                <p className="eyebrow">Умный подбор</p>
                <h2>Найдём идеальную пару</h2>
              </div>
              <span className="selector-badge"><BadgeCheck size={16} aria-hidden="true" /> Проверка по базе</span>
            </div>
            <div className="selector-tabs" role="group" aria-label="Способ подбора">
              <button type="button" id="selector-tab-size" className={selectorTab === "size" ? "active" : ""} aria-pressed={selectorTab === "size"} onClick={() => setSelectorTab("size")}>По параметрам</button>
              <button type="button" id="selector-tab-car" className={selectorTab === "car" ? "active" : ""} aria-pressed={selectorTab === "car"} onClick={() => setSelectorTab("car")}>По автомобилю</button>
            </div>
            {selectorTab === "size" ? (
              <div className="selector-content">
                <div className="product-type-toggle" role="group" aria-label="Что подбираем">
                  <button type="button" className={heroKind === "tire" ? "active" : ""} aria-pressed={heroKind === "tire"} onClick={() => setHeroKind("tire")}>Шины</button>
                  <button type="button" className={heroKind === "wheel" ? "active" : ""} aria-pressed={heroKind === "wheel"} onClick={() => setHeroKind("wheel")}>Диски</button>
                </div>
                <div className={`selector-fields ${heroKind === "wheel" ? "wheel-mode" : ""}`}>
                  {heroKind === "tire" && (
                    <>
                      <label><span>Ширина</span><select value={heroWidthValue} onChange={(e) => setHeroWidth(e.target.value)}>{dimensions.widths.map((v) => <option key={v}>{v}</option>)}</select></label>
                      <span className="field-divider" aria-hidden="true">/</span>
                      <label><span>Профиль</span><select value={heroProfileValue} onChange={(e) => setHeroProfile(e.target.value)}>{dimensions.profiles.map((v) => <option key={v}>{v}</option>)}</select></label>
                    </>
                  )}
                  <span className="field-divider" aria-hidden="true">R</span>
                  <label><span>Диаметр</span><select value={heroDiameterValue} onChange={(e) => setHeroDiameter(e.target.value)}>{dimensions.diameters.map((v) => <option key={v}>{v}</option>)}</select></label>
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
                      !selectedMakeIsKnown
                        ? "Сначала выберите марку"
                        : vehicleModelsLoading
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
                      {databaseCatalogEnabled && <option value="">Не уточнять год</option>}
                      {vehicleYears.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </label>
                  {businessConfig.catalog.dataMode === "database" ? (
                    <SearchableVehicleSelect
                      id="vehicle-generation"
                      label="Поколение / кузов"
                      value={carGeneration}
                      options={vehicleGenerations}
                      placeholder={
                        vehicleGenerationsLoading
                          ? "Загружаем поколения…"
                          : "Выберите поколение"
                      }
                      helperText={
                        vehicleGenerations.length > 0
                          ? `Доступно вариантов: ${vehicleGenerations.length}`
                          : "Проверенных поколений пока нет"
                      }
                      loading={vehicleGenerationsLoading}
                      disabled={!selectedModelIsKnown || vehicleGenerationsLoading}
                      onValueChange={(value) => {
                        setCarGeneration(value);
                      }}
                      onOptionSelect={(option) => {
                        setCarGeneration(option.name);
                      }}
                    />
                  ) : (
                    <label>
                      <span>Поколение / кузов</span>
                      <input
                        value={carGeneration}
                        onChange={(event) => setCarGeneration(event.target.value)}
                        placeholder="Необязательно"
                      />
                      <small>Например: G20, XV70 или рестайлинг</small>
                    </label>
                  )}
                </div>
                {databaseCatalogEnabled && (modificationsLoading || vehicleModifications.length > 0) && <SearchableVehicleSelect
                  id="vehicle-modification" label="Модификация" value={carModification} options={vehicleModifications}
                  helperText="Выберите вариант из проверенного справочника"
                  placeholder="Выберите модификацию" loading={modificationsLoading} disabled={modificationsLoading}
                  onValueChange={setCarModification} onOptionSelect={(option) => setCarModification(option.name)}
                />}
                <p className="selector-hint" aria-live="polite">
                  {vehicleCatalogMessage ||
                    "Выберите марку, модель и год выпуска автомобиля."}
                </p>
                <p className="selector-fitment-note">
                  {databaseCatalogEnabled
                    ? "Подходящие товары показываем по проверенным данным о совместимости с автомобилем."
                    : "В демонстрационной версии совместимость с автомобилями показана на примерах."}
                </p>
                <FitmentRequestForm
                  initialMake={carBrand}
                  initialModel={carModel}
                  initialYear={carYear}
                  initialGeneration={carGeneration}
                />
              </div>
            )}
            <button
              type="button"
              className="selector-submit"
              onClick={submitHeroSearch}
              disabled={
                selectorTab === "car" &&
                (!selectedMakeIsKnown ||
                  !selectedModelIsKnown ||
                  !selectedGenerationIsKnown ||
                  vehicleModelsLoading ||
                  vehicleGenerationsLoading ||
                  fitmentLookupLoading)
              }
            >
              <Search size={19} aria-hidden="true" /> {fitmentLookupLoading ? "Проверяем…" : "Показать подходящие"} {!fitmentLookupLoading && <ArrowRight size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </section>

      <section className="trust-bar" aria-label="Как устроен подбор">
        <div className="container trust-grid">
          <div><span aria-hidden="true"><SlidersHorizontal /></span><p><strong>По параметрам</strong>Фильтры по размерам</p></div>
          <div><span aria-hidden="true"><Car /></span><p><strong>По автомобилю</strong>Марка, модель и год выпуска</p></div>
          <div><span aria-hidden="true"><ShoppingBag /></span><p><strong>Гостевой заказ</strong>Регистрация необязательна</p></div>
          <div><span aria-hidden="true"><BadgeCheck /></span><p><strong>Проверка совместимости</strong>Менеджер подтвердит параметры при обработке заказа</p></div>
        </div>
      </section>

      <section className="catalog-section" id="catalog" aria-labelledby="catalog-heading">
        <div className="container">
          <div className="catalog-heading">
            <div>
              <p className="eyebrow">Каталог</p>
              <h2 id="catalog-heading">Подбор без компромиссов</h2>
              <p>{businessConfig.catalog.dataMode === "preview" ? "Демонстрационные товары для согласования интерфейса. Цены и наличие не являются коммерческим предложением." : "Актуальные цены и наличие поступают из базы магазина."}</p>
            </div>
            <div className="catalog-search" role="search">
              <Search size={18} aria-hidden="true" />
              <input value={filters.query} onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))} placeholder="Бренд, модель или артикул" aria-label="Поиск по каталогу: бренд, модель или артикул" enterKeyHint="search" />
            </div>
          </div>
          {filters.carModel && (
            <div
              className={`active-car-filter ${
                selectedVehicleFitmentCount === 0 ? "fitment-pending" : ""
              }`}
            >
              {selectedVehicleFitmentCount > 0 ? (
                <BadgeCheck size={18} aria-hidden="true" />
              ) : (
                <Car size={18} aria-hidden="true" />
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
                    Для этого автомобиля пока нет проверенных данных о подходящих размерах.
                  </small>
                )}
              </div>
              <button
                type="button"
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
                <X size={15} aria-hidden="true" /> Сбросить
              </button>
            </div>
          )}
          <div className="catalog-layout">
            <aside className="catalog-sidebar" aria-label="Фильтры каталога">{renderFilterPanel("sidebar")}</aside>
            <div className="catalog-main" aria-busy={catalogStatus === "loading"}>
              <div className="catalog-toolbar">
                <button type="button" className="mobile-filter-button" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={18} aria-hidden="true" /> Фильтры</button>
                <span>Найдено <strong>{catalogStatus === "error" || (catalogStatus === "loading" && filteredProducts.length === 0) ? "—" : foundCount}</strong></span>
                <label>Сортировка
                  <select value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as CatalogFilters["sort"] }))}>
                    <option value="popular">Сначала новые</option>
                    <option value="price-asc">Сначала дешевле</option>
                    <option value="price-desc">Сначала дороже</option>
                    {businessConfig.catalog.ratingsEnabled && <option value="rating">По рейтингу</option>}
                  </select>
                </label>
              </div>
              <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{catalogAnnouncement}</p>
              {catalogStatus === "error" ? (
                <div className="no-results catalog-error">
                  <RotateCw size={34} aria-hidden="true" />
                  <h3>Каталог временно недоступен</h3>
                  <p>Не удалось загрузить товары. Проверьте подключение к интернету и попробуйте ещё раз.</p>
                  <button type="button" className="secondary-button" onClick={() => setCatalogReloadToken((token) => token + 1)}>
                    <RotateCw size={16} aria-hidden="true" /> Повторить
                  </button>
                </div>
              ) : catalogStatus === "loading" && filteredProducts.length === 0 ? (
                <div className="catalog-loading">
                  <p className="catalog-loading-text">Загружаем каталог…</p>
                  <div className="product-grid">
                    {Array.from({ length: 8 }, (_, index) => <ProductCardSkeleton key={index} />)}
                  </div>
                </div>
              ) : filteredProducts.length > 0 ? (
                <>
                  <div className={catalogStatus === "loading" ? "product-grid is-updating" : "product-grid"}>
                    {(databaseCatalogEnabled ? filteredProducts : filteredProducts.slice(0, visible)).map((product) => (
                      <ProductCard key={product.id} product={product} onQuickView={setQuickView} notify={notify} />
                    ))}
                  </div>
                  {!databaseCatalogEnabled && visible < filteredProducts.length && (
                    <button type="button" className="load-more" onClick={() => setVisible((n) => n + 8)}>Показать ещё <Plus size={17} aria-hidden="true" /></button>
                  )}
                  {databaseCatalogEnabled && serverCatalogTotalPages > 1 && (
                    <nav className="catalog-pagination" aria-label="Страницы каталога">
                      <button type="button" className="load-more" disabled={catalogPage <= 1 || catalogStatus === "loading"} onClick={() => goToCatalogPage(Math.max(1, catalogPage - 1))}>Назад</button>
                      <span>Страница {catalogPage} из {serverCatalogTotalPages}</span>
                      <button type="button" className="load-more" disabled={catalogPage >= serverCatalogTotalPages || catalogStatus === "loading"} onClick={() => goToCatalogPage(catalogPage + 1)}>Далее</button>
                    </nav>
                  )}
                </>
              ) : (
                <div className="no-results">
                  <Search size={34} aria-hidden="true" />
                  <h3>Ничего не нашли</h3>
                  <p>Попробуйте изменить параметры или оставьте запрос эксперту.</p>
                  <button type="button" className="secondary-button" onClick={resetFilters}>Сбросить фильтры</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {businessConfig.services.tireService && <section className="service-section" id="services">
        <div className="container service-grid">
          <div className="service-visual" aria-hidden="true">
            <span className="service-number">01</span>
            <div className="service-wheel"><span /><i /><i /><i /><i /><i /></div>
            <div className="service-caption"><strong>{businessConfig.brandName}</strong><span>Шиномонтаж</span></div>
          </div>
          <div className="service-copy">
            <p className="eyebrow">Сервис полного цикла</p>
            <h2>Не просто продаём.<br />Отвечаем за результат.</h2>
            <p>Возможность монтажа и условия работ подтверждаются при обработке заказа.</p>
            <div className="service-steps">
              <div><span>01</span><p><strong>Подбор</strong>По марке, модели и поколению автомобиля</p></div>
              <div><span>02</span><p><strong>Проверка</strong>Контроль параметров автомобиля</p></div>
              <div><span>03</span><p><strong>Установка</strong>Условия подтвердит менеджер</p></div>
            </div>
            <button type="button" className="dark-outline-button" onClick={handleCarSelectorLinkClick}>Подобрать по автомобилю <ArrowRight size={17} aria-hidden="true" /></button>
          </div>
        </div>
      </section>}

      {businessConfig.contacts.phone && <section className="consult-section">
        <div className="container consult-inner">
          <div>
            <p className="eyebrow">Остались вопросы?</p>
            <h2>Свяжитесь<br />с магазином</h2>
          </div>
          <div className="consult-copy"><p>Уточните наличие, параметры товара и доступные способы получения.</p><a href={normalizeTelephoneHref(businessConfig.contacts.phone)}><Phone size={17} aria-hidden="true" /> {businessConfig.contacts.phone}</a></div>
          <Link className="light-button" href="/contacts">Все способы связи <ArrowRight size={17} aria-hidden="true" /></Link>
        </div>
      </section>}
      </main>

      <footer id="about">
        <div className="container footer-grid">
          <div className="footer-brand">
            <Link href="/" className="brand-logo light" aria-label={`${businessConfig.brandName} — на главную`}><span className="logo-mark" aria-hidden="true"><i /><i /><i /></span><BrandWordmark /></Link>
            <p>Каталог шин и дисков в {businessConfig.location.cityPrepositional}.</p>
            {businessConfig.contacts.phone && <strong>{businessConfig.contacts.phone}</strong>}
            {businessConfig.workingHours && <span>{businessConfig.workingHours}</span>}
          </div>
          <div>
            <h2 className="footer-title">Каталог</h2>
            <Link href="/shiny#catalog" onClick={(event) => handleCategoryLinkClick(event, "tire")}>Шины</Link>
            <Link href="/diski#catalog" onClick={(event) => handleCategoryLinkClick(event, "wheel")}>Диски</Link>
            <Link href="/#selector" onClick={handleCarSelectorLinkClick}>Подбор по автомобилю</Link>
            {businessConfig.services.tireService && <a href="#services">Шиномонтаж</a>}
          </div>
          <div><h2 className="footer-title">Покупателям</h2><Link href="/legal/delivery-payment-returns">Доставка и оплата</Link><Link href="/legal/delivery-payment-returns">Гарантия и возврат</Link><Link href="/legal/offer">Публичная оферта</Link><Link href="/legal/terms">Правила пользования</Link></div>
          <div><h2 className="footer-title">Компания</h2><Link href="/contacts">Контакты</Link><Link href="/legal/requisites">Реквизиты</Link><Link href="/legal/privacy">Персональные данные</Link><button type="button" onClick={openCookieSettings}>Настройки cookie</button></div>
        </div>
        <div className="container footer-bottom"><span>© 2026 {businessConfig.brandName}</span><Link href="/legal">Правовая информация</Link><Link href="/legal/privacy">Политика конфиденциальности</Link></div>
      </footer>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} notify={notify} />
      <QuickView product={quickView} onClose={() => setQuickView(null)} notify={notify} />
      <AccountPanel open={accountOpen} onClose={() => setAccountOpen(false)} />
      <CollectionDrawer open={Boolean(collection)} onClose={() => setCollection(null)} mode={collection || "favorites"} notify={notify} />
      <Overlay open={filtersOpen} onClose={() => setFiltersOpen(false)} className="filter-overlay">
        <div className="mobile-filters" role="dialog" aria-modal="true" aria-labelledby="mobile-filters-title">{renderFilterPanel("dialog")}</div>
      </Overlay>
      {/* Persistent live region; stays active while a dialog is open. */}
      <div className="toast-region" role="status" aria-live="polite" data-dialog-keep-active="">
        {toast && (
          <div className={toast.tone === "error" ? "toast error" : "toast"} key={toast.id}>
            {toast.tone === "error" ? <CircleAlert size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} {toast.message}
          </div>
        )}
      </div>
    </>
  );
}

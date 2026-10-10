"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { seedProducts } from "@/lib/catalog-data";
import { businessConfig } from "@/config/business";
import type { CartLine, Product, UserProfile } from "@/lib/types";

/** Outcome of a cart change, known once it is saved (database mode). */
export interface CartChangeResult {
  /** The change is stored (database mode) or applied locally (preview). */
  ok: boolean;
  /** Quantity of the line after the change; 0 when it is not in the cart. */
  quantity: number;
  /** The requested quantity was reduced to the allowed maximum. */
  limited: boolean;
  /** Allowed maximum for this line (see getCartLineLimit). */
  maxQuantity: number;
  /** Why the change was not saved, ready to show to the visitor. */
  message?: string;
}

interface StoreContextValue {
  products: Product[];
  cart: CartLine[];
  favorites: string[];
  compare: string[];
  user: UserProfile | null;
  hydrated: boolean;
  cartError: string;
  mergeCatalogProducts: (products: Product[]) => void;
  /** Adds to the line; the promise settles when the cart is saved. */
  addToCart: (productId: string, quantity?: number) => Promise<CartChangeResult>;
  setCartQuantity: (productId: string, quantity: number) => Promise<CartChangeResult>;
  clearCart: () => void;
  toggleFavorite: (productId: string) => void;
  toggleCompare: (productId: string) => void;
  authenticateUser: (profile: UserProfile) => void;
  logout: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

/** Upper limit for one cart line in the storefront. */
export const MAX_CART_LINE_QUANTITY = 8;

const CART_UNAVAILABLE_MESSAGE = "Корзина временно недоступна, попробуйте позже.";
const CART_NOT_SAVED_MESSAGE = "Корзина не сохранена. Проверьте соединение и попробуйте ещё раз.";

/**
 * Maximum quantity of one cart line: the storefront limit, and in database
 * mode with the "exact" availability display also the free stock
 * (stock − reserved). Other display modes hide the quantity from buyers,
 * so the limit does not reveal it; the server checks stock at checkout.
 */
export function getCartLineLimit(
  product?: Pick<Product, "stock" | "reserved"> | null,
): number {
  if (
    !product ||
    businessConfig.catalog.dataMode !== "database" ||
    businessConfig.catalog.availabilityDisplayMode !== "exact"
  ) {
    return MAX_CART_LINE_QUANTITY;
  }
  return Math.max(0, Math.min(MAX_CART_LINE_QUANTITY, product.stock - product.reserved));
}

function quantitiesById(lines: CartLine[]): Map<string, number> {
  return new Map(lines.map((line) => [line.productId, line.quantity]));
}

function cartsAreEqual(left: CartLine[], right: CartLine[]): boolean {
  if (left.length !== right.length) return false;
  const rightQuantities = quantitiesById(right);
  return left.every((line) => rightQuantities.get(line.productId) === line.quantity);
}

/**
 * Applies the visitor's unsaved changes (current − baseline, per product) to
 * the cart loaded from the server: additions are summed with the server
 * quantity and capped by `limitFor`; removals and decreases are kept.
 */
function mergeUnsavedChanges(
  serverLines: CartLine[],
  currentLines: CartLine[],
  baselineLines: CartLine[],
  limitFor: (productId: string) => number,
): CartLine[] {
  const merged = quantitiesById(serverLines);
  const baseline = quantitiesById(baselineLines);
  const current = quantitiesById(currentLines);
  for (const productId of new Set([...baseline.keys(), ...current.keys()])) {
    const delta = (current.get(productId) ?? 0) - (baseline.get(productId) ?? 0);
    if (delta === 0) continue;
    const serverQuantity = merged.get(productId) ?? 0;
    const quantity =
      delta > 0
        ? Math.min(serverQuantity + delta, Math.max(serverQuantity, limitFor(productId)))
        : serverQuantity + delta;
    if (quantity > 0) merged.set(productId, quantity);
    else merged.delete(productId);
  }
  // Keep the server order, then lines that exist only locally.
  const order = [...serverLines.map((line) => line.productId), ...currentLines.map((line) => line.productId)];
  return Array.from(new Set(order))
    .filter((productId) => merged.has(productId))
    .map((productId) => ({ productId, quantity: merged.get(productId) as number }));
}

/**
 * Only the visitor's own selections are kept in the browser (product ids and
 * quantities). The catalog itself always comes from the current build
 * (preview) or from the server (database mode).
 */
const BROWSER_STORAGE_KEYS = {
  cart: "apex.cart.v1",
  favorites: "apex.favorites.v1",
  compare: "apex.compare.v1",
};

/** Former full-catalog snapshot; removed on load (it hid catalog updates). */
const LEGACY_PRODUCTS_STORAGE_KEY = "apex.products.v1";

function readBrowserStorage<T>(key: string, fallbackValue: T): T {
  try {
    const serializedValue = window.localStorage.getItem(key);
    return serializedValue
      ? (JSON.parse(serializedValue) as T)
      : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function writeBrowserStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: selections then live for this visit only.
  }
}

function isStoredProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object") return false;
  const product = value as Partial<Product>;
  return (
    typeof product.id === "string" &&
    (product.kind === "tire" || product.kind === "wheel") &&
    typeof product.brand === "string" &&
    typeof product.model === "string" &&
    typeof product.price === "number"
  );
}

/** Products read from the legacy snapshot (kept for this page's lifetime). */
let legacyProductsOfThisVisit: Product[] | null = null;

/**
 * Deletes the legacy catalog snapshot. Products from it that the visitor has
 * in the cart, favorites or comparison but that are not in the current demo
 * catalog (created in an older preview admin) are returned, so these
 * selections stay visible during this visit. Idempotent: effects may run
 * twice (React Strict Mode) and the key is already gone the second time.
 */
function takeLegacyReferencedProducts(referencedIds: Set<string>): Product[] {
  if (legacyProductsOfThisVisit === null) {
    legacyProductsOfThisVisit = [];
    let serializedProducts: string | null = null;
    try {
      serializedProducts = window.localStorage.getItem(LEGACY_PRODUCTS_STORAGE_KEY);
      if (serializedProducts !== null) {
        window.localStorage.removeItem(LEGACY_PRODUCTS_STORAGE_KEY);
      }
    } catch {
      serializedProducts = null;
    }
    try {
      const storedProducts: unknown = serializedProducts ? JSON.parse(serializedProducts) : [];
      const currentIds = new Set(seedProducts.map((product) => product.id));
      if (Array.isArray(storedProducts)) {
        legacyProductsOfThisVisit = storedProducts.filter(
          (product): product is Product =>
            isStoredProduct(product) && !currentIds.has(product.id),
        );
      }
    } catch {
      // Corrupted snapshot: nothing to keep.
    }
  }
  return legacyProductsOfThisVisit.filter((product) => referencedIds.has(product.id));
}

/**
 * Provides interactive catalog, cart and authenticated user state.
 *
 * Browser storage keeps only the visitor's selections (cart in preview,
 * favorites, comparison) as product ids and quantities. Production cart
 * ownership and prices are established by server sessions and PostgreSQL.
 */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const catalogIsPreview = businessConfig.catalog.dataMode === "preview";
  const [products, setProducts] = useState<Product[]>(
    catalogIsPreview ? seedProducts : [],
  );
  const [cart, setCart] = useState<CartLine[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [cartLoadedForOwner, setCartLoadedForOwner] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [cartError, setCartError] = useState("");

  // Database-mode cart synchronisation. The cart is read once per owner
  // (guest or signed-in user) and written only after the visitor changes it:
  // - cartRef: the cart as displayed, updated synchronously by every change;
  // - savedCartRef: the part of it the server already has (baseline for
  //   merging changes made while the server cart is still loading);
  // - changeRevisionRef / savedRevisionRef: unsaved changes exist while they
  //   differ; saveWaitersRef settles the promises of addToCart & co.
  const cartRef = useRef<CartLine[]>([]);
  const savedCartRef = useRef<CartLine[]>([]);
  const productsRef = useRef<Product[]>(products);
  const changeRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const cartLoadFailedRef = useRef(false);
  const saveWaitersRef = useRef<
    Array<{ revision: number; settle: (saved: boolean, message?: string) => void }>
  >([]);
  const [saveRequest, setSaveRequest] = useState(0);
  const [cartReloadRequest, setCartReloadRequest] = useState(0);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const commitCart = useCallback((lines: CartLine[]) => {
    cartRef.current = lines;
    setCart(lines);
  }, []);

  /** Settles the promises of changes up to `revision`. */
  const settleSaveWaiters = useCallback(
    (revision: number, saved: boolean, message?: string) => {
      const waiting = saveWaitersRef.current;
      saveWaitersRef.current = waiting.filter((waiter) => waiter.revision > revision);
      for (const waiter of waiting) {
        if (waiter.revision <= revision) waiter.settle(saved, message);
      }
    },
    [],
  );

  const limitFor = useCallback(
    (productId: string, extraProducts: Product[] = []) =>
      getCartLineLimit(
        extraProducts.find((product) => product.id === productId) ??
          productsRef.current.find((product) => product.id === productId),
      ),
    [],
  );

  useEffect(() => {
    const storedCart = catalogIsPreview
      ? readBrowserStorage<CartLine[]>(BROWSER_STORAGE_KEYS.cart, [])
      : [];
    const storedFavorites = readBrowserStorage<string[]>(BROWSER_STORAGE_KEYS.favorites, []);
    const storedCompare = readBrowserStorage<string[]>(BROWSER_STORAGE_KEYS.compare, []);
    const legacyProducts = takeLegacyReferencedProducts(
      new Set([
        ...(Array.isArray(storedCart) ? storedCart.map((line) => line.productId) : []),
        ...(Array.isArray(storedFavorites) ? storedFavorites : []),
        ...(Array.isArray(storedCompare) ? storedCompare : []),
      ]),
    );
    // Database mode keeps what children already merged (server-rendered
    // catalog page, product page): their effects run before this one.
    if (catalogIsPreview) setProducts([...seedProducts, ...legacyProducts]);
    commitCart(Array.isArray(storedCart) ? storedCart : []);
    setFavorites(storedFavorites);
    setCompare(storedCompare);
    setUser(null);
    setHydrated(true);

    void fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.ok) {
          const result = (await response.json()) as {
            user?: UserProfile;
          };
          if (result.user) setUser(result.user);
        } else if (response.status === 401) {
          setUser(null);
        }
      })
      .catch(() => {
        // A temporary API outage must not break the rest of the SPA.
      });
  }, [catalogIsPreview, commitCart]);

  useEffect(() => {
    if (!hydrated) return;
    if (catalogIsPreview) writeBrowserStorage(BROWSER_STORAGE_KEYS.cart, cart);
    writeBrowserStorage(BROWSER_STORAGE_KEYS.favorites, favorites);
    writeBrowserStorage(BROWSER_STORAGE_KEYS.compare, compare);
  }, [cart, favorites, compare, hydrated, catalogIsPreview]);

  // Read the server cart for the current owner. Changes the visitor made
  // before it arrived are merged into it, never overwritten.
  useEffect(() => {
    if (!hydrated || catalogIsPreview) {
      setCartLoadedForOwner(null);
      return;
    }
    const ownerKey = user?.id ?? "guest";
    const abortController = new AbortController();
    void fetch("/api/v1/account/cart", {
      credentials: "same-origin",
      cache: "no-store",
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Cart request failed");
        return response.json() as Promise<{ items?: CartLine[]; products?: Product[] }>;
      })
      .then((result) => {
        const serverLines = result.items ?? [];
        const serverProducts = result.products ?? [];
        setProducts((current) => {
          const byId = new Map(current.map((product) => [product.id, product]));
          for (const product of serverProducts) byId.set(product.id, product);
          return Array.from(byId.values());
        });
        const merged = mergeUnsavedChanges(
          serverLines,
          cartRef.current,
          savedCartRef.current,
          (productId) => limitFor(productId, serverProducts),
        );
        savedCartRef.current = serverLines;
        commitCart(merged);
        cartLoadFailedRef.current = false;
        setCartError("");
        if (cartsAreEqual(merged, serverLines)) {
          // Nothing to write: the visitor's changes (if any) cancelled out.
          savedRevisionRef.current = changeRevisionRef.current;
          settleSaveWaiters(changeRevisionRef.current, true);
        } else {
          changeRevisionRef.current += 1;
        }
        setCartLoadedForOwner(ownerKey);
        setSaveRequest((request) => request + 1);
      })
      .catch(() => {
        if (abortController.signal.aborted) return;
        cartLoadFailedRef.current = true;
        setCartLoadedForOwner(null);
        setCartError(CART_UNAVAILABLE_MESSAGE);
        settleSaveWaiters(changeRevisionRef.current, false, CART_UNAVAILABLE_MESSAGE);
      });
    return () => abortController.abort();
  }, [catalogIsPreview, cartReloadRequest, commitCart, hydrated, limitFor, settleSaveWaiters, user]);

  // Write the cart only when it has unsaved changes made by the visitor
  // (or by the merge above). Page views alone never write.
  useEffect(() => {
    const ownerKey = user?.id ?? "guest";
    if (catalogIsPreview || cartLoadedForOwner !== ownerKey) return;
    if (changeRevisionRef.current === savedRevisionRef.current) {
      settleSaveWaiters(savedRevisionRef.current, true);
      return;
    }
    if (saveInFlightRef.current) return;
    const timeout = window.setTimeout(() => {
      const revision = changeRevisionRef.current;
      const lines = cartRef.current;
      saveInFlightRef.current = true;
      let saved = false;
      void fetch("/api/v1/account/cart", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: lines }),
      })
        .then(async (response) => {
          const result = (await response.json().catch(() => null)) as {
            message?: string;
            products?: Product[];
          } | null;
          if (!response.ok) throw new Error(result?.message || CART_NOT_SAVED_MESSAGE);
          saved = true;
          savedCartRef.current = lines;
          savedRevisionRef.current = Math.max(savedRevisionRef.current, revision);
          setCartError("");
          setProducts((current) => {
            const byId = new Map(current.map((product) => [product.id, product]));
            for (const product of result?.products ?? []) byId.set(product.id, product);
            return Array.from(byId.values());
          });
          settleSaveWaiters(revision, true);
        })
        .catch((error: unknown) => {
          // The local cart is kept; the next change retries the save.
          // TypeError: network failure (no response); otherwise the server text.
          const message = error instanceof Error && !(error instanceof TypeError)
            ? error.message
            : CART_NOT_SAVED_MESSAGE;
          setCartError(message);
          settleSaveWaiters(revision, false, message);
        })
        .finally(() => {
          saveInFlightRef.current = false;
          if (saved && changeRevisionRef.current !== savedRevisionRef.current) {
            setSaveRequest((request) => request + 1);
          }
        });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [cartLoadedForOwner, catalogIsPreview, saveRequest, settleSaveWaiters, user]);

  /**
   * Applies a change to one cart line and returns its outcome: at once in
   * preview mode, after the save in database mode.
   */
  const changeCartLine = useCallback(
    (productId: string, nextQuantity: (currentQuantity: number) => number): Promise<CartChangeResult> => {
      const current = cartRef.current;
      const currentQuantity = current.find((line) => line.productId === productId)?.quantity ?? 0;
      const maxQuantity = limitFor(productId);
      const requested = Math.max(0, nextQuantity(currentQuantity));
      // Never raise a line above the limit; an existing larger quantity is
      // only allowed to go down.
      const quantity = requested > currentQuantity
        ? Math.max(currentQuantity, Math.min(requested, maxQuantity))
        : requested;
      const limited = requested > quantity;
      const result: Omit<CartChangeResult, "ok" | "message"> = { quantity, limited, maxQuantity };

      if (quantity === currentQuantity) {
        return Promise.resolve({ ...result, ok: true });
      }
      const next = quantity === 0
        ? current.filter((line) => line.productId !== productId)
        : currentQuantity === 0
          ? [...current, { productId, quantity }]
          : current.map((line) => (line.productId === productId ? { ...line, quantity } : line));
      commitCart(next);
      if (catalogIsPreview) return Promise.resolve({ ...result, ok: true });

      changeRevisionRef.current += 1;
      const revision = changeRevisionRef.current;
      const outcome = new Promise<CartChangeResult>((resolve) => {
        saveWaitersRef.current.push({
          revision,
          settle: (saved, message) => resolve({ ...result, ok: saved, message }),
        });
      });
      if (cartLoadFailedRef.current) {
        // The server cart could not be read: try again, the change is merged.
        cartLoadFailedRef.current = false;
        setCartReloadRequest((request) => request + 1);
      }
      setSaveRequest((request) => request + 1);
      return outcome;
    },
    [catalogIsPreview, commitCart, limitFor],
  );

  const addToCart = useCallback(
    (productId: string, quantity = 1) =>
      changeCartLine(productId, (currentQuantity) => currentQuantity + quantity),
    [changeCartLine],
  );

  const setCartQuantity = useCallback(
    (productId: string, quantity: number) => changeCartLine(productId, () => quantity),
    [changeCartLine],
  );

  const clearCart = useCallback(() => {
    if (cartRef.current.length === 0) return;
    commitCart([]);
    if (catalogIsPreview) return;
    changeRevisionRef.current += 1;
    setSaveRequest((request) => request + 1);
  }, [catalogIsPreview, commitCart]);

  const toggleFavorite = useCallback((productId: string) => {
    setFavorites((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }, []);

  const toggleCompare = useCallback((productId: string) => {
    setCompare((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : current.length >= 4
          ? [...current.slice(1), productId]
          : [...current, productId],
    );
  }, []);

  const mergeCatalogProducts = useCallback((nextProducts: Product[]) => {
    setProducts((current) => {
      const productsById = new Map(current.map((product) => [product.id, product]));
      for (const product of nextProducts) productsById.set(product.id, product);
      return Array.from(productsById.values());
    });
  }, []);

  const value = useMemo<StoreContextValue>(
    () => ({
      products,
      cart,
      favorites,
      compare,
      user,
      hydrated,
      cartError,
      mergeCatalogProducts,
      addToCart,
      setCartQuantity,
      clearCart,
      toggleFavorite,
      toggleCompare,
      authenticateUser: setUser,
      logout: () => {
        setUser(null);
        setCartLoadedForOwner(null);
        void fetch("/api/auth/session", {
          method: "DELETE",
          credentials: "same-origin",
        }).catch(() => undefined);
      },
    }),
    [
      products,
      cart,
      favorites,
      compare,
      user,
      hydrated,
      cartError,
      addToCart,
      setCartQuantity,
      clearCart,
      toggleFavorite,
      toggleCompare,
      mergeCatalogProducts,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside StoreProvider");
  return value;
}

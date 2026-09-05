"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { seedProducts } from "@/lib/catalog-data";
import { businessConfig } from "@/config/business";
import type { CartLine, Product, UserProfile } from "@/lib/types";

interface StoreContextValue {
  products: Product[];
  cart: CartLine[];
  favorites: string[];
  compare: string[];
  user: UserProfile | null;
  hydrated: boolean;
  cartError: string;
  mergeCatalogProducts: (products: Product[]) => void;
  addToCart: (productId: string, quantity?: number) => void;
  setCartQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  toggleFavorite: (productId: string) => void;
  toggleCompare: (productId: string) => void;
  authenticateUser: (profile: UserProfile) => void;
  logout: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

const BROWSER_STORAGE_KEYS = {
  products: "apex.products.v1",
  cart: "apex.cart.v1",
  favorites: "apex.favorites.v1",
  compare: "apex.compare.v1",
};

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

/**
 * Provides interactive catalog, cart and authenticated user state.
 *
 * Browser storage is a preview convenience. Production cart ownership and prices
 * are established by server sessions and PostgreSQL.
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

  useEffect(() => {
    if (catalogIsPreview) {
      setProducts(
        readBrowserStorage(BROWSER_STORAGE_KEYS.products, seedProducts),
      );
    } else setProducts([]);
    setCart(catalogIsPreview ? readBrowserStorage(BROWSER_STORAGE_KEYS.cart, []) : []);
    setFavorites(
      readBrowserStorage(BROWSER_STORAGE_KEYS.favorites, []),
    );
    setCompare(readBrowserStorage(BROWSER_STORAGE_KEYS.compare, []));
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
  }, [catalogIsPreview]);

  useEffect(() => {
    if (!hydrated) return;
    if (catalogIsPreview) {
      localStorage.setItem(
        BROWSER_STORAGE_KEYS.products,
        JSON.stringify(products),
      );
    }
    if (catalogIsPreview) localStorage.setItem(
      BROWSER_STORAGE_KEYS.cart,
      JSON.stringify(cart),
    );
    localStorage.setItem(
      BROWSER_STORAGE_KEYS.favorites,
      JSON.stringify(favorites),
    );
    localStorage.setItem(
      BROWSER_STORAGE_KEYS.compare,
      JSON.stringify(compare),
    );
  }, [products, cart, favorites, compare, hydrated, catalogIsPreview]);

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
        setProducts((current) => {
          const byId = new Map(current.map((product) => [product.id, product]));
          for (const product of result.products ?? []) byId.set(product.id, product);
          return Array.from(byId.values());
        });
        setCart(result.items ?? []);
        setCartError("");
        setCartLoadedForOwner(ownerKey);
      })
      .catch(() => { if (!abortController.signal.aborted) { setCartLoadedForOwner(null); setCartError("Не удалось загрузить корзину. Обновите страницу."); } });
    return () => abortController.abort();
  }, [catalogIsPreview, hydrated, user]);

  useEffect(() => {
    const ownerKey = user?.id ?? "guest";
    if (cartLoadedForOwner !== ownerKey || catalogIsPreview) return;
    const timeout = window.setTimeout(() => {
      void fetch("/api/v1/account/cart", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cart }),
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Корзина не сохранена. Повторите попытку.");
        setCartError("");
        setProducts((current) => {
          const byId = new Map(current.map((product) => [product.id,product]));
          for (const product of (result.products ?? []) as Product[]) byId.set(product.id, product);
          return Array.from(byId.values());
        });
      }).catch((error: unknown) => setCartError(error instanceof Error ? error.message : "Корзина не сохранена. Проверьте соединение."));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [cart, cartLoadedForOwner, catalogIsPreview, user]);

  const addToCart = useCallback((productId: string, quantity = 1) => {
    setCart((current) => {
      const line = current.find((item) => item.productId === productId);
      if (line) {
        return current.map((item) =>
          item.productId === productId
            ? { ...item, quantity: Math.min(8, item.quantity + quantity) }
            : item,
        );
      }
      return [...current, { productId, quantity }];
    });
  }, []);

  const setCartQuantity = useCallback((productId: string, quantity: number) => {
    setCart((current) =>
      quantity <= 0
        ? current.filter((item) => item.productId !== productId)
        : current.map((item) =>
            item.productId === productId ? { ...item, quantity: Math.min(8, quantity) } : item,
          ),
    );
  }, []);

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
      clearCart: () => setCart([]),
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

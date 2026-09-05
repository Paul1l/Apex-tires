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
 * Catalog editing remains a browser prototype. Customer identity is established
 * by the server OTP API; only a display-safe profile is cached locally.
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
  const [cartLoadedForUserId, setCartLoadedForUserId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (catalogIsPreview) {
      setProducts(
        readBrowserStorage(BROWSER_STORAGE_KEYS.products, seedProducts),
      );
    } else {
      setProducts([]);
      void fetch("/api/v1/products", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Catalog request failed");
          const result = (await response.json()) as { items?: Product[] };
          setProducts(result.items ?? []);
        })
        .catch(() => setProducts([]));
    }
    setCart(readBrowserStorage(BROWSER_STORAGE_KEYS.cart, []));
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
    localStorage.setItem(
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
    if (!hydrated || !user || catalogIsPreview) {
      setCartLoadedForUserId(null);
      return;
    }
    const abortController = new AbortController();
    void fetch("/api/v1/account/cart", {
      credentials: "same-origin",
      cache: "no-store",
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Cart request failed");
        return response.json() as Promise<{ items?: CartLine[] }>;
      })
      .then((result) => {
        setCart((localItems) => {
          const quantityByProductId = new Map<string, number>();
          for (const item of [...(result.items ?? []), ...localItems]) {
            quantityByProductId.set(
              item.productId,
              Math.max(quantityByProductId.get(item.productId) ?? 0, item.quantity),
            );
          }
          return Array.from(quantityByProductId, ([productId, quantity]) => ({
            productId,
            quantity,
          }));
        });
        setCartLoadedForUserId(user.id);
      })
      .catch(() => setCartLoadedForUserId(null));
    return () => abortController.abort();
  }, [catalogIsPreview, hydrated, user]);

  useEffect(() => {
    if (!user || cartLoadedForUserId !== user.id || catalogIsPreview) return;
    const timeout = window.setTimeout(() => {
      void fetch("/api/v1/account/cart", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cart }),
      }).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [cart, cartLoadedForUserId, catalogIsPreview, user]);

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

  const value = useMemo<StoreContextValue>(
    () => ({
      products,
      cart,
      favorites,
      compare,
      user,
      hydrated,
      addToCart,
      setCartQuantity,
      clearCart: () => setCart([]),
      toggleFavorite,
      toggleCompare,
      authenticateUser: setUser,
      logout: () => {
        setUser(null);
        setCartLoadedForUserId(null);
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
      addToCart,
      setCartQuantity,
      toggleFavorite,
      toggleCompare,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside StoreProvider");
  return value;
}

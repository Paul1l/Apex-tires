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
  login: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
  authenticateUser: (profile: UserProfile) => void;
  loginAsDemoAdmin: () => void;
  logout: () => void;
  saveProduct: (product: Product) => void;
  deleteProduct: (productId: string) => void;
  resetProducts: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

const BROWSER_STORAGE_KEYS = {
  products: "apex.products.v1",
  cart: "apex.cart.v1",
  favorites: "apex.favorites.v1",
  compare: "apex.compare.v1",
  user: "apex.user.v1",
};

const DEMO_ADMIN_USER: UserProfile = {
  id: "admin-demo",
  name: "Александр",
  email: "admin@apex.local",
  role: "admin",
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
  const [products, setProducts] = useState<Product[]>(seedProducts);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setProducts(
      readBrowserStorage(BROWSER_STORAGE_KEYS.products, seedProducts),
    );
    setCart(readBrowserStorage(BROWSER_STORAGE_KEYS.cart, []));
    setFavorites(
      readBrowserStorage(BROWSER_STORAGE_KEYS.favorites, []),
    );
    setCompare(readBrowserStorage(BROWSER_STORAGE_KEYS.compare, []));
    const cachedUser = readBrowserStorage<UserProfile | null>(
      BROWSER_STORAGE_KEYS.user,
      null,
    );
    setUser(cachedUser);
    setHydrated(true);

    if (cachedUser?.id !== DEMO_ADMIN_USER.id) {
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
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      BROWSER_STORAGE_KEYS.products,
      JSON.stringify(products),
    );
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
    localStorage.setItem(
      BROWSER_STORAGE_KEYS.user,
      JSON.stringify(user),
    );
  }, [products, cart, favorites, compare, user, hydrated]);

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

  const login = useCallback(async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (
      normalizedEmail === DEMO_ADMIN_USER.email &&
      password === "Apex2026!"
    ) {
      setUser(DEMO_ADMIN_USER);
      return { ok: true, message: "Вход выполнен" };
    }
    return {
      ok: false,
      message: "Для покупателей используется вход по коду из письма.",
    };
  }, []);

  const saveProduct = useCallback((product: Product) => {
    setProducts((current) => {
      const exists = current.some((item) => item.id === product.id);
      return exists
        ? current.map((item) => (item.id === product.id ? product : item))
        : [product, ...current];
    });
  }, []);

  const deleteProduct = useCallback((productId: string) => {
    setProducts((current) => current.filter((item) => item.id !== productId));
    setCart((current) => current.filter((item) => item.productId !== productId));
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
      login,
      authenticateUser: setUser,
      loginAsDemoAdmin: () => setUser(DEMO_ADMIN_USER),
      logout: () => {
        setUser(null);
        void fetch("/api/auth/session", {
          method: "DELETE",
          credentials: "same-origin",
        }).catch(() => undefined);
      },
      saveProduct,
      deleteProduct,
      resetProducts: () => setProducts(seedProducts),
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
      login,
      saveProduct,
      deleteProduct,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside StoreProvider");
  return value;
}

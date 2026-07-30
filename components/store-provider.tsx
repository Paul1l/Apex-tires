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
import type { CartLine, Product, SavedUser, UserProfile } from "@/lib/types";

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
  register: (name: string, email: string, password: string) => Promise<{ ok: boolean; message: string }>;
  login: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
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
  users: "apex.users.v1",
};

const DEMO_ADMIN_USER: SavedUser = {
  id: "admin-demo",
  name: "Александр",
  email: "admin@apex.local",
  role: "admin",
  passwordHash: "",
};

/**
 * Produces a deterministic hash for the offline demonstration only.
 * Production authentication must use a server-side password algorithm such as
 * Argon2id and must never store credentials in localStorage.
 */
async function hashDemoPassword(password: string) {
  const data = new TextEncoder().encode(`apex-demo:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

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
 * Provides interactive catalog, cart and demo authentication state.
 *
 * This adapter intentionally uses the browser so the private prototype works
 * without infrastructure. Replace it with server repositories before accepting
 * real registrations or orders; see docs/ARCHITECTURE.md.
 */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>(seedProducts);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [users, setUsers] = useState<SavedUser[]>([]);
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
    setUser(readBrowserStorage(BROWSER_STORAGE_KEYS.user, null));
    setUsers(readBrowserStorage(BROWSER_STORAGE_KEYS.users, []));
    setHydrated(true);
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
    localStorage.setItem(
      BROWSER_STORAGE_KEYS.users,
      JSON.stringify(users),
    );
  }, [products, cart, favorites, compare, user, users, hydrated]);

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

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const normalizedEmail = email.trim().toLowerCase();
      if (users.some((item) => item.email === normalizedEmail)) {
        return { ok: false, message: "Аккаунт с этой почтой уже существует" };
      }
      const passwordHash = await hashDemoPassword(password);
      const profile: SavedUser = {
        id: crypto.randomUUID(),
        name: name.trim(),
        email: normalizedEmail,
        role: "customer",
        passwordHash,
      };
      setUsers((current) => [...current, profile]);
      const {
        passwordHash: storedPasswordHash,
        ...safeProfile
      } = profile;
      void storedPasswordHash;
      setUser(safeProfile);
      return { ok: true, message: "Аккаунт создан" };
    },
    [users],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const normalizedEmail = email.trim().toLowerCase();
      if (
        normalizedEmail === DEMO_ADMIN_USER.email &&
        password === "Apex2026!"
      ) {
        setUser(DEMO_ADMIN_USER);
        return { ok: true, message: "Вход выполнен" };
      }
      const passwordHash = await hashDemoPassword(password);
      const matched = users.find(
        (item) => item.email === normalizedEmail && item.passwordHash === passwordHash,
      );
      if (!matched) {
        return { ok: false, message: "Проверьте почту и пароль" };
      }
      const {
        passwordHash: storedPasswordHash,
        ...safeProfile
      } = matched;
      void storedPasswordHash;
      setUser(safeProfile);
      return { ok: true, message: "Вход выполнен" };
    },
    [users],
  );

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
      register,
      login,
      loginAsDemoAdmin: () => setUser(DEMO_ADMIN_USER),
      logout: () => setUser(null),
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
      register,
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

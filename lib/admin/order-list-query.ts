/**
 * Filters of the admin order list as they appear in the URL
 * (`/admin/orders?q=…&status=…`) and in `GET /api/admin/orders`. The server
 * validates the same names with `adminOrderListQuerySchema`.
 */

export const ADMIN_ORDER_DEFAULT_PAGE_SIZE = 25;
export const ADMIN_ORDER_MAXIMUM_PAGE_SIZE = 100;
export const ADMIN_ORDER_SEARCH_MAXIMUM_LENGTH = 100;

export interface OrderListFilters {
  q: string;
  status: string;
  integrationStatus: string;
  from: string;
  to: string;
  page: number;
}

export const EMPTY_ORDER_LIST_FILTERS: OrderListFilters = {
  q: "",
  status: "",
  integrationStatus: "",
  from: "",
  to: "",
  page: 1,
};

/** Search parameters without empty values; page 1 is implied. */
export function orderListSearchParams(filters: OrderListFilters): URLSearchParams {
  const parameters = new URLSearchParams();
  const q = filters.q.trim();
  if (q) parameters.set("q", q);
  if (filters.status) parameters.set("status", filters.status);
  if (filters.integrationStatus) parameters.set("integrationStatus", filters.integrationStatus);
  if (filters.from) parameters.set("from", filters.from);
  if (filters.to) parameters.set("to", filters.to);
  if (filters.page > 1) parameters.set("page", String(filters.page));
  return parameters;
}

/** "?q=…" or "" when no filter is set. */
export function orderListQuerySuffix(filters: OrderListFilters): string {
  const query = orderListSearchParams(filters).toString();
  return query ? `?${query}` : "";
}

/** Search parameters of a server page (`searchParams` prop); repeated keys keep the first value. */
export function toUrlSearchParams(
  record: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") parameters.set(key, first);
  }
  return parameters;
}

export function hasActiveOrderFilters(filters: OrderListFilters): boolean {
  return Boolean(
    filters.q.trim() || filters.status || filters.integrationStatus || filters.from || filters.to,
  );
}

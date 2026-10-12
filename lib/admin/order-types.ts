/**
 * JSON shapes of the admin order API (`/api/admin/orders/**`), shared by the
 * route handlers, the server pages and the admin components. Money in the
 * list is in rubles (kept for the earlier orders list); money in the details
 * is in kopecks (integers, no rounding errors).
 */
import type { ReservationState } from "./order-statuses";

export interface AdminOrderListItem {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  integrationStatus: string;
  /** Rubles. */
  total: number;
  deliveryMethod: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  items: Array<{ name: string; sku: string; quantity: number; total: number }>;
}

export interface AdminOrderPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminOrderListResponse {
  ok: true;
  items: AdminOrderListItem[];
  pagination: AdminOrderPagination;
}

export interface AdminOrderPerson {
  id: string;
  name: string;
}

export interface AdminOrderItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceKopecks: number;
  discountKopecks: number;
  totalKopecks: number;
  /** Catalog product of the line; null when it no longer exists. */
  product: {
    id: string;
    kind: "tire" | "wheel" | string;
    isActive: boolean;
    /** Storefront page, only for an active product with a slug. */
    storefrontPath: string | null;
  } | null;
}

export interface AdminOrderStatusHistoryEntry {
  id: string;
  status: string;
  /** Staff member who changed the status; null for checkout, 1C and system changes. */
  actor: AdminOrderPerson | null;
  comment: string | null;
  createdAt: string;
}

export interface AdminOrderComment {
  id: string;
  body: string;
  /** null when the author account was deleted. */
  author: AdminOrderPerson | null;
  createdAt: string;
}

export interface AdminOrderIntegration {
  status: string;
  retryCount: number;
  /** Safe summary only (personal data masked, length limited). */
  lastError: string | null;
  lastAttemptAt: string | null;
  syncedAt: string | null;
  externalId: string | null;
  nextAttemptAt: string | null;
}

export interface AdminOrderReservation {
  state: ReservationState;
  /** Earliest expiry of the active holds. */
  expiresAt: string | null;
  /** True when a hold expired: only "new" and "cancelled" can be set. */
  expired: boolean;
}

export interface AdminOrderDetails {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  updatedAt: string;
  customer: {
    name: string;
    phone: string;
    email: string | null;
    /** The order was placed while signed in. */
    hasAccount: boolean;
  };
  delivery: {
    method: string;
    address: string | null;
    requiresTireService: boolean;
  };
  /** Comment written by the customer at checkout. */
  customerComment: string | null;
  totals: {
    subtotalKopecks: number;
    discountKopecks: number;
    deliveryKopecks: number;
    totalKopecks: number;
  };
  items: AdminOrderItem[];
  reservation: AdminOrderReservation;
  statusHistory: AdminOrderStatusHistoryEntry[];
  integration: AdminOrderIntegration;
  comments: AdminOrderComment[];
}

export interface AdminOrderDetailsResponse {
  ok: true;
  order: AdminOrderDetails;
  permissions: { canChangePaymentStatus: boolean };
}

export interface AdminOrderStatusUpdateResponse {
  ok: true;
  status: string;
  previousStatus: string;
  notificationQueued: boolean;
  /** Same status without a comment: nothing was changed or logged. */
  unchanged?: boolean;
}

export interface AdminOrderCommentResponse {
  ok: true;
  comment: AdminOrderComment;
}

export interface AdminApiErrorBody {
  ok?: false;
  code?: string;
  message?: string;
}

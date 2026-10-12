import { z } from "zod";
import { isCalendarDate } from "../../lib/admin/order-dates";
import {
  ADMIN_ORDER_DEFAULT_PAGE_SIZE,
  ADMIN_ORDER_MAXIMUM_PAGE_SIZE,
  ADMIN_ORDER_SEARCH_MAXIMUM_LENGTH,
  EMPTY_ORDER_LIST_FILTERS,
  type OrderListFilters,
} from "../../lib/admin/order-list-query";
import {
  INTEGRATION_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
} from "../../lib/admin/order-statuses";
import type { UserRole } from "../repositories/auth-repository";

export { INTEGRATION_STATUSES, ORDER_STATUSES, PAYMENT_STATUSES };

/** Staff comments and status-change comments: 1..2000 characters after trimming. */
export const ORDER_COMMENT_MAXIMUM_LENGTH = 2_000;
const MAXIMUM_PAGE = 10_000;

const commentLengthMessage = `Комментарий — не длиннее ${ORDER_COMMENT_MAXIMUM_LENGTH} символов.`;
const commentCharactersMessage = "Комментарий содержит недопустимые символы.";
// NUL cannot be stored in PostgreSQL text (500 instead of 422 without this check).
const hasForbiddenCharacters = (value: string) => value.includes("\u0000");

export const orderIdSchema = z.uuid({ error: "Некорректный идентификатор заказа." });

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES, { error: "Выберите допустимый статус заказа." }),
  /** Only the admin role may set it (canChangePaymentStatus). */
  paymentStatus: z
    .enum(PAYMENT_STATUSES, { error: "Выберите допустимый статус оплаты." })
    .optional(),
  /** Optional reason, saved in order_status_history with the actor. */
  comment: z
    .string({ error: "Комментарий должен быть текстом." })
    .trim()
    .max(ORDER_COMMENT_MAXIMUM_LENGTH, commentLengthMessage)
    .refine((value) => !hasForbiddenCharacters(value), commentCharactersMessage)
    .transform((value) => value || undefined)
    .optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const updatePaymentStatusSchema = z.object({
  paymentStatus: z.enum(PAYMENT_STATUSES, { error: "Выберите допустимый статус оплаты." }),
});

export type UpdatePaymentStatusInput = z.infer<typeof updatePaymentStatusSchema>;

export const createOrderCommentSchema = z.object({
  body: z
    .string({ error: "Введите текст комментария." })
    .trim()
    .min(1, "Введите текст комментария.")
    .max(ORDER_COMMENT_MAXIMUM_LENGTH, commentLengthMessage)
    .refine((value) => !hasForbiddenCharacters(value), commentCharactersMessage),
});

export type CreateOrderCommentInput = z.infer<typeof createOrderCommentSchema>;

/** Payment status is changed only by the admin role; managers see it read-only. */
export function canChangePaymentStatus(role: UserRole): boolean {
  return role === "admin";
}

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, "Дата — в формате ГГГГ-ММ-ДД, с 2000 по 2100 год.");

const pageNumberSchema = (maximum: number, fallback: number, message: string) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.number({ error: message }).int(message).min(1, message).max(maximum, message).default(fallback),
  );

export const adminOrderListQuerySchema = z
  .object({
    q: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .max(
          ADMIN_ORDER_SEARCH_MAXIMUM_LENGTH,
          `Поисковый запрос — не длиннее ${ADMIN_ORDER_SEARCH_MAXIMUM_LENGTH} символов.`,
        )
        .refine((value) => !hasForbiddenCharacters(value), "Поисковый запрос содержит недопустимые символы.")
        .optional(),
    ),
    status: z.preprocess(
      emptyToUndefined,
      z.enum(ORDER_STATUSES, { error: "Неизвестный статус заказа." }).optional(),
    ),
    integrationStatus: z.preprocess(
      emptyToUndefined,
      z.enum(INTEGRATION_STATUSES, { error: "Неизвестный статус передачи в 1С." }).optional(),
    ),
    from: z.preprocess(emptyToUndefined, calendarDateSchema.optional()),
    to: z.preprocess(emptyToUndefined, calendarDateSchema.optional()),
    page: pageNumberSchema(MAXIMUM_PAGE, 1, `Номер страницы — от 1 до ${MAXIMUM_PAGE}.`),
    pageSize: pageNumberSchema(
      ADMIN_ORDER_MAXIMUM_PAGE_SIZE,
      ADMIN_ORDER_DEFAULT_PAGE_SIZE,
      `Размер страницы — от 1 до ${ADMIN_ORDER_MAXIMUM_PAGE_SIZE}.`,
    ),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ["to"],
    message: "Дата «по» не может быть раньше даты «с».",
  });

export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;

const LIST_QUERY_KEYS = ["q", "status", "integrationStatus", "from", "to", "page", "pageSize"] as const;

/** Validates list filters from a URL; only the first value of a repeated key is used. */
export function parseAdminOrderListQuery(searchParams: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of LIST_QUERY_KEYS) {
    const value = searchParams.get(key);
    if (value !== null) raw[key] = value;
  }
  return adminOrderListQuerySchema.safeParse(raw);
}

/** List filters for the admin pages; invalid parameters give the unfiltered first page. */
export function orderListFiltersFromSearchParams(searchParams: URLSearchParams): OrderListFilters {
  const parsed = parseAdminOrderListQuery(searchParams);
  if (!parsed.success) return { ...EMPTY_ORDER_LIST_FILTERS };
  const { q, status, integrationStatus, from, to, page } = parsed.data;
  return {
    q: q ?? "",
    status: status ?? "",
    integrationStatus: integrationStatus ?? "",
    from: from ?? "",
    to: to ?? "",
    page,
  };
}

/** First validation message, for the `message` field of a 422 response. */
export function firstValidationMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message || fallback;
}

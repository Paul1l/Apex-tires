import assert from "node:assert/strict";
import test from "node:test";
import {
  adminOrderListQuerySchema,
  canChangePaymentStatus,
  createOrderCommentSchema,
  orderIdSchema,
  orderListFiltersFromSearchParams,
  parseAdminOrderListQuery,
  updateOrderStatusSchema,
  updatePaymentStatusSchema,
} from "../validators/admin-order-schema.js";

function firstMessage(result: { success: boolean; error?: { issues: Array<{ message: string }> } }) {
  return result.success ? null : result.error?.issues[0]?.message;
}

test("status change: known statuses only, optional comment trimmed and limited to 2000", () => {
  assert.deepEqual(updateOrderStatusSchema.parse({ status: "confirmed" }), { status: "confirmed" });
  assert.equal(updateOrderStatusSchema.safeParse({ status: "lost" }).success, false);
  assert.equal(updateOrderStatusSchema.safeParse({}).success, false);
  assert.equal(
    firstMessage(updateOrderStatusSchema.safeParse({ status: "lost" })),
    "Выберите допустимый статус заказа.",
  );

  const withComment = updateOrderStatusSchema.parse({ status: "cancelled", comment: "  Клиент отказался \n" });
  assert.equal(withComment.comment, "Клиент отказался");
  assert.equal(updateOrderStatusSchema.parse({ status: "new", comment: "   " }).comment, undefined);
  assert.equal(updateOrderStatusSchema.parse({ status: "new", comment: "" }).comment, undefined);
  assert.equal(updateOrderStatusSchema.parse({ status: "new", comment: "я".repeat(2000) }).comment?.length, 2000);
  const tooLong = updateOrderStatusSchema.safeParse({ status: "new", comment: "я".repeat(2001) });
  assert.equal(firstMessage(tooLong), "Комментарий — не длиннее 2000 символов.");
  assert.equal(updateOrderStatusSchema.safeParse({ status: "new", comment: "a\u0000b" }).success, false);
  assert.equal(updateOrderStatusSchema.safeParse({ status: "new", comment: 42 }).success, false);
});

test("status change: payment status values are the ones the code base already uses", () => {
  for (const paymentStatus of ["pending", "paid", "failed", "refunded"]) {
    assert.equal(updateOrderStatusSchema.safeParse({ status: "new", paymentStatus }).success, true, paymentStatus);
    assert.equal(updatePaymentStatusSchema.safeParse({ paymentStatus }).success, true, paymentStatus);
  }
  for (const paymentStatus of ["PAID", "partially_paid", "", null, 1]) {
    assert.equal(updatePaymentStatusSchema.safeParse({ paymentStatus }).success, false, String(paymentStatus));
  }
});

test("payment status role rule: only admin", () => {
  assert.equal(canChangePaymentStatus("admin"), true);
  assert.equal(canChangePaymentStatus("manager"), false);
  assert.equal(canChangePaymentStatus("customer"), false);
});

test("staff comment: 1..2000 characters after trimming, no NUL", () => {
  assert.equal(createOrderCommentSchema.parse({ body: "  Перезвонить после 18:00  " }).body, "Перезвонить после 18:00");
  assert.equal(createOrderCommentSchema.parse({ body: "x" }).body, "x");
  assert.equal(createOrderCommentSchema.parse({ body: "ж".repeat(2000) }).body.length, 2000);
  assert.equal(firstMessage(createOrderCommentSchema.safeParse({ body: "   " })), "Введите текст комментария.");
  assert.equal(firstMessage(createOrderCommentSchema.safeParse({ body: "" })), "Введите текст комментария.");
  assert.equal(firstMessage(createOrderCommentSchema.safeParse({})), "Введите текст комментария.");
  assert.equal(
    firstMessage(createOrderCommentSchema.safeParse({ body: "ж".repeat(2001) })),
    "Комментарий — не длиннее 2000 символов.",
  );
  assert.equal(createOrderCommentSchema.safeParse({ body: "a\u0000" }).success, false);
});

test("order id must be a UUID", () => {
  assert.equal(orderIdSchema.safeParse("d5d4657d-9992-4b87-8b58-36af33ef5144").success, true);
  for (const value of ["", "1", "../status", "d5d4657d-9992-4b87-8b58-36af33ef514", "' OR 1=1 --"]) {
    assert.equal(orderIdSchema.safeParse(value).success, false, value);
  }
});

test("list filters: defaults, bounded page size, empty values ignored", () => {
  assert.deepEqual(adminOrderListQuerySchema.parse({}), { page: 1, pageSize: 25 });
  const parsed = parseAdminOrderListQuery(
    new URLSearchParams("q=+AW-2026+&status=&integrationStatus=failed&from=2026-10-01&to=2026-10-11&page=3&pageSize=100&unknown=1"),
  );
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data, {
    q: "AW-2026",
    status: undefined,
    integrationStatus: "failed",
    from: "2026-10-01",
    to: "2026-10-11",
    page: 3,
    pageSize: 100,
  });
  for (const query of ["pageSize=101", "pageSize=0", "page=0", "page=abc", "page=1.5", "page=10001", "pageSize=-5"]) {
    assert.equal(parseAdminOrderListQuery(new URLSearchParams(query)).success, false, query);
  }
});

test("list filters: unknown statuses, invalid dates and reversed ranges are rejected", () => {
  for (const query of [
    "status=lost",
    "status=NEW",
    "integrationStatus=done",
    "from=2026-02-30",
    "from=11.10.2026",
    "to=2026-13-01",
    "from=1999-12-31",
    "from=2026-10-11T00:00:00Z",
    `q=${"a".repeat(101)}`,
    "q=%00",
  ]) {
    assert.equal(parseAdminOrderListQuery(new URLSearchParams(query)).success, false, query);
  }
  const reversed = parseAdminOrderListQuery(new URLSearchParams("from=2026-10-12&to=2026-10-11"));
  assert.equal(firstMessage(reversed), "Дата «по» не может быть раньше даты «с».");
  assert.equal(parseAdminOrderListQuery(new URLSearchParams("from=2026-10-11&to=2026-10-11")).success, true);
  assert.equal(parseAdminOrderListQuery(new URLSearchParams("from=2028-02-29")).success, true);
});

test("list filters: repeated keys use the first value; page filters fall back to the first page", () => {
  const parsed = parseAdminOrderListQuery(new URLSearchParams("status=new&status=bogus"));
  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.status, "new");

  assert.deepEqual(orderListFiltersFromSearchParams(new URLSearchParams("status=bogus&page=4")), {
    q: "",
    status: "",
    integrationStatus: "",
    from: "",
    to: "",
    page: 1,
  });
  assert.deepEqual(orderListFiltersFromSearchParams(new URLSearchParams("q=Иванов&status=new&page=2")), {
    q: "Иванов",
    status: "new",
    integrationStatus: "",
    from: "",
    to: "",
    page: 2,
  });
});

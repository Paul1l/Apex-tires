import assert from "node:assert/strict";
import test from "node:test";
import {
  isCalendarDate,
  nextCalendarDate,
  storeDateRange,
  zonedDayStart,
} from "../../lib/admin/order-dates.js";
import {
  orderListQuerySuffix,
  orderListSearchParams,
} from "../../lib/admin/order-list-query.js";
import {
  buildAdminOrderListCondition,
  escapeLikePattern,
  phoneSearchDigits,
} from "../repositories/admin-order-repository.js";

test("LIKE wildcards and the escape character are escaped", () => {
  assert.equal(escapeLikePattern("50%_off!"), "50!%!_off!!");
  assert.equal(escapeLikePattern("plain text"), "plain text");
  assert.equal(escapeLikePattern("%%"), "!%!%");
});

test("search text never reaches the SQL text, only bind parameters", () => {
  const hostile = "x' OR 1=1; DROP TABLE orders; -- %_";
  const condition = buildAdminOrderListCondition({ q: hostile });
  assert.ok(!condition.clause.includes("DROP"), condition.clause);
  assert.ok(!condition.clause.includes("1=1"), condition.clause);
  assert.ok(!condition.clause.includes("'x"), condition.clause);
  assert.deepEqual(condition.values, ["%x' OR 1=1; DROP TABLE orders; -- !%!_%"]);
  assert.equal(
    condition.clause,
    "WHERE (orders.number ILIKE $1 ESCAPE '!' OR orders.customer_name ILIKE $1 ESCAPE '!' OR orders.customer_email ILIKE $1 ESCAPE '!')",
  );
});

test("a lone wildcard searches for the character, not for everything", () => {
  assert.deepEqual(buildAdminOrderListCondition({ q: "%" }).values, ["%!%%"]);
  assert.deepEqual(buildAdminOrderListCondition({ q: "_" }).values, ["%!_%"]);
});

test("phone-like queries also search customer_phone digits", () => {
  assert.equal(phoneSearchDigits("8 (913) 123-45-67"), "79131234567");
  assert.equal(phoneSearchDigits("+7 913 123 45 67"), "79131234567");
  assert.equal(phoneSearchDigits("4567"), "4567");
  assert.equal(phoneSearchDigits("12"), null);
  assert.equal(phoneSearchDigits("AW-2026-000123"), null);
  assert.equal(phoneSearchDigits("ivan@example.ru"), null);

  const condition = buildAdminOrderListCondition({ q: "8 913 123-45-67" });
  assert.deepEqual(condition.values, ["%8 913 123-45-67%", "%79131234567%"]);
  assert.ok(condition.clause.includes("orders.customer_phone LIKE $2"));
});

test("filters are combined with AND and numbered in order", () => {
  const condition = buildAdminOrderListCondition({
    status: "new",
    integrationStatus: "failed",
    from: "2026-10-01",
    to: "2026-10-11",
    q: "Иванов",
  });
  assert.equal(
    condition.clause,
    "WHERE orders.status = $1 AND orders.integration_status = $2" +
      " AND orders.created_at >= $3::timestamptz AND orders.created_at < $4::timestamptz" +
      " AND (orders.number ILIKE $5 ESCAPE '!' OR orders.customer_name ILIKE $5 ESCAPE '!' OR orders.customer_email ILIKE $5 ESCAPE '!')",
  );
  assert.deepEqual(condition.values, [
    "new",
    "failed",
    "2026-09-30T17:00:00.000Z",
    "2026-10-11T17:00:00.000Z",
    "%Иванов%",
  ]);
  assert.deepEqual(buildAdminOrderListCondition({}), { clause: "", values: [] });
  assert.deepEqual(buildAdminOrderListCondition({ q: "   " }), { clause: "", values: [] });
});

test("day boundaries are Barnaul days (UTC+7 now, UTC+6 in 2014-2016)", () => {
  assert.equal(zonedDayStart("2026-10-11").toISOString(), "2026-10-10T17:00:00.000Z");
  assert.equal(zonedDayStart("2015-06-01").toISOString(), "2015-05-31T18:00:00.000Z");
  // Barnaul switched from UTC+6 to UTC+7 on 2016-03-27 at 02:00 local time.
  assert.equal(zonedDayStart("2016-03-27").toISOString(), "2016-03-26T18:00:00.000Z");
  assert.equal(zonedDayStart("2016-03-28").toISOString(), "2016-03-27T17:00:00.000Z");
  assert.equal(zonedDayStart("2026-10-11", "UTC").toISOString(), "2026-10-11T00:00:00.000Z");

  const range = storeDateRange("2026-10-11", "2026-10-11");
  assert.equal(range.start?.toISOString(), "2026-10-10T17:00:00.000Z");
  assert.equal(range.end?.toISOString(), "2026-10-11T17:00:00.000Z", "the 'to' day is included completely");
  // 23:59:59 on 10 Oct in Barnaul is outside, 00:00 on 11 Oct inside.
  const lateEvening = new Date("2026-10-10T16:59:59.999Z");
  const midnight = new Date("2026-10-10T17:00:00.000Z");
  assert.ok(lateEvening < range.start!);
  assert.ok(midnight >= range.start!);
  assert.deepEqual(storeDateRange(), { start: undefined, end: undefined });
});

test("calendar dates are validated and the next day crosses months and years", () => {
  assert.equal(isCalendarDate("2026-02-28"), true);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(isCalendarDate("2026-1-01"), false);
  assert.equal(isCalendarDate("2101-01-01"), false);
  assert.equal(nextCalendarDate("2026-12-31"), "2027-01-01");
  assert.equal(nextCalendarDate("2028-02-28"), "2028-02-29");
  assert.equal(nextCalendarDate("2026-01-31"), "2026-02-01");
  assert.throws(() => zonedDayStart("2026-02-30"), RangeError);
});

test("list URLs keep only the set filters", () => {
  const filters = { q: " 79131234567 ", status: "new", integrationStatus: "", from: "2026-10-01", to: "", page: 1 };
  assert.equal(orderListSearchParams(filters).toString(), "q=79131234567&status=new&from=2026-10-01");
  assert.equal(orderListQuerySuffix({ ...filters, page: 3 }), "?q=79131234567&status=new&from=2026-10-01&page=3");
  assert.equal(
    orderListQuerySuffix({ q: "", status: "", integrationStatus: "", from: "", to: "", page: 1 }),
    "",
  );
  assert.equal(
    orderListSearchParams({ ...filters, q: "a&b=c#d" }).get("q"),
    "a&b=c#d",
    "special characters are encoded, not interpreted",
  );
});

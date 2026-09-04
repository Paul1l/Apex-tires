import assert from "node:assert/strict";
import test from "node:test";
import {
  getAvailabilityPresentation,
  hasValidDiscount,
} from "../../lib/product-presentation.js";

test("preview stock never exposes example quantities as real availability", () => {
  const result = getAvailabilityPresentation(
    { stock: 25, reserved: 3 },
    "exact",
    true,
  );

  assert.equal(result.label, "Наличие уточняется");
});

test("exact production stock is calculated after reservations", () => {
  const result = getAvailabilityPresentation(
    { stock: 8, reserved: 2 },
    "exact",
    false,
  );

  assert.equal(result.label, "6 шт.");
});

test("discount is shown only when old price is greater than current price", () => {
  assert.equal(hasValidDiscount({ price: 10_000, oldPrice: 12_000 }), true);
  assert.equal(hasValidDiscount({ price: 10_000, oldPrice: 9_000 }), false);
  assert.equal(hasValidDiscount({ price: 10_000 }), false);
});

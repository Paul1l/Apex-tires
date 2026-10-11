import { createHash } from "node:crypto";
import type { CreateOrderInput } from "../validators/order-schemas";

/**
 * Fingerprint of what a checkout request asks for, stored with its
 * idempotency key. Requests that create the same order give the same value:
 * line order and duplicate lines of one product (merged at checkout), the case
 * of the email and of product ids do not matter. Anything that would change
 * the order — items and quantities, name, phone, email, delivery method and
 * address, tire service, comment — gives a different value.
 */
export function hashCheckoutRequest(input: CreateOrderInput): string {
  const quantityByProductId = new Map<string, number>();
  for (const item of input.items) {
    const productId = item.productId.toLowerCase();
    quantityByProductId.set(productId, (quantityByProductId.get(productId) ?? 0) + item.quantity);
  }
  const canonical = {
    items: [...quantityByProductId].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    customer: {
      name: input.customer.name.trim(),
      phone: input.customer.phone.trim(),
      email: input.customer.email?.trim().toLowerCase() || null,
    },
    delivery: {
      method: input.delivery.method,
      address: input.delivery.address?.trim() || null,
    },
    requiresTireService: input.requiresTireService,
    comment: input.comment?.trim() || null,
  };
  return createHash("sha256")
    .update(`checkout-request:v1:${JSON.stringify(canonical)}`)
    .digest("hex");
}

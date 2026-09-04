import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { DatabaseExecutor } from "../types/common.js";
import type {
  CreatedOrderRow,
  PersistedOrderInput,
} from "../repositories/order-repository.js";
import {
  OrderService,
  type OrderServiceDependencies,
} from "../services/order-service.js";

function createTransactionPool() {
  const database = {
    async query() {
      return { rows: [] };
    },
    release() {},
  };
  return {
    database,
    async connect() {
      return database;
    },
  };
}

test("order total is calculated from locked backend prices", async () => {
  const pool = createTransactionPool();
  const reservations: Array<{ productId: string; quantity: number }> = [];
  let createdOrderInput: PersistedOrderInput | undefined;
  const orderRepository: OrderServiceDependencies["orderRepository"] = {
    async findByCheckoutIdempotencyKey() {
      return null;
    },
    async lockProductsForCheckout() {
      return [
        {
          id: "d5d4657d-9992-4b87-8b58-36af33ef5144",
          sku: "TYRE-001",
          name: "Test tyre",
          is_active: true,
          amount_kopecks: 12_345,
          available: 8,
        },
      ];
    },
    async reserveStock(
      _database: DatabaseExecutor,
      productId: string,
      quantity: number,
    ) {
      reservations.push({ productId, quantity });
    },
    async getDeliveryPriceKopecks() {
      return 0;
    },
    async create(
      _database: DatabaseExecutor,
      order: PersistedOrderInput,
    ): Promise<CreatedOrderRow> {
      createdOrderInput = order;
      return {
        id: "6f91f927-605e-4595-9f1e-6c674f223b36",
        number: "AW-001001",
        status: "new",
        integration_status: "pending",
        total_kopecks: order.totalKopecks,
        created_at: "2026-09-04T10:00:00.000Z",
      };
    },
  };
  const service = new OrderService({
    pool: pool as unknown as Pool,
    orderRepository,
    enabledDeliveryMethods: ["pickup"],
  });

  const order = await service.createOrder({
    idempotencyKey: "checkout-key-at-least-16-characters",
    customer: { name: "Иван", phone: "+79123456789" },
    items: [
      {
        productId: "d5d4657d-9992-4b87-8b58-36af33ef5144",
        quantity: 4,
      },
    ],
    delivery: { method: "pickup" },
    requiresTireService: false,
  });

  assert.equal(createdOrderInput?.totalKopecks, 49_380);
  assert.deepEqual(reservations, [
    {
      productId: "d5d4657d-9992-4b87-8b58-36af33ef5144",
      quantity: 4,
    },
  ]);
  assert.equal(order.total_kopecks, 49_380);
});

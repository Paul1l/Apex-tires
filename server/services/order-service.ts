import type { Pool } from "pg";
import { businessConfig, getEnabledDeliveryMethods } from "../../config/business";
import type { DeliveryMethod } from "../../lib/types";
import { withTransaction } from "../database/postgres-client";
import {
  OrderRepository,
  type CreatedOrderRow,
  type NormalizedOrderItem,
} from "../repositories/order-repository";
import { ApplicationError } from "../utils/errors";
import type { CreateOrderInput } from "../validators/order-schemas";

type CheckoutOrderRepository = Pick<
  OrderRepository,
  | "findByCheckoutIdempotencyKey"
  | "lockProductsForCheckout"
  | "getDeliveryPriceKopecks"
  | "reserveStock"
  | "create"
>;

export interface OrderServiceDependencies {
  pool: Pool;
  orderRepository: CheckoutOrderRepository;
  enabledDeliveryMethods?: readonly DeliveryMethod[];
  tireServiceEnabled?: boolean;
  managerNotificationEmail?: string;
}

export class OrderService {
  private readonly pool: Pool;
  private readonly orderRepository: CheckoutOrderRepository;
  private readonly enabledDeliveryMethods: readonly DeliveryMethod[];
  private readonly tireServiceEnabled: boolean;
  private readonly managerNotificationEmail?: string;

  constructor({
    pool,
    orderRepository,
    enabledDeliveryMethods = getEnabledDeliveryMethods(businessConfig),
    tireServiceEnabled = businessConfig.services.tireService,
    managerNotificationEmail =
      businessConfig.contacts.supportEmail ??
      businessConfig.contacts.email ??
      undefined,
  }: OrderServiceDependencies) {
    this.pool = pool;
    this.orderRepository = orderRepository;
    this.enabledDeliveryMethods = enabledDeliveryMethods;
    this.tireServiceEnabled = tireServiceEnabled;
    this.managerNotificationEmail = managerNotificationEmail;
  }

  async createOrder(
    input: CreateOrderInput,
  ): Promise<CreatedOrderRow & { duplicate?: true }> {
    if (!this.enabledDeliveryMethods.includes(input.delivery.method)) {
      throw new ApplicationError({
        code: "DELIVERY_METHOD_UNAVAILABLE",
        message: "Выбранный способ получения сейчас недоступен.",
        statusCode: 422,
      });
    }
    if (input.requiresTireService && !this.tireServiceEnabled) {
      throw new ApplicationError({
        code: "TIRE_SERVICE_UNAVAILABLE",
        message: "Шиномонтаж пока нельзя добавить к заказу.",
        statusCode: 422,
      });
    }
    const existingOrder = await this.orderRepository.findByCheckoutIdempotencyKey(
      this.pool,
      input.idempotencyKey,
    );
    if (existingOrder) return { ...existingOrder, duplicate: true };

    return withTransaction(this.pool, async (database) => {
      await database.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        input.idempotencyKey,
      ]);
      const orderCreatedByConcurrentRequest =
        await this.orderRepository.findByCheckoutIdempotencyKey(
          database,
          input.idempotencyKey,
        );
      if (orderCreatedByConcurrentRequest) {
        return { ...orderCreatedByConcurrentRequest, duplicate: true };
      }

      const quantityByProductId = new Map<string, number>();
      for (const item of input.items) {
        quantityByProductId.set(
          item.productId,
          (quantityByProductId.get(item.productId) ?? 0) + item.quantity,
        );
      }
      const requestedItems = Array.from(quantityByProductId, ([productId, quantity]) => ({
        productId,
        quantity,
      }));
      const productIds = requestedItems.map((item) => item.productId);
      const products = await this.orderRepository.lockProductsForCheckout(
        database,
        productIds,
      );
      const productsById = new Map(products.map((product) => [product.id, product]));

      const normalizedItems: NormalizedOrderItem[] = requestedItems.map((item) => {
        const product = productsById.get(item.productId);
        if (!product || !product.is_active) {
          throw new ApplicationError({
            code: "PRODUCT_UNAVAILABLE",
            message: "Один из выбранных товаров больше не доступен.",
            statusCode: 409,
          });
        }
        if (product.amount_kopecks === null) {
          throw new ApplicationError({
            code: "PRICE_UNAVAILABLE",
            message: `Для товара ${product.sku} не задана актуальная цена.`,
            statusCode: 409,
          });
        }
        if (Number(product.available) < item.quantity) {
          throw new ApplicationError({
            code: "INSUFFICIENT_STOCK",
            message: `Недостаточный остаток товара ${product.sku}.`,
            statusCode: 409,
          });
        }

        const unitPriceKopecks = Number(product.amount_kopecks);
        return {
          ...item,
          sku: product.sku,
          name: product.name,
          unitPriceKopecks,
          totalKopecks: unitPriceKopecks * item.quantity,
        };
      });
      const subtotalKopecks = normalizedItems.reduce(
        (sum, item) => sum + item.totalKopecks,
        0,
      );
      const deliveryKopecks =
        await this.orderRepository.getDeliveryPriceKopecks(
          database,
          input.delivery.method,
        );

      for (const item of normalizedItems) {
        await this.orderRepository.reserveStock(
          database,
          item.productId,
          item.quantity,
        );
      }

      return this.orderRepository.create(database, {
        ...input,
        items: normalizedItems,
        subtotalKopecks,
        deliveryKopecks,
        totalKopecks: subtotalKopecks + deliveryKopecks,
        managerNotificationEmail: this.managerNotificationEmail,
      });
    });
  }
}

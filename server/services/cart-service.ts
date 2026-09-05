import type { Pool } from "pg";
import { withTransaction } from "../database/postgres-client";
import { CartRepository, type PersistedCartLine } from "../repositories/cart-repository";
import { ApplicationError } from "../utils/errors";

export class CartService {
  constructor(
    private readonly pool: Pool,
    private readonly repository: CartRepository,
  ) {}

  getCart(userId: string): Promise<PersistedCartLine[]> {
    return this.repository.listForUser(this.pool, userId);
  }

  getAnonymousCart(anonymousSessionHash: string): Promise<PersistedCartLine[]> {
    return this.repository.listForAnonymous(this.pool, anonymousSessionHash);
  }

  async mergeAnonymousCart(userId: string, anonymousSessionHash: string): Promise<void> {
    await withTransaction(this.pool, (database) =>
      this.repository.mergeAnonymousIntoUser(database, anonymousSessionHash, userId),
    );
  }

  async replaceCart(
    userId: string,
    items: PersistedCartLine[],
  ): Promise<PersistedCartLine[]> {
    const normalizedItems = this.normalizeItems(items);
    await withTransaction(this.pool, async (database) => {
      const activeProductIds = await this.repository.findActiveProductIds(
        database,
        normalizedItems.map((item) => item.productId),
      );
      if (activeProductIds.size !== normalizedItems.length) {
        throw new ApplicationError({
          code: "CART_PRODUCT_UNAVAILABLE",
          message: "Один из товаров корзины больше не доступен.",
          statusCode: 409,
        });
      }
      await this.repository.replaceForUser(database, userId, normalizedItems);
    });
    return normalizedItems;
  }

  async replaceAnonymousCart(
    anonymousSessionHash: string,
    items: PersistedCartLine[],
  ): Promise<PersistedCartLine[]> {
    const normalizedItems = this.normalizeItems(items);
    await withTransaction(this.pool, async (database) => {
      const activeProductIds = await this.repository.findActiveProductIds(database, normalizedItems.map((item) => item.productId));
      if (activeProductIds.size !== normalizedItems.length) {
        throw new ApplicationError({ code: "CART_PRODUCT_UNAVAILABLE", message: "Один из товаров корзины больше не доступен.", statusCode: 409 });
      }
      await this.repository.replaceForAnonymous(database, anonymousSessionHash, normalizedItems);
    });
    return normalizedItems;
  }

  private normalizeItems(items: PersistedCartLine[]): PersistedCartLine[] {
    const quantityByProductId = new Map<string, number>();
    for (const item of items) {
      quantityByProductId.set(item.productId, Math.min(100, (quantityByProductId.get(item.productId) ?? 0) + item.quantity));
    }
    return Array.from(quantityByProductId, ([productId, quantity]) => ({ productId, quantity }));
  }
}

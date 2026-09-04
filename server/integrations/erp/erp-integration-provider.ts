import type { JsonValue } from "../../types/common";

export interface IncrementalSyncRequest {
  changedSince?: string;
}

export interface SendOrderOptions {
  idempotencyKey: string;
}

export interface SentOrderResponse {
  externalOrderId?: string;
}

export abstract class ERPIntegrationProvider {
  abstract getProducts(request?: IncrementalSyncRequest): Promise<unknown>;
  abstract getPrices(request?: IncrementalSyncRequest): Promise<unknown>;
  abstract getStocks(request?: IncrementalSyncRequest): Promise<unknown>;
  abstract sendOrder(
    order: JsonValue,
    options: SendOrderOptions,
  ): Promise<SentOrderResponse>;
  abstract getOrderStatus(externalOrderId: string): Promise<unknown>;
  abstract healthCheck(): Promise<unknown>;
}

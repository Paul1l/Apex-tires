export interface PaymentRequest {
  orderId: string;
  orderNumber: string;
  amountKopecks: number;
  idempotencyKey: string;
  returnUrl: string;
}

export interface PaymentResult {
  externalPaymentId: string;
  confirmationUrl: string;
  status: "pending" | "paid" | "cancelled" | "failed";
}

export interface PaymentProvider {
  createPayment(request: PaymentRequest): Promise<PaymentResult>;
  getPaymentStatus(externalPaymentId: string): Promise<PaymentResult["status"]>;
}

// No provider is selected until the client confirms acquiring and fiscalization.

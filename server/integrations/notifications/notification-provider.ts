export interface OrderNotification {
  orderId: string;
  orderNumber: string;
  recipient: string;
}

export interface NotificationProvider {
  readonly channel: "email" | "telegram";
  sendOrderCreated(notification: OrderNotification): Promise<void>;
}

/**
 * Concrete email or Telegram implementations are added only after the owner
 * approves the channel, recipient and personal-data processing arrangement.
 */

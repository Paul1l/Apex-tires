import { businessConfig } from "../../../config/business";
import {
  sendYandexPostboxEmail,
  type AuthenticationEmailEnvironment,
} from "../../../lib/auth/delivery";
import type {
  NotificationMessage,
  NotificationProvider,
} from "./notification-provider";

function payloadValue(payload: unknown, key: string): string {
  if (typeof payload !== "object" || payload === null) return "";
  const value = Reflect.get(payload, key);
  return typeof value === "string" ? value : "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderNotification(notification: NotificationMessage): {
  subject: string;
  text: string;
  html: string;
} {
  const orderNumber = payloadValue(notification.payload, "orderNumber");
  const requestId = payloadValue(notification.payload, "requestId");
  switch (notification.template) {
    case "customer-order-created":
      return {
        subject: "Заказ " + orderNumber + " принят",
        text:
          "Заказ " +
          orderNumber +
          " сохранён. Менеджер проверит наличие и свяжется с вами.",
        html:
          "<p>Заказ <strong>" +
          escapeHtml(orderNumber) +
          "</strong> сохранён.</p><p>Менеджер проверит наличие и свяжется с вами.</p>",
      };
    case "manager-order-created":
      return {
        subject: "Новый заказ " + orderNumber,
        text:
          "Создан заказ " +
          orderNumber +
          ". Откройте защищённую панель управления для обработки.",
        html:
          "<p>Создан заказ <strong>" +
          escapeHtml(orderNumber) +
          "</strong>.</p><p>Откройте защищённую панель управления для обработки.</p>",
      };
    case "manager-fitment-request-created":
      return {
        subject: "Новая заявка на подбор",
        text:
          "Создана заявка " +
          requestId +
          ". Контактные данные доступны только в защищённой панели управления.",
        html:
          "<p>Создана заявка <strong>" +
          escapeHtml(requestId) +
          "</strong>.</p><p>Контактные данные доступны только в защищённой панели управления.</p>",
      };
    default:
      throw new Error("UNSUPPORTED_NOTIFICATION_TEMPLATE");
  }
}

export class YandexPostboxNotificationProvider
  implements NotificationProvider
{
  readonly channel = "email" as const;

  constructor(private readonly environment: AuthenticationEmailEnvironment) {}

  async send(notification: NotificationMessage): Promise<void> {
    const content = renderNotification(notification);
    await sendYandexPostboxEmail(this.environment, {
      to: notification.recipient,
      subject: businessConfig.brandName + ": " + content.subject,
      text: content.text,
      html: content.html,
    });
  }
}

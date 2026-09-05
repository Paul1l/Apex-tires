import type { JsonValue } from "../../types/common";

export interface NotificationMessage {
  recipient: string;
  template: string;
  payload: JsonValue;
}

export interface NotificationProvider {
  readonly channel: "email" | "telegram";
  send(notification: NotificationMessage): Promise<void>;
}

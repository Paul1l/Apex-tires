import type { Pool, PoolClient } from "pg";

export type DatabaseExecutor = Pool | PoolClient;

export interface ApplicationLogger {
  error(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

export const applicationLogger: ApplicationLogger = {
  error(context, message) {
    console.error(message, context);
  },
  warn(context, message) {
    console.warn(message, context);
  },
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { [key: string]: JsonValue }
  | JsonValue[];

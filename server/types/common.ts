import type { Pool, PoolClient } from "pg";
import { ZodError } from "zod";
import { ApplicationError } from "../utils/errors";

export type DatabaseExecutor = Pool | PoolClient;

export interface ApplicationLogger {
  error(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

const EMAIL_PATTERN = /[^\s@<>()[\]{}"',;:]+@[^\s@<>()[\]{}"',;:]+\.[^\s@<>()[\]{}"',;:]+/g;
const PHONE_PATTERN = /\+?\d[\d\s().-]{8,}\d/g;
const MAXIMUM_LOGGED_MESSAGE_LENGTH = 300;
const MAXIMUM_LOGGED_STACK_FRAMES = 8;

/** Masks emails and phone-like digit sequences in free text. */
export function redactPersonalData(text: string): string {
  return text.replace(EMAIL_PATTERN, "[email]").replace(PHONE_PATTERN, "[phone]");
}

function readStringProperty(value: object, key: string): string | undefined {
  const property = Reflect.get(value, key);
  return typeof property === "string" || typeof property === "number" ? String(property) : undefined;
}

/**
 * Error summary that is safe for container logs: name, code and a redacted,
 * truncated message plus stack frames. Never includes pg `detail`/`where`
 * (they echo row values such as emails), response bodies or the original
 * first stack line (it repeats the unredacted message).
 */
export function sanitizeError(error: unknown): Record<string, unknown> {
  if (error instanceof ApplicationError) {
    return { name: error.name, code: error.code, statusCode: error.statusCode, message: error.message };
  }
  if (error instanceof ZodError) {
    return { name: "ZodError", issues: error.issues.length };
  }
  if (error instanceof Error) {
    const summary: Record<string, unknown> = {
      name: error.name,
      message: redactPersonalData(error.message).slice(0, MAXIMUM_LOGGED_MESSAGE_LENGTH),
    };
    for (const key of ["code", "constraint", "table", "column", "routine"]) {
      const value = readStringProperty(error, key);
      if (value) summary[key] = value;
    }
    const frames = error.stack
      ?.split("\n")
      .slice(1)
      .filter((line) => line.trimStart().startsWith("at "))
      .slice(0, MAXIMUM_LOGGED_STACK_FRAMES);
    if (frames?.length) summary.stack = frames.map((line) => line.trim()).join("\n");
    return summary;
  }
  return { type: typeof error };
}

export function sanitizeLogContext(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      if (value instanceof Error || key === "error") return [key, sanitizeError(value)];
      if (typeof value === "string") return [key, redactPersonalData(value)];
      return [key, value];
    }),
  );
}

export const applicationLogger: ApplicationLogger = {
  error(context, message) {
    console.error(message, sanitizeLogContext(context));
  },
  warn(context, message) {
    console.warn(message, sanitizeLogContext(context));
  },
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { [key: string]: JsonValue }
  | JsonValue[];

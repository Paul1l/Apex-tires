import { isDatabaseUnavailableError } from "../utils/errors";

export interface DatabaseRetryOptions {
  /** Pauses before the 2nd, 3rd… attempt. */
  delaysMilliseconds?: readonly number[];
  /** No new attempt is started after this time since the first one. */
  deadlineMilliseconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  onRetry?: (error: unknown, attempt: number, delayMilliseconds: number) => void;
}

/** 1 + 2 + 4 + 8 + 15 = 30 s of pauses: enough for a PostgreSQL restart. */
export const DATABASE_RETRY_DELAYS_MILLISECONDS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
/** Upper bound for all attempts (a single attempt can add the 5 s connect timeout). */
export const DATABASE_RETRY_DEADLINE_MILLISECONDS = 45_000;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Repeats `operation` while it fails because PostgreSQL is unavailable
 * (stopping, restarting, unreachable), with growing pauses and a hard
 * deadline, so a caller (e.g. a CLI) never waits forever. Any other error,
 * or the last unavailability error, is thrown unchanged.
 */
export async function retryWhileDatabaseUnavailable<Result>(
  operation: () => Promise<Result>,
  {
    delaysMilliseconds = DATABASE_RETRY_DELAYS_MILLISECONDS,
    deadlineMilliseconds = DATABASE_RETRY_DEADLINE_MILLISECONDS,
    sleep = wait,
    now = Date.now,
    onRetry,
  }: DatabaseRetryOptions = {},
): Promise<Result> {
  const startedAt = now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = delaysMilliseconds[attempt];
      if (
        !isDatabaseUnavailableError(error) ||
        delay === undefined ||
        now() - startedAt + delay > deadlineMilliseconds
      ) {
        throw error;
      }
      onRetry?.(error, attempt + 1, delay);
      await sleep(delay);
    }
  }
}

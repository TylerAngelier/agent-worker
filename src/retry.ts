/**
 * @module src/retry — Shared retry utility with exponential backoff and jitter.
 *
 * Used by all provider implementations to handle HTTP 429 / rate-limit errors
 * with a consistent backoff strategy.
 */
import { log } from "./logger.ts";

const INITIAL_DELAY_MS = 1000;
const JITTER_MS = 500;
const MAX_DELAY_MS = 60000;
const MAX_BACKOFF_RETRIES = 5;

/**
 * Retries an async operation with exponential backoff and jitter on rate-limit errors.
 *
 * Retries when the error message contains "429", "ratelimit", or "rate limit".
 * Starts at 1 s delay, doubles each attempt up to 60 s max, with up to 500 ms random jitter.
 *
 * @typeParam T - Return type of the async operation.
 * @param fn - The async operation to retry.
 * @param maxRetries - Maximum number of retries after the initial attempt (default 5).
 * @param component - Logger component tag for debug output.
 * @returns The result of `fn` on the first successful attempt.
 * @throws The last error encountered after all retries are exhausted.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  component: string = "retry",
  maxRetries: number = MAX_BACKOFF_RETRIES,
): Promise<T> {
  let delay = INITIAL_DELAY_MS;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";

      const isRateLimit =
        message.includes("429") ||
        message.includes("ratelimit") ||
        message.includes("rate limit");

      if (!isRateLimit || attempt === maxRetries) throw err;

      log.debug("Rate limited, backing off", {
        component,
        attempt,
        delayMs: delay + Math.random() * JITTER_MS,
      });
      const jitter = Math.random() * JITTER_MS;
      await Bun.sleep(delay + jitter);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }
  throw new Error("Unreachable");
}

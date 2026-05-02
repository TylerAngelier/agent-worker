/**
 * @module src/providers/backoff — Shared exponential backoff retry for HTTP rate limiting.
 *
 * Used by all ticket provider SPI implementations to handle 429 / rate-limit
 * responses without duplicating retry logic.
 */
import { log } from "../logger.ts";

const INITIAL_DELAY_MS = 1000;
const JITTER_MS = 500;
const MAX_DELAY_MS = 60000;
const MAX_BACKOFF_RETRIES = 5;

/**
 * Retries an async operation with exponential backoff and jitter on rate-limit errors.
 *
 * @param fn - The async operation to retry.
 * @param component - Component name for log tagging (e.g. "linear", "jira").
 * @param maxRetries - Maximum number of retry attempts (default: 5).
 * @returns The result of `fn` on success.
 * @throws The last error if all retries are exhausted or the error is not rate-limit related.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  component: string,
  maxRetries: number = MAX_BACKOFF_RETRIES
): Promise<T> {
  let delay = INITIAL_DELAY_MS;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit =
        (err instanceof Error && err.message.includes("429")) ||
        (err instanceof Error && err.message.toLowerCase().includes("ratelimit")) ||
        (err instanceof Error && err.message.toLowerCase().includes("rate limit"));

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

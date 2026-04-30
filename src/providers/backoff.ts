/**
 * @module src/providers/backoff — Shared exponential backoff with jitter for provider rate-limit retries.
 */
import { log } from "../logger.ts";

const INITIAL_DELAY_MS = 1000;
const JITTER_MS = 500;
const MAX_DELAY_MS = 60000;
const MAX_BACKOFF_RETRIES = 5;

/**
 * Retries an async operation with exponential backoff and jitter on rate-limit errors.
 *
 * Retries when the error message contains "429" or "ratelimit".
 * Starts at 1 s delay, doubles each attempt up to 60 s max, with up to 500 ms random jitter.
 *
 * @typeParam T - Return type of the async operation.
 * @param fn - The async operation to retry.
 * @param options - Optional overrides for max retries and component name for logging.
 * @returns The result of `fn` on the first successful attempt.
 * @throws The last error encountered after all retries are exhausted.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; component?: string }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? MAX_BACKOFF_RETRIES;
  const component = options?.component ?? "unknown";
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

      log.debug("Rate limited, backing off", { component, attempt, delayMs: delay + Math.random() * JITTER_MS });
      const jitter = Math.random() * JITTER_MS;
      await Bun.sleep(delay + jitter);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }
  throw new Error("Unreachable");
}

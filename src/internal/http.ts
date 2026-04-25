/**
 * @module src/internal/http — Shared HTTP client with exponential backoff and component-tagged logging.
 */
import { log } from "../logger.ts";
import type { Logger } from "../logger.ts";

// ── Backoff ───────────────────────────────────────────────────────────────

const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_JITTER_MS = 500;
const DEFAULT_MAX_DELAY_MS = 60000;
const DEFAULT_MAX_RETRIES = 5;

/**
 * Retries an async operation with exponential backoff and jitter on rate-limit errors.
 *
 * Retries when the error message contains "429", "ratelimit", or "rate limit".
 * Starts at 1 s delay, doubles each attempt up to 60 s max, with random jitter.
 *
 * @typeParam T - Return type of the async operation.
 * @param fn - The async operation to retry.
 * @param options - Backoff configuration.
 * @param options.maxRetries - Maximum retries after the initial attempt (default 5).
 * @param options.initialDelayMs - Starting delay in ms (default 1000).
 * @param options.maxDelayMs - Maximum delay cap in ms (default 60000).
 * @param options.jitterMs - Maximum random jitter in ms (default 500).
 * @param options.logger - Logger instance for debug output (defaults to global `log`).
 * @param options.componentName - Component name for log messages (default `"http"`).
 * @returns The result of `fn` on the first successful attempt.
 * @throws The last error encountered after all retries are exhausted.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitterMs?: number;
    logger?: Logger;
    componentName?: string;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelay = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelay = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterMs = options?.jitterMs ?? DEFAULT_JITTER_MS;
  const logger = options?.logger ?? log;
  const component = options?.componentName ?? "http";

  let delay = initialDelay;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit =
        (err instanceof Error && err.message.includes("429")) ||
        (err instanceof Error && err.message.toLowerCase().includes("ratelimit")) ||
        (err instanceof Error && err.message.toLowerCase().includes("rate limit"));

      if (!isRateLimit || attempt === maxRetries) throw err;

      const jitter = Math.random() * jitterMs;
      logger.debug("Rate limited, backing off", { component, attempt, delayMs: delay + jitter });
      await Bun.sleep(delay + jitter);
      delay = Math.min(delay * 2, maxDelay);
    }
  }
  throw new Error("Unreachable");
}

// ── HTTP Client ───────────────────────────────────────────────────────────

/** Configuration for creating an {@link HttpClient}. */
export interface HttpClientOptions {
  /** Base URL for all requests (e.g. `"https://api.github.com"`). Paths are appended. */
  baseUrl: string;
  /** Default headers injected into every request. Auth headers go here. */
  defaultHeaders?: Record<string, string>;
  /** Component name for log messages (e.g. `"jira"`, `"github"`). */
  componentName: string;
  /** Backoff configuration. Omit to disable retries. */
  backoff?: {
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitterMs?: number;
    maxRetries?: number;
  };
}

/** Options for a single HTTP request. */
export interface HttpRequestOptions {
  /** HTTP method (default `"GET"`). */
  method?: string;
  /** URL path appended to `baseUrl` (e.g. `"/issues/42/comments"`). */
  path: string;
  /** Additional headers merged on top of default headers. */
  headers?: Record<string, string>;
  /** Request body. Strings are sent as-is; objects are JSON-serialized. */
  body?: unknown;
  /** HTTP status codes that should NOT be treated as errors (e.g. `[201, 204]`). */
  allowedStatuses?: number[];
}

/** Structured response from an HTTP request. */
export interface HttpResponse<T> {
  /** HTTP status code. */
  status: number;
  /** Parsed response body. */
  data: T;
}

/** A configured HTTP client with backoff, logging, and error handling. */
export interface HttpClient {
  /**
   * Makes an HTTP request with automatic header injection, logging, and optional backoff.
   *
   * @typeParam T - Expected response body type.
   * @param options - Request configuration.
   * @returns Structured response with status code and parsed JSON body.
   * @throws Error with status code and response text on non-OK HTTP status (unless in `allowedStatuses`).
   */
  request<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>>;
}

/**
 * Creates an {@link HttpClient} with configurable base URL, headers, backoff, and logging.
 *
 * The client automatically:
 * - Injects default headers on every request
 * - Logs requests and responses with timing at debug level
 * - Retries on 429 / rate-limit errors when `backoff` is configured
 * - Parses JSON responses
 * - Throws structured errors for non-OK status codes
 *
 * @param options - Client configuration.
 * @returns An {@link HttpClient} instance.
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const defaultHeaders = options.defaultHeaders ?? {};
  const logger = log.child(options.componentName);
  const componentLabel = options.componentName;

  const backoffOptions = options.backoff
    ? {
        maxRetries: options.backoff.maxRetries ?? DEFAULT_MAX_RETRIES,
        initialDelayMs: options.backoff.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
        maxDelayMs: options.backoff.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
        jitterMs: options.backoff.jitterMs ?? DEFAULT_JITTER_MS,
        logger,
        componentName: componentLabel,
      }
    : undefined;

  return {
    async request<T = unknown>(req: HttpRequestOptions): Promise<HttpResponse<T>> {
      const method = req.method ?? "GET";
      const url = `${baseUrl}${req.path}`;

      const headers: Record<string, string> = { ...defaultHeaders, ...req.headers };

      let body: string | undefined;
      if (req.body !== undefined) {
        body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      }

      logger.debug(`${componentLabel} API request`, { method, path: req.path });

      const allowed = req.allowedStatuses ?? [];

      const doRequest = async (): Promise<{ res: Response; json: T | null }> => {
        const start = Date.now();
        const res = await fetch(url, { method, headers, body });
        logger.debug(`${componentLabel} API response`, {
          path: req.path,
          status: res.status,
          durationMs: Date.now() - start,
        });

        if (!res.ok && !allowed.includes(res.status)) {
          const text = await res.text().catch(() => "");
          throw new Error(`${componentLabel} API error ${res.status}: ${text}`);
        }

        // Skip body parsing for empty responses (204 No Content, content-length 0, etc.)
        const contentLength = res.headers?.get?.("content-length");
        if (res.status === 204 || contentLength === "0") {
          return { res, json: null };
        }

        const json = (await res.json()) as T;
        return { res, json };
      };

      const { res, json: data } = backoffOptions
        ? await withBackoff(doRequest, backoffOptions)
        : await doRequest();

      return { status: res.status, data: data as T };
    },
  };
}

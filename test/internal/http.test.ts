import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createHttpClient, withBackoff, type HttpClient } from "../../src/internal/http.ts";
import { initLogger, createLogger } from "../../src/logger.ts";

function mockFetch(fn: typeof fetch) {
  (globalThis as { fetch: typeof fetch }).fetch = fn;
}

describe("withBackoff", () => {
  test("returns result on first successful attempt", async () => {
    const fn = mock(() => Promise.resolve("ok"));
    const result = await withBackoff(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries on 429 error and succeeds", async () => {
    let attempt = 0;
    const fn = mock(async () => {
      attempt++;
      if (attempt < 3) throw new Error("429 Too Many Requests");
      return "ok";
    });

    const result = await withBackoff(fn, {
      maxRetries: 5,
      initialDelayMs: 1,
      maxDelayMs: 10,
      jitterMs: 1,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("retries on ratelimit error (no space)", async () => {
    let attempt = 0;
    const fn = mock(async () => {
      attempt++;
      if (attempt < 2) throw new Error("ratelimit exceeded");
      return "ok";
    });

    const result = await withBackoff(fn, {
      maxRetries: 5,
      initialDelayMs: 1,
      maxDelayMs: 10,
      jitterMs: 1,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("retries on 'rate limit' error (with space)", async () => {
    let attempt = 0;
    const fn = mock(async () => {
      attempt++;
      if (attempt < 2) throw new Error("rate limit exceeded");
      return "ok";
    });

    const result = await withBackoff(fn, {
      maxRetries: 5,
      initialDelayMs: 1,
      maxDelayMs: 10,
      jitterMs: 1,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("throws after exhausting retries", async () => {
    const fn = mock(async () => {
      throw new Error("429 Too Many Requests");
    });

    await expect(
      withBackoff(fn, {
        maxRetries: 2,
        initialDelayMs: 1,
        maxDelayMs: 10,
        jitterMs: 1,
      })
    ).rejects.toThrow("429 Too Many Requests");

    // initial attempt + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("does not retry on non-rate-limit errors", async () => {
    const fn = mock(async () => {
      throw new Error("Internal Server Error");
    });

    await expect(withBackoff(fn, { maxRetries: 5, initialDelayMs: 1 })).rejects.toThrow(
      "Internal Server Error"
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("uses provided logger for debug output", async () => {
    const logs: { msg: string; ctx?: Record<string, unknown> }[] = [];
    const testLogger = createLogger({ level: "debug" });
    const originalDebug = testLogger.debug;
    testLogger.debug = (msg: string, ctx?: Record<string, unknown>) => {
      logs.push({ msg, ctx });
      originalDebug.call(testLogger, msg, ctx);
    };

    let attempt = 0;
    const fn = mock(async () => {
      attempt++;
      if (attempt < 2) throw new Error("429");
      return "ok";
    });

    await withBackoff(fn, {
      maxRetries: 5,
      initialDelayMs: 1,
      maxDelayMs: 10,
      jitterMs: 1,
      logger: testLogger,
      componentName: "test-comp",
    });

    expect(logs.some((l) => l.msg === "Rate limited, backing off")).toBe(true);
    expect(logs.some((l) => l.ctx?.component === "test-comp")).toBe(true);
  });
});

describe("createHttpClient", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  test("makes basic GET request and returns parsed JSON", async () => {
    mockFetch(
      mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 1, name: "test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
      ) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      componentName: "test",
    });

    const { status, data } = await http.request<{ id: number; name: string }>({
      path: "/items",
    });

    expect(status).toBe(200);
    expect(data.id).toBe(1);
    expect(data.name).toBe("test");
  });

  test("makes POST request with JSON body", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch(
      mock((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(
          new Response(JSON.stringify({ id: 2 }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      componentName: "test",
    });

    const { status, data } = await http.request<{ id: number }>({
      method: "POST",
      path: "/items",
      body: { name: "new item" },
    });

    expect(status).toBe(201);
    expect(data.id).toBe(2);

    const call = calls[0]!;
    expect(call.url).toBe("https://api.example.com/items");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.body).toBe(JSON.stringify({ name: "new item" }));
  });

  test("injects default headers", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch(
      mock((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      defaultHeaders: {
        Authorization: "Bearer test-token",
        "X-Custom": "value",
      },
      componentName: "test",
    });

    await http.request({ path: "/test" });

    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["X-Custom"]).toBe("value");
  });

  test("merges request headers on top of default headers", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch(
      mock((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      defaultHeaders: {
        Authorization: "Bearer test-token",
        Accept: "application/json",
      },
      componentName: "test",
    });

    await http.request({
      path: "/test",
      headers: { "X-Override": "yes", Accept: "text/html" },
    });

    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["X-Override"]).toBe("yes");
    // Request headers override default headers
    expect(headers.Accept).toBe("text/html");
  });

  test("throws on non-OK status", async () => {
    mockFetch(
      mock(() =>
        Promise.resolve(
          new Response("Not Found", { status: 404 })
        )
      ) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      componentName: "test",
    });

    await expect(http.request({ path: "/missing" })).rejects.toThrow(
      "test API error 404: Not Found"
    );
  });

  test("allows specified status codes via allowedStatuses", async () => {
    mockFetch(
      mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ created: true }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        )
      ) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      componentName: "test",
    });

    const { status, data } = await http.request<{ created: boolean }>({
      path: "/items",
      allowedStatuses: [201],
    });

    expect(status).toBe(201);
    expect(data.created).toBe(true);
  });

  test("throws on disallowed status even when some are allowed", async () => {
    mockFetch(
      mock(() =>
        Promise.resolve(
          new Response("Forbidden", { status: 403 })
        )
      ) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      componentName: "test",
    });

    await expect(
      http.request({ path: "/items", allowedStatuses: [201, 204] })
    ).rejects.toThrow("test API error 403: Forbidden");
  });

  test("retries on 429 when backoff is configured", async () => {
    let callCount = 0;
    mockFetch(
      mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response("429 Too Many Requests", { status: 429 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      componentName: "test",
      backoff: {
        initialDelayMs: 1,
        maxDelayMs: 10,
        jitterMs: 1,
        maxRetries: 3,
      },
    });

    // The first call returns 429, which isn't an error thrown from fetch —
    // it's a non-OK response. The client will throw "test API error 429: ..."
    // That error message contains "429", so withBackoff should retry.
    const { status, data } = await http.request<{ ok: boolean }>({ path: "/retry-test" });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  test("strips trailing slashes from baseUrl", async () => {
    const calls: string[] = [];
    mockFetch(
      mock((url: string) => {
        calls.push(url);
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com/",
      componentName: "test",
    });

    await http.request({ path: "/items" });
    expect(calls[0]).toBe("https://api.example.com/items");
  });

  test("handles string body without JSON serialization", async () => {
    const calls: { init?: RequestInit }[] = [];
    mockFetch(
      mock((_url: string, init?: RequestInit) => {
        calls.push({ init });
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      componentName: "test",
    });

    await http.request({ path: "/raw", body: "raw text body" });
    expect(calls[0]!.init!.body).toBe("raw text body");
  });

  test("uses component name in error messages", async () => {
    mockFetch(
      mock(() =>
        Promise.resolve(new Response("Bad Request", { status: 400 }))
      ) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      componentName: "my-service",
    });

    await expect(http.request({ path: "/fail" })).rejects.toThrow(
      "my-service API error 400: Bad Request"
    );
  });

  test("handles 204 No Content with null data", async () => {
    mockFetch(
      mock(() =>
        Promise.resolve(
          new Response(null, {
            status: 204,
            headers: { "Content-Length": "0" },
          })
        )
      ) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      componentName: "test",
    });

    const { status, data } = await http.request({
      path: "/items/1/merge",
      allowedStatuses: [204],
    });

    expect(status).toBe(204);
    expect(data).toBeNull();
  });

  test("handles 200 with content-length 0 as null data", async () => {
    mockFetch(
      mock(() =>
        Promise.resolve(
          new Response(null, {
            status: 200,
            headers: { "Content-Length": "0" },
          })
        )
      ) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      componentName: "test",
    });

    const { status, data } = await http.request({
      path: "/items/1/merge",
      allowedStatuses: [200],
    });

    expect(status).toBe(200);
    expect(data).toBeNull();
  });

  test("does not retry when backoff is not configured", async () => {
    let callCount = 0;
    mockFetch(
      mock(() => {
        callCount++;
        return Promise.resolve(new Response("429 Too Many Requests", { status: 429 }));
      }) as unknown as typeof fetch
    );

    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      componentName: "test",
      // No backoff config
    });

    await expect(http.request({ path: "/test" })).rejects.toThrow("test API error 429");
    expect(callCount).toBe(1);
  });
});

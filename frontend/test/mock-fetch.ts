import { vi } from "vitest";

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Stubs global fetch with queued responses (a status + JSON body, or a pending promise)
 * and records every call. Header names are lower-cased, as `Headers` normalises them.
 */
export function mockFetch(...responses: ({ status?: number; body?: unknown } | Promise<never>)[]) {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers)),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const next = queue.shift() ?? { status: 500, body: { error: "no mocked response" } };
      if (next instanceof Promise) return next;
      return new Response(JSON.stringify(next.body ?? null), {
        status: next.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

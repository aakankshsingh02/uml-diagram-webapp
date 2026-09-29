import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getSessionToken, setSessionToken } from "@/shared/lib";
import { ApiError, apiRequest } from "./http";
import { mockFetch } from "@test/mock-fetch";

const Ok = z.strictObject({ ok: z.literal(true) });

describe("apiRequest auth", () => {
  it("sends the stored session token as a bearer header", async () => {
    setSessionToken("tok-123");
    const calls = mockFetch({ body: { ok: true } });

    await apiRequest("/auth/me", Ok);

    expect(calls[0]!.headers.authorization).toBe("Bearer tok-123");
  });

  it("sends no Authorization header without a session", async () => {
    const calls = mockFetch({ body: { ok: true } });

    await apiRequest("/health", Ok);

    expect(calls[0]!.headers).not.toHaveProperty("authorization");
  });

  it("clears the stored session on 401 and surfaces the API error", async () => {
    setSessionToken("expired");
    mockFetch({ status: 401, body: { error: "Unauthorized" } });

    await expect(apiRequest("/auth/me", Ok)).rejects.toMatchObject({ status: 401, message: "Unauthorized" });
    expect(getSessionToken()).toBeNull();
  });

  it("keeps a newer session that was stored while a stale request was in flight", async () => {
    setSessionToken("old");
    let respond!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (respond = r))));

    const request = apiRequest("/auth/me", Ok);
    setSessionToken("new");
    respond(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));

    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(getSessionToken()).toBe("new");
  });

  it("accepts caller headers as a Headers instance", async () => {
    setSessionToken("tok");
    const calls = mockFetch({ body: { ok: true } });

    await apiRequest("/x", Ok, { headers: new Headers({ "X-Trace": "1" }) });

    expect(calls[0]!.headers).toMatchObject({ "x-trace": "1", authorization: "Bearer tok" });
  });

  it("rejects a response that does not match the schema", async () => {
    mockFetch({ body: { ok: true, extra: 1 } });

    await expect(apiRequest("/x", Ok)).rejects.toBeInstanceOf(ApiError);
  });
});

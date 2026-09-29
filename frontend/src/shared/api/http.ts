import { z } from "zod";
import { env } from "@/shared/config";
import { getSessionToken, setSessionToken } from "@/shared/lib";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const ErrorBodySchema = z.object({ error: z.string(), details: z.unknown().optional() });

/** Fetches JSON from the backend and validates the response against a Zod schema. */
export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const token = getSessionToken();
  // new Headers() accepts every HeadersInit shape (object, Headers, tuple array); spreading does not.
  const headers = new Headers(rest.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...rest,
    headers,
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    // Missing, expired or revoked session: drop it so the next sign-in starts clean,
    // unless a newer session was stored while this request was in flight.
    if (res.status === 401 && token && getSessionToken() === token) setSessionToken(null);
    const parsed = ErrorBodySchema.safeParse(body);
    throw new ApiError(res.status, parsed.success ? parsed.data.error : res.statusText, parsed.data?.details);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(res.status, "Unexpected response from server", z.treeifyError(parsed.error));
  }
  return parsed.data;
}

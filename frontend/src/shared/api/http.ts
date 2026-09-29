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

type RequestOptions = RequestInit & { json?: unknown };

function send(path: string, init: RequestOptions | undefined, accept?: string) {
  const { json, ...rest } = init ?? {};
  const token = getSessionToken();
  // new Headers() accepts every HeadersInit shape (object, Headers, tuple array); spreading does not.
  const headers = new Headers(rest.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (accept) headers.set("Accept", accept);
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);

  const response = fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...rest,
    headers,
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  return { response, token };
}

function toApiError(status: number, body: unknown, token: string | null, fallback: string): ApiError {
  // Missing, expired or revoked session: drop it so the next sign-in starts clean,
  // unless a newer session was stored while this request was in flight.
  if (status === 401 && token && getSessionToken() === token) setSessionToken(null);
  const parsed = ErrorBodySchema.safeParse(body);
  return new ApiError(status, parsed.success ? parsed.data.error : fallback, parsed.data?.details);
}

function validated<T>(schema: z.ZodType<T>, status: number, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(status, "Unexpected response from server", z.treeifyError(parsed.error));
  }
  return parsed.data;
}

/** Fetches JSON from the backend and validates the response against a Zod schema. */
export async function apiRequest<T>(path: string, schema: z.ZodType<T>, init?: RequestOptions): Promise<T> {
  const { response, token } = send(path, init);
  const res = await response;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, body, token, res.statusText);
  return validated(schema, res.status, body);
}

export const StreamProgressSchema = z.object({
  type: z.literal("progress"),
  stage: z.string(),
  message: z.string(),
  details: z.array(z.string()).optional(),
  elapsed_ms: z.number(),
});
export type StreamProgress = z.infer<typeof StreamProgressSchema>;

/** A batch of the model's words during one call: its reasoning, or the answer being written. */
export const StreamThinkingSchema = z.object({
  type: z.literal("thinking"),
  stage: z.string(),
  call: z.string(),
  channel: z.enum(["reasoning", "answer"]),
  text: z.string(),
  elapsed_ms: z.number(),
});
export type StreamThinking = z.infer<typeof StreamThinkingSchema>;

const StreamEndSchema = z.object({
  type: z.enum(["result", "error"]),
  status: z.number(),
  body: z.unknown(),
});

/**
 * Like apiRequest, for endpoints that stream NDJSON progress lines and end with a `result` or
 * `error` line carrying the real status and body. Progress lines go to `onProgress` as they arrive.
 */
export async function apiStream<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestOptions & {
    onProgress: (event: StreamProgress) => void;
    onThinking?: (event: StreamThinking) => void;
  },
): Promise<T> {
  const { onProgress, onThinking, ...rest } = init;
  const { response, token } = send(path, rest, "application/x-ndjson");
  const res = await response;
  // Errors raised before streaming starts (validation, auth) come back as plain JSON.
  if (!res.ok || !res.headers.get("content-type")?.includes("ndjson") || !res.body) {
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw toApiError(res.status, body, token, res.statusText);
    return validated(schema, res.status, body);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffered += value ?? "";
    const lines = done ? [buffered] : buffered.split("\n");
    buffered = done ? "" : lines.pop()!;

    for (const line of lines.filter((l) => l.trim())) {
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue; // a torn line can only be the last one of a dropped connection
      }
      const progress = StreamProgressSchema.safeParse(event);
      if (progress.success) {
        onProgress(progress.data);
        continue;
      }
      const thinking = StreamThinkingSchema.safeParse(event);
      if (thinking.success) {
        onThinking?.(thinking.data);
        continue;
      }
      const end = StreamEndSchema.safeParse(event);
      if (!end.success) continue;
      await reader.cancel().catch(() => undefined);
      if (end.data.type === "error") throw toApiError(end.data.status, end.data.body, token, "Request failed");
      return validated(schema, end.data.status, end.data.body);
    }
    if (done) break;
  }
  throw new ApiError(0, "The connection closed before the result arrived. Check the conversation list; the version may still have been saved.");
}

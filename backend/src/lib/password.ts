import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { HttpError } from "./http-error.js";

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

// OWASP-recommended scrypt cost (N=2^17, r=8, p=1) needs ~128 MiB per hash.
const PARAMS: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// Stored hashes can carry other parameters (older or migrated rows); refuse any that would
// allocate more than this, so a bad row cannot exhaust memory.
const MAX_MEMORY = 256 * 1024 * 1024;
const MAX_P = 16;

// Each hash holds ~128 MiB for ~0.3 s: cap how many run at once and how many may wait,
// so a burst of logins degrades to 503s instead of exhausting memory.
export const MAX_CONCURRENT_HASHES = 4;
export const MAX_QUEUED_HASHES = 32;
let running = 0;
const queue: (() => void)[] = [];

async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running < MAX_CONCURRENT_HASHES) {
    running++;
  } else {
    if (queue.length >= MAX_QUEUED_HASHES) throw HttpError.unavailable("Too many sign-in attempts right now, try again shortly");
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  try {
    return await fn();
  } finally {
    // Hand the slot straight to the next waiter; only free it when nobody is waiting.
    const next = queue.shift();
    if (next) next();
    else running--;
  }
}

function derive(password: string, salt: Buffer, params: ScryptParams) {
  const options: ScryptOptions = { ...params, maxmem: MAX_MEMORY + 1024 * 1024 };
  return withHashSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
      }),
  );
}

interface ParsedHash {
  params: ScryptParams;
  salt: Buffer;
  key: Buffer;
}

/** Parses `scrypt$N$r$p$salt$key`; null when malformed or outside the safe bounds. */
function parse(stored: string): ParsedHash | null {
  const [scheme, n, r, p, salt, key, ...extra] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key || extra.length > 0) return null;
  if (![n, r, p].every((v) => v !== undefined && /^[1-9]\d{0,9}$/.test(v))) return null;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  const powerOfTwo = params.N > 1 && (params.N & (params.N - 1)) === 0;
  if (!powerOfTwo || 128 * params.N * params.r > MAX_MEMORY || params.p > MAX_P) return null;
  return { params, salt: Buffer.from(salt, "base64"), key: Buffer.from(key, "base64") };
}

/** Self-describing hash: `scrypt$N$r$p$salt$key` (base64), so parameters can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** False for a wrong password and for any malformed or out-of-bounds stored hash; never throws on bad input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed || parsed.key.length !== KEY_LENGTH) return false;
  const actual = await derive(password, parsed.salt, parsed.params);
  return timingSafeEqual(actual, parsed.key);
}

/** True when a hash was made with other parameters than today's, so it should be replaced on login. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  return !parsed || parsed.params.N !== PARAMS.N || parsed.params.r !== PARAMS.r || parsed.params.p !== PARAMS.p;
}

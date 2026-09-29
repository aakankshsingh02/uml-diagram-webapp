import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/lib/http-error.js";
import {
  MAX_CONCURRENT_HASHES,
  MAX_QUEUED_HASHES,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "../../src/lib/password.js";

const SALT = Buffer.from("salt-salt-salt!!").toString("base64");
const KEY = Buffer.alloc(64).toString("base64");

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored).toMatch(/^scrypt\$131072\$8\$1\$[^$]+\$[^$]+$/);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong horse", stored)).toBe(false);
    expect(needsRehash(stored)).toBe(false);
  });

  it.each([
    ["a non-numeric N", `scrypt$abc$8$1$${SALT}$${KEY}`],
    ["an N that is not a power of two", `scrypt$1000$8$1$${SALT}$${KEY}`],
    ["an N too large for the memory cap", `scrypt$${2 ** 30}$8$1$${SALT}$${KEY}`],
    ["a p above the cap", `scrypt$16384$8$99$${SALT}$${KEY}`],
    ["an unknown scheme", `bcrypt$16384$8$1$${SALT}$${KEY}`],
    ["missing fields", "scrypt$16384$8$1"],
    ["extra fields", `scrypt$16384$8$1$${SALT}$${KEY}$more`],
    ["a key of the wrong length", `scrypt$16384$8$1$${SALT}$${Buffer.alloc(8).toString("base64")}`],
    ["an empty string", ""],
  ])("returns false without throwing for %s, and flags it for rehash", async (_label, stored) => {
    await expect(verifyPassword("anything", stored)).resolves.toBe(false);
    expect(needsRehash(stored)).toBe(true);
  });

  it("flags hashes made with other parameters for rehash", () => {
    expect(needsRehash(`scrypt$16384$8$1$${SALT}$${KEY}`)).toBe(true);
  });

  it("answers 503 instead of queueing without limit when too many hashes run at once", async () => {
    const burst = MAX_CONCURRENT_HASHES + MAX_QUEUED_HASHES + 3;
    const results = await Promise.allSettled(Array.from({ length: burst }, () => hashPassword("burst")));

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(HttpError);
      expect(r.reason.status).toBe(503);
    }
    // Slots are released afterwards: a later hash still works.
    await expect(hashPassword("after")).resolves.toMatch(/^scrypt\$/);
  }, 60_000);
});

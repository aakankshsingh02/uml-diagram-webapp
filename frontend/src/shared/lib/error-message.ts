import { ZodError } from "zod";

/** A short, user-facing message for anything thrown by a request or a Zod parse. */
export function errorMessage(err: unknown): string {
  if (err instanceof ZodError) return err.issues[0]?.message ?? "Invalid input";
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong";
}

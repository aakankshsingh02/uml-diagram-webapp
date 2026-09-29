import { z } from "zod";

const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const SignupRequestSchema = z.strictObject({
  email: EmailSchema,
  // Upper bound keeps hashing cost bounded; no composition rules, per NIST 800-63B.
  password: z.string().min(8).max(128),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

// Login does not re-check password length so existing accounts survive policy changes.
export const LoginRequestSchema = z.strictObject({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

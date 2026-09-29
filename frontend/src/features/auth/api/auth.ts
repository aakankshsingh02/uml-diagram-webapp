import { z } from "zod";
import { UserSchema } from "@/entities/user";
import { apiRequest } from "@/shared/api";

const EmailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));

// Mirrors the backend: signup enforces the length policy, login only requires a password.
export const LoginRequestSchema = z.strictObject({
  email: EmailSchema,
  password: z.string().min(1, "Enter your password").max(128, "Password is too long"),
});
export const SignupRequestSchema = z.strictObject({
  email: EmailSchema,
  password: z.string().min(8, "Use at least 8 characters").max(128, "Use at most 128 characters"),
});
export type Credentials = z.input<typeof LoginRequestSchema>;

const AuthResponseSchema = z.strictObject({ token: z.string().min(1), user: UserSchema });
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export function signup(input: Credentials) {
  return apiRequest("/auth/signup", AuthResponseSchema, { method: "POST", json: SignupRequestSchema.parse(input) });
}

export function login(input: Credentials) {
  return apiRequest("/auth/login", AuthResponseSchema, { method: "POST", json: LoginRequestSchema.parse(input) });
}

/** 204 No Content: the empty body parses as null. */
export function logout() {
  return apiRequest("/auth/logout", z.null(), { method: "POST" });
}

export function fetchMe() {
  return apiRequest("/auth/me", z.strictObject({ user: UserSchema }));
}

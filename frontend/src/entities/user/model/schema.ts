import { z } from "zod";

export const UserSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  created_at: z.iso.datetime(),
});

export type User = z.infer<typeof UserSchema>;

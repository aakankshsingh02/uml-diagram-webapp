import { z } from "zod";

export const TrajectoryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const AckRequestSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(1000),
  // Kept as the exact string from X-Export-As-Of so microsecond precision survives to SQL.
  as_of: z.iso.datetime({ offset: true }),
});
export type AckRequest = z.infer<typeof AckRequestSchema>;

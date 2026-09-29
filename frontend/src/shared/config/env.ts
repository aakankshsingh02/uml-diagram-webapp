import { z } from "zod";

export const env = z
  .object({
    NEXT_PUBLIC_API_URL: z.url().default("http://localhost:4000/api"),
  })
  // Next inlines NEXT_PUBLIC_* only when referenced literally.
  .parse({ NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL });

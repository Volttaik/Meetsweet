import { z } from "zod";

export const createPostSchema = z.object({
  caption: z.string().max(2200).optional(),
  visibility: z.enum(["public", "subscribers", "private"]).default("public"),
  status: z.enum(["draft", "published"]).default("published"),
  preview_duration: z.number().int().positive().optional(),
  expires_at: z.string().datetime().optional(),
  media_ids: z.array(z.string().uuid()).max(10).optional(),
});

export const updatePostSchema = z.object({
  caption: z.string().max(2200).optional(),
  visibility: z.enum(["public", "subscribers", "private"]).optional(),
  preview_duration: z.number().int().positive().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

export const postQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

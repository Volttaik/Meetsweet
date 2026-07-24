import { z } from "zod";

export const createCommentSchema = z.object({
  body: z.string().min(1).max(1000),
  mention_ids: z.array(z.string().uuid()).max(5).optional(),
});

export const createReplySchema = z.object({
  body: z.string().min(1).max(1000),
  mention_id: z.string().uuid().optional(),
});

export const updateCommentSchema = z.object({
  body: z.string().min(1).max(1000),
});

export const commentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

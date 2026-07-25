import { z } from "zod";

export const sendMessageSchema = z.object({
  conversation_id: z.string().uuid().optional(),
  body: z.string().max(4000).optional(),
  type: z.enum(["text", "image", "video", "audio", "file"]).default("text"),
  media_url: z.string().url().optional(),
  media_blob_path: z.string().optional(),
  reply_to_id: z.string().uuid().optional(),
});

export const createConversationSchema = z.object({
  participant_ids: z.array(z.string().uuid()).min(1).max(49),
  type: z.enum(["direct", "group"]).default("direct"),
  name: z.string().max(100).optional(),
});

export const editMessageSchema = z.object({
  body: z.string().max(4000).min(1),
});

export const reactMessageSchema = z.object({
  emoji: z.string().max(8),
});

export const messageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

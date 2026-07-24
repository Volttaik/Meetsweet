import { z } from "zod";

export const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  website: z.string().url().optional().or(z.literal("")),
  location: z.string().max(100).optional(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).optional(),
});

export const creatorSettingsSchema = z.object({
  subscription_price: z.number().min(0).optional(),
  allow_dms: z.boolean().optional(),
  allow_comments: z.boolean().optional(),
  welcome_message: z.string().max(500).optional(),
});

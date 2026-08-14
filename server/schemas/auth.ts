import { z } from "zod";

export const registerSchema = z.object({
  full_name: z.string().min(2).max(100),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscores"),
  email: z.string().email(),
  phone: z.string().min(7).max(20).optional(),
  bio: z.string().max(300).optional(),
  date_of_birth: z.string().max(10).optional(),
  dob: z.string().max(10).optional(),
  avatar_url: z.string().url().optional(),
  password: z.string().min(8).max(128),
  confirm_password: z.string(),
}).refine((d) => d.password === d.confirm_password, {
  message: "Passwords do not match",
  path: ["confirm_password"],
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device_id: z.string().optional(),
});

export const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  password: z.string().min(8).max(128),
  confirm_password: z.string(),
}).refine((d) => d.password === d.confirm_password, {
  message: "Passwords do not match",
  path: ["confirm_password"],
});

export const updatePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(128),
  confirm_password: z.string(),
}).refine((d) => d.new_password === d.confirm_password, {
  message: "Passwords do not match",
  path: ["confirm_password"],
});

export const updateEmailSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
});

export const resendVerificationSchema = z.object({
  email: z.string().email(),
});

export const usernameAvailabilitySchema = z.object({
  username: z.string().min(3).max(30),
});

export const twoFaEnableSchema = z.object({
  code: z.string().length(6),
});

export const twoFaDisableSchema = z.object({
  password: z.string().min(1),
  code: z.string().length(6).optional(),
});

export const twoFaVerifySchema = z.object({
  challenge_token: z.string().min(1),
  code: z.string().length(6),
});

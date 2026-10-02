import { z } from "zod";

const email = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(60),
  email,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters")
    .regex(/[A-Za-z]/, "Password must contain a letter")
    .regex(/\d/, "Password must contain a number"),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(72),
});

export const googleSchema = z.object({
  credential: z.string().min(20).max(4096),
});

export const verifyEmailSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{96}$/, "Invalid token"),
});

export const resendSchema = z.object({ email });

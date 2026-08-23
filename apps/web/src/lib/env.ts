import { z } from 'zod';

/**
 * Public-safe environment variables. Only NEXT_PUBLIC_* values reach the
 * browser bundle. Server-side values live alongside but are never exposed.
 */

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  NEXT_PUBLIC_APP_ENV: z.string().default('development'),
  NEXT_PUBLIC_APP_VERSION: z.string().default('0.1.0'),
});

const ServerEnvSchema = PublicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

/**
 * Public env — safe to read in client components. Falls back to undefined
 * values; consumers (e.g. Supabase clients) detect missing config and use
 * bundled mock data instead.
 */
export const publicEnv = PublicEnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
});

/**
 * Server-only env. Throws if accessed in client code (gated by 'server-only'
 * import in server.ts). Adds SUPABASE_SERVICE_ROLE_KEY for elevated rights
 * (only used by apps/admin; this app deliberately exposes none).
 */
export const serverEnv =
  typeof window === 'undefined' ? ServerEnvSchema.parse(process.env) : publicEnv;

/**
 * True when both public Supabase values are present, meaning we can use the
 * real Supabase backend. Otherwise callers fall back to mock data.
 */
export const isSupabaseConfigured = Boolean(
  publicEnv.NEXT_PUBLIC_SUPABASE_URL && publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

import { z } from 'zod';

/**
 * Admin env — Supabase keys only. Phase 1 ships without login, so no
 * NextAuth / ADMIN_PASSWORD_HASH / AUTH_SECRET. All values server-side
 * only; never exposed to the browser bundle.
 */
const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

function parseEnv() {
  if (typeof window !== 'undefined') {
    // Never read server env from the browser.
    return {} as z.infer<typeof EnvSchema>;
  }
  return EnvSchema.parse(process.env);
}

export const serverEnv = parseEnv();

export const isSupabaseConfigured = Boolean(
  serverEnv.NEXT_PUBLIC_SUPABASE_URL && serverEnv.SUPABASE_SERVICE_ROLE_KEY,
);

/**
 * Admin user stamp used for the Phase 7 / 8 approval workflow.
 *
 * Today the admin app runs without auth, so every approval is stamped
 * with this constant. When real session auth lands in a later phase,
 * replace this with the session user id — the column shape doesn't
 * need to change.
 */
export const EY_ADMIN_DEFAULT_USER =
  process.env.EY_ADMIN_DEFAULT_USER ?? 'local-dev';

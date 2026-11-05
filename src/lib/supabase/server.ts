import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the SERVICE ROLE key.
 *
 * - This module must never be imported from a client component (`server-only`
 *   makes that a build-time error).
 * - JobDedo does not use Supabase Auth. RLS is enabled on every table with no
 *   public policies; only this service-role client (bypassing RLS) touches the
 *   database, exclusively from Next.js server code.
 */

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

let client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (!supabaseConfigured()) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  }
  return client;
}

export function storageBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || "resumes";
}

/** The Supabase service-role client, exported as `db` for route handlers. */
export let db: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (!db) {
    db = getServiceClient();
  }
  return db;
}

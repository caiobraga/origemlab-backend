import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseFetch } from "./supabaseFetch.js";

const SERVER_AUTH_OPTIONS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

export function createServerSupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: SERVER_AUTH_OPTIONS,
    global: { fetch: supabaseFetch as typeof fetch },
  });
}

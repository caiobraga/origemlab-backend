import { createClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";

export type AuthGateway = {
  signInWithPassword(email: string, password: string): Promise<{
    userId: string;
    email: string | null;
    accessToken: string;
    refreshToken: string;
    expiresAtMs: number;
  }>;
  signUp(email: string, password: string): Promise<void>;
  refresh(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAtMs: number;
  }>;
  getUserIdFromAccessToken(accessToken: string): Promise<string | null>;
};

export function buildSupabaseAuthGateway(config: AppConfig): AuthGateway {
  const url = config.supabase.url;
  const anonKey = config.supabase.anonKey;
  if (!url || !anonKey) {
    throw new Error("Supabase anon key not configured (SUPABASE_ANON_KEY).");
  }
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async signInWithPassword(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session || !data.user) {
        throw new Error(error?.message || "invalid_login");
      }
      const expiresAtSec = (data.session.expires_at ?? 0) * 1000;
      return {
        userId: data.user.id,
        email: data.user.email ?? null,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAtMs: expiresAtSec || Date.now() + (data.session.expires_in ?? 3600) * 1000,
      };
    },
    async signUp(email, password) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw new Error(error.message);
    },
    async refresh(refreshToken) {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) throw new Error(error?.message || "refresh_failed");
      const expiresAtSec = (data.session.expires_at ?? 0) * 1000;
      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAtMs: expiresAtSec || Date.now() + (data.session.expires_in ?? 3600) * 1000,
      };
    },
    async getUserIdFromAccessToken(accessToken) {
      const { data, error } = await supabase.auth.getUser(accessToken);
      if (error) return null;
      return data.user?.id ?? null;
    },
  };
}


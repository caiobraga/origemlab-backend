import type { AppConfig } from "../config.js";
import { createServerSupabaseClient } from "./supabaseClient.js";

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

/** Valida exp do JWT Supabase sem chamar a API (fallback se getUser falhar). */
function userIdFromJwtPayload(accessToken: string): string | null {
  try {
    const part = accessToken.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      sub?: string;
      exp?: number;
    };
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now() + 5_000) {
      return null;
    }
    return payload.sub;
  } catch {
    return null;
  }
}

export function buildSupabaseAuthGateway(config: AppConfig): AuthGateway {
  const url = config.supabase.url;
  const anonKey = config.supabase.anonKey;
  if (!url || !anonKey) {
    throw new Error("Supabase anon key not configured (SUPABASE_ANON_KEY).");
  }
  const supabase = createServerSupabaseClient(url, anonKey);

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
      try {
        const { data, error } = await supabase.auth.getUser(accessToken);
        if (data.user?.id) return data.user.id;
        if (!error) return userIdFromJwtPayload(accessToken);
      } catch {
        // rede / timeout — usa payload local
      }
      return userIdFromJwtPayload(accessToken);
    },
  };
}


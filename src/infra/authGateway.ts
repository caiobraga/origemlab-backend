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
  signUp(
    email: string,
    password: string,
    options?: { emailRedirectTo?: string },
  ): Promise<{
    userId: string | null;
    email: string | null;
    session: {
      accessToken: string;
      refreshToken: string;
      expiresAtMs: number;
    } | null;
    needsEmailConfirmation: boolean;
  }>;
  refresh(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAtMs: number;
  }>;
  getUserIdFromAccessToken(accessToken: string): Promise<string | null>;
  /** Best-effort email from token (JWT claim or getUser). */
  getEmailFromAccessToken(accessToken: string): Promise<string | null>;
};

/** Valida exp do JWT Supabase sem chamar a API (fallback se getUser falhar). */
function claimsFromJwtPayload(accessToken: string): { userId: string; email: string | null } | null {
  try {
    const part = accessToken.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      sub?: string;
      email?: string;
      exp?: number;
    };
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now() + 5_000) {
      return null;
    }
    const email =
      typeof payload.email === "string" && payload.email.trim() ? payload.email.trim() : null;
    return { userId: payload.sub, email };
  } catch {
    return null;
  }
}

function userIdFromJwtPayload(accessToken: string): string | null {
  return claimsFromJwtPayload(accessToken)?.userId ?? null;
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
    async signUp(email, password, options) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: options?.emailRedirectTo
          ? { emailRedirectTo: options.emailRedirectTo }
          : undefined,
      });
      if (error) throw new Error(error.message);

      const identities = data.user?.identities;
      const likelyDuplicate =
        Array.isArray(identities) && identities.length === 0;

      if (likelyDuplicate) {
        // Não inventa sessão; o front deve orientar reenvio / login.
        return {
          userId: data.user?.id ?? null,
          email: data.user?.email ?? email,
          session: null,
          needsEmailConfirmation: true,
        };
      }

      if (!data.session) {
        return {
          userId: data.user?.id ?? null,
          email: data.user?.email ?? email,
          session: null,
          needsEmailConfirmation: true,
        };
      }

      const expiresAtSec = (data.session.expires_at ?? 0) * 1000;
      return {
        userId: data.user?.id ?? null,
        email: data.user?.email ?? email,
        session: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAtMs:
            expiresAtSec || Date.now() + (data.session.expires_in ?? 3600) * 1000,
        },
        needsEmailConfirmation: false,
      };
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
    async getEmailFromAccessToken(accessToken) {
      const fromJwt = claimsFromJwtPayload(accessToken)?.email ?? null;
      if (fromJwt) return fromJwt;
      try {
        const { data } = await supabase.auth.getUser(accessToken);
        const email = data.user?.email;
        if (typeof email === "string" && email.trim()) return email.trim();
      } catch {
        /* ignore */
      }
      return null;
    },
  };
}


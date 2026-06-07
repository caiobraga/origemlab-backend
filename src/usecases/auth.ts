import crypto from "node:crypto";
import type { Request, Response } from "express";
import type { AppConfig } from "../config.js";
import type { SessionStore } from "../infra/sessionStore.js";
import type { AuthGateway } from "../infra/authGateway.js";
import { clearCookie, getCookie, setHttpOnlyCookie } from "../http/cookies.js";

function newSessionId() {
  return crypto.randomBytes(24).toString("base64url");
}

function sessionMaxAgeSeconds() {
  return 60 * 60 * 24 * 14; // 14d
}

/** SameSite=None exige Secure em HTTPS; em localhost HTTP usamos Secure=false. */
function cookieSecureForRequest(req: Request, configured: boolean): boolean {
  if (configured) return true;
  const proto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return proto === "https";
}

export type AuthUseCases = {
  signIn(req: Request, res: Response): Promise<{ status: number; body: any }>;
  signUp(req: Request, res: Response): Promise<{ status: number; body: any }>;
  signOut(_req: Request, res: Response): Promise<{ status: number; body: any }>;
  syncSupabase(req: Request, res: Response): Promise<{ status: number; body: any }>;
  me(req: Request): Promise<{ status: number; body: any }>;
  requireSessionUserId(req: Request): Promise<string>;
};

function isSupabaseNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    /fetch failed/i.test(msg) ||
    /ETIMEDOUT|ENETUNREACH|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT/i.test(msg)
  );
}

function extractBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export function buildAuthUseCases(deps: {
  config: AppConfig;
  sessions: SessionStore;
  auth: AuthGateway;
}) : AuthUseCases {
  const refreshInflight = new Map<
    string,
    Promise<{ accessToken: string; refreshToken: string; expiresAtMs: number }>
  >();

  async function refreshSessionLocked(
    sid: string,
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAtMs: number }> {
    const existing = refreshInflight.get(sid);
    if (existing) return existing;
    const p = deps.auth.refresh(refreshToken).finally(() => refreshInflight.delete(sid));
    refreshInflight.set(sid, p);
    return p;
  }

  async function requireSessionUserId(req: Request): Promise<string> {
    const sid = getCookie(req, deps.config.auth.cookieName);
    if (sid) {
      const s = deps.sessions.get(sid);
      if (s) {
        if (Date.now() > s.expiresAtMs - 60_000) {
          try {
            const refreshed = await refreshSessionLocked(sid, s.refreshToken);
            deps.sessions.set(sid, { ...s, ...refreshed });
          } catch (e) {
            if (isSupabaseNetworkError(e)) {
              throw new Error("supabase_unreachable");
            }
            throw e;
          }
        }
        return s.userId;
      }
    }

    const bearer = extractBearerToken(req);
    if (bearer) {
      const userId = await deps.auth.getUserIdFromAccessToken(bearer);
      if (userId) return userId;
    }

    throw new Error("unauthenticated");
  }

  return {
    async signIn(req, res) {
      const email = String((req as any).body?.email || "").trim();
      const password = String((req as any).body?.password || "");
      if (!email || !password) return { status: 400, body: { error: "email e password obrigatórios" } };

      try {
        const session = await deps.auth.signInWithPassword(email, password);
        const sid = newSessionId();
        deps.sessions.set(sid, {
          userId: session.userId,
          email: session.email,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresAtMs: session.expiresAtMs,
        });
        setHttpOnlyCookie(res, {
          name: deps.config.auth.cookieName,
          value: sid,
          secure: cookieSecureForRequest(req, deps.config.auth.cookieSecure),
          maxAgeSeconds: sessionMaxAgeSeconds(),
        });
        return {
          status: 200,
          body: {
            ok: true,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            expiresAtMs: session.expiresAtMs,
            user: { id: session.userId, email: session.email ?? null },
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao fazer login";
        return { status: 401, body: { error: msg } };
      }
    },

    async signUp(req, res) {
      const email = String((req as any).body?.email || "").trim();
      const password = String((req as any).body?.password || "");
      if (!email || !password) return { status: 400, body: { error: "email e password obrigatórios" } };
      try {
        await deps.auth.signUp(email, password);
        // optionally auto-login
        return await this.signIn(req, res);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao criar conta";
        return { status: 400, body: { error: msg } };
      }
    },

    async signOut(req, res) {
      const sid = getCookie(req, deps.config.auth.cookieName);
      if (sid) deps.sessions.delete(sid);
      clearCookie(res, {
        name: deps.config.auth.cookieName,
        secure: cookieSecureForRequest(req, deps.config.auth.cookieSecure),
      });
      return { status: 200, body: { ok: true } };
    },

    async syncSupabase(req, res) {
      const accessToken = String((req as any).body?.accessToken || "").trim();
      const refreshToken = String((req as any).body?.refreshToken || "").trim();
      let expiresAtMs = Number((req as any).body?.expiresAtMs);
      if (!accessToken) return { status: 400, body: { error: "accessToken obrigatório" } };

      const userId = await deps.auth.getUserIdFromAccessToken(accessToken);
      if (!userId) return { status: 401, body: { error: "invalid_token" } };

      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        expiresAtMs = Date.now() + 3600_000;
      }

      const sid = newSessionId();
      deps.sessions.set(sid, {
        userId,
        accessToken,
        refreshToken,
        expiresAtMs,
      });
      setHttpOnlyCookie(res, {
        name: deps.config.auth.cookieName,
        value: sid,
        secure: cookieSecureForRequest(req, deps.config.auth.cookieSecure),
        maxAgeSeconds: sessionMaxAgeSeconds(),
      });
      return { status: 200, body: { ok: true, user: { id: userId } } };
    },

    async me(req) {
      try {
        const sid = getCookie(req, deps.config.auth.cookieName);
        if (sid) {
          const s = deps.sessions.get(sid);
          if (s) return { status: 200, body: { user: { id: s.userId, email: s.email ?? null } } };
        }

        const bearer = extractBearerToken(req);
        if (bearer) {
          const userId = await deps.auth.getUserIdFromAccessToken(bearer);
          if (userId) return { status: 200, body: { user: { id: userId, email: null } } };
        }

        return { status: 200, body: { user: null } };
      } catch {
        return { status: 200, body: { user: null } };
      }
    },

    requireSessionUserId,
  };
}


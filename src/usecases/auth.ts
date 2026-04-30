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

export type AuthUseCases = {
  signIn(req: Request, res: Response): Promise<{ status: number; body: any }>;
  signUp(req: Request, res: Response): Promise<{ status: number; body: any }>;
  signOut(_req: Request, res: Response): Promise<{ status: number; body: any }>;
  me(req: Request): Promise<{ status: number; body: any }>;
  requireSessionUserId(req: Request): Promise<string>;
};

export function buildAuthUseCases(deps: {
  config: AppConfig;
  sessions: SessionStore;
  auth: AuthGateway;
}) : AuthUseCases {
  async function requireSessionUserId(req: Request): Promise<string> {
    const sid = getCookie(req, deps.config.auth.cookieName);
    if (!sid) throw new Error("unauthenticated");
    const s = deps.sessions.get(sid);
    if (!s) throw new Error("unauthenticated");
    // refresh if expiring within 60s
    if (Date.now() > s.expiresAtMs - 60_000) {
      const refreshed = await deps.auth.refresh(s.refreshToken);
      deps.sessions.set(sid, { ...s, ...refreshed });
    }
    return s.userId;
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
          secure: deps.config.auth.cookieSecure,
          maxAgeSeconds: sessionMaxAgeSeconds(),
        });
        return { status: 200, body: { ok: true } };
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
      clearCookie(res, { name: deps.config.auth.cookieName, secure: deps.config.auth.cookieSecure });
      return { status: 200, body: { ok: true } };
    },

    async me(req) {
      try {
        const sid = getCookie(req, deps.config.auth.cookieName);
        if (!sid) return { status: 200, body: { user: null } };
        const s = deps.sessions.get(sid);
        if (!s) return { status: 200, body: { user: null } };
        return { status: 200, body: { user: { id: s.userId, email: s.email ?? null } } };
      } catch {
        return { status: 200, body: { user: null } };
      }
    },

    requireSessionUserId,
  };
}


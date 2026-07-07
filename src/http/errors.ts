import type { NextFunction, Request, Response } from "express";
import { buildCorsAllowList } from "./cors.js";

export class HttpError extends Error {
  readonly status: number;
  readonly publicMessage: string;
  readonly code?: string;

  constructor(status: number, publicMessage: string, opts?: { code?: string; cause?: unknown }) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
    this.code = opts?.code;
    if (opts?.cause) (this as any).cause = opts.cause;
  }
}

export function errorToHttp(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.publicMessage } };
  const msg = err instanceof Error ? err.message : "internal_error";
  if ((err as any)?.code === "LIMIT_FILE_SIZE") {
    return { status: 413, body: { error: "PDF acima de 48 MB." } };
  }
  if (msg === "supabase_unreachable") {
    return {
      status: 503,
      body: { error: "Serviço de autenticação indisponível. Tente novamente em instantes." },
    };
  }
  return { status: 500, body: { error: msg } };
}

export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // Garante CORS em erros da app (ex.: 503 Ollama) se o middleware principal não tiver setado.
  if (!res.getHeader("Access-Control-Allow-Origin")) {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    const allow = buildCorsAllowList({
      allowOrigin: process.env.CORS_ALLOW_ORIGIN || "*",
      appBaseUrl: process.env.APP_BASE_URL || "",
      frontOrigins: process.env.FRONT_ORIGINS || "",
    });
    const wildcard = allow.includes("*");
    const normalized = origin.replace(/\/$/, "");
    const ok =
      wildcard ||
      (normalized && allow.some((a) => a === normalized || a === origin));
    if (ok && normalized) {
      res.setHeader("Access-Control-Allow-Origin", normalized);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }
  const { status, body } = errorToHttp(err);
  res.status(status).json(body);
}


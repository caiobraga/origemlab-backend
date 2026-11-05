import type { NextFunction, Request, Response } from "express";
import { buildCorsAllowList } from "./cors.js";
import { isAiTimeoutError, isOllamaConnectionError } from "../infra/ollamaHealth.js";

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

/** Mensagem genérica exibida ao usuário quando um erro inesperado (5xx) acontece. */
export const GENERIC_PUBLIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";
/** Mensagem genérica para serviço indisponível (503). */
export const UNAVAILABLE_PUBLIC_ERROR = "Serviço temporariamente indisponível. Tente novamente em instantes.";
/** Supabase Auth fora do ar (erro interno `supabase_unreachable`). */
export const AUTH_UNAVAILABLE_PUBLIC_ERROR =
  "Serviço de autenticação indisponível. Tente novamente em instantes.";
/** Código estável (campo `error`) quando a geração de IA estoura o tempo limite (HTTP 504). */
export const AI_TIMEOUT_ERROR_CODE = "ai_timeout";
export const AI_TIMEOUT_PUBLIC_ERROR =
  "A IA demorou mais que o esperado. Tente novamente ou divida o texto em partes menores.";

/**
 * Detalhes internos que nunca devem chegar ao usuário (DB/PostgREST, Stripe, IA, env, stack…).
 * Evite termos genéricos (ex.: "Stripe", "undefined") que escondem mensagens de negócio legítimas.
 */
const INTERNAL_DETAIL_RE =
  /SUPABASE_|SERVICE_ROLE|ANON_KEY|not configured|não configurad|PostgREST|PGRST|violates|duplicate key|relation "|column "|syntax error|invalid input syntax|\bStripe\w*Error\b|api\.stripe\.com|\bsk_(?:live|test)_|\bNo such (?:customer|price|product|subscription)\b|OpenRouter|Ollama|Tavily|Serper|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|UND_ERR|socket hang up|s3:\/\/|TypeError|ReferenceError|Cannot read prop|is not a function|\bat .+:\d+:\d+/i;

export function isInternalErrorMessage(msg: string): boolean {
  return !msg.trim() || INTERNAL_DETAIL_RE.test(msg);
}

/**
 * Versão do erro para log: erros PostgREST/Supabase ({ code, message, details, hint }) podem trazer
 * valores do usuário (e-mail, CNPJ) em `details`/`hint` — registramos só código e mensagem.
 */
function errorForLog(err: unknown): unknown {
  if (err && typeof err === "object" && ("details" in err || "hint" in err)) {
    const e = err as { code?: unknown; message?: unknown };
    return { code: e.code, message: e.message };
  }
  return err;
}

/**
 * Converte um erro capturado em mensagem segura para o cliente.
 * - HttpError: mantém status e mensagem pública.
 * - status >= 500: registra o erro real no servidor e devolve mensagem genérica em pt-BR.
 * - status < 500: mantém a mensagem de negócio, a menos que contenha detalhes internos.
 */
export function toPublicError(
  err: unknown,
  opts: { context: string; status?: number; fallback?: string },
): { status: number; message: string } {
  if (err instanceof HttpError) return { status: err.status, message: err.publicMessage };
  const status = opts.status ?? 500;
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (status < 500 && !isInternalErrorMessage(msg)) return { status, message: msg };
  console.error(`[${opts.context}]`, errorForLog(err));
  const fallback = opts.fallback ?? (status === 503 ? UNAVAILABLE_PUBLIC_ERROR : GENERIC_PUBLIC_ERROR);
  return { status, message: fallback };
}

/** Resposta `{ status, body: { error } }` segura para um erro capturado em um usecase. */
export function errorResponse(
  err: unknown,
  context: string,
  status = 500,
): { status: number; body: { error: string } } {
  const pub = toPublicError(err, { context, status });
  return { status: pub.status, body: { error: pub.message } };
}

/**
 * Erro em rota de IA: timeout → 504 `{ error: "ai_timeout", message }` (o front mostra a dica específica);
 * falha de conexão com o provedor → 503; demais → `fallbackStatus` (padrão 500).
 */
export function aiErrorResponse(
  err: unknown,
  context: string,
  fallbackStatus = 500,
): { status: number; body: { error: string; message?: string } } {
  if (isAiTimeoutError(err)) {
    console.warn(`[${context}]`, err instanceof Error ? err.message : err);
    return { status: 504, body: { error: AI_TIMEOUT_ERROR_CODE, message: AI_TIMEOUT_PUBLIC_ERROR } };
  }
  return errorResponse(err, context, isOllamaConnectionError(err) ? 503 : fallbackStatus);
}

export function errorToHttp(err: unknown): { status: number; body: { error: string } } {
  if (!(err instanceof HttpError)) {
    if ((err as any)?.code === "LIMIT_FILE_SIZE") {
      return { status: 413, body: { error: "PDF acima de 48 MB." } };
    }
    if (err instanceof Error && err.message === "supabase_unreachable") {
      return { status: 503, body: { error: AUTH_UNAVAILABLE_PUBLIC_ERROR } };
    }
  }
  return errorResponse(err, "errorToHttp");
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


import type { NextFunction, Request, Response } from "express";

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
  return { status: 500, body: { error: msg } };
}

export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const { status, body } = errorToHttp(err);
  res.status(status).json(body);
}


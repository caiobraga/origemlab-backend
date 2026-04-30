import type { Request, Response } from "express";

function parseAllowList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsMiddleware(opts: { allowOrigin: string }) {
  const allow = parseAllowList(opts.allowOrigin || "*");
  const wildcard = allow.includes("*");

  return (req: Request, res: Response, next: () => void) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    const isAllowed = wildcard || (origin && allow.includes(origin));

    // For dev convenience, allow '*' to reflect any Origin.
    const allowOrigin = wildcard ? origin || "*" : isAllowed ? origin : "";

    if (allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowOrigin);
      res.setHeader("Vary", "Origin");
      // We don't rely on cookies; still safe to keep this true for OAuth/Stripe redirects in browser flows.
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Stripe-Signature",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");

    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  };
}


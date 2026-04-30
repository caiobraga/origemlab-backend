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
    // Important: with credentials, we must NOT return '*'.
    const allowOrigin = wildcard ? (origin || "") : isAllowed ? origin : "";

    if (allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowOrigin);
      res.setHeader("Vary", "Origin");
      // Cookie session requires credentials.
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


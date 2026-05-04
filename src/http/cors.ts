import type { Request, Response } from "express";

function parseAllowList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeOriginLike(s: string): string {
  return String(s || "").trim().replace(/\/$/, "");
}

function hostFromOrigin(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

function isOriginAllowed(origin: string, allow: string[], wildcard: boolean): boolean {
  if (wildcard) return true;
  const o = normalizeOriginLike(origin);
  if (!o) return false;

  const oHost = hostFromOrigin(o);

  for (const entryRaw of allow) {
    const entry = normalizeOriginLike(entryRaw);
    if (!entry) continue;

    // Exact match for full origins (recommended: "https://app.example.com").
    if (entry.includes("://")) {
      if (entry === o) return true;
      continue;
    }

    // Convenience: allow specifying just the host (e.g. "d2...cloudfront.net").
    // This avoids common misconfigurations (missing scheme) while still being explicit.
    if (oHost && entry === oHost) return true;
  }

  return false;
}

export function corsMiddleware(opts: { allowOrigin: string }) {
  const allow = parseAllowList(opts.allowOrigin || "*");
  const wildcard = allow.includes("*");

  return (req: Request, res: Response, next: () => void) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    const isAllowed = isOriginAllowed(origin, allow, wildcard);

    // For dev convenience, allow '*' to reflect any Origin.
    // Important: with credentials, we must NOT return '*'.
    const allowOrigin = wildcard ? (origin || "") : isAllowed ? normalizeOriginLike(origin) : "";

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


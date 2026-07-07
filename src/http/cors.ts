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

function mergeAllowOrigins(...lists: string[]): string[] {
  const out = new Set<string>();
  for (const raw of lists) {
    for (const entry of parseAllowList(raw)) {
      out.add(normalizeOriginLike(entry));
    }
  }
  return [...out];
}

/** Fronts de produção/dev — sempre permitidos mesmo se CORS_ALLOW_ORIGIN no S3 estiver desatualizado. */
const KNOWN_FRONT_ORIGINS = [
  "https://origemlabsolutions.com",
  "https://www.origemlabsolutions.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

export function buildCorsAllowList(opts: {
  allowOrigin: string;
  appBaseUrl?: string;
  frontOrigins?: string;
}): string[] {
  return mergeAllowOrigins(
    opts.allowOrigin || "*",
    opts.appBaseUrl || "",
    opts.frontOrigins || "",
    KNOWN_FRONT_ORIGINS.join(","),
  );
}

export function corsMiddleware(opts: {
  allowOrigin: string;
  appBaseUrl?: string;
  frontOrigins?: string;
}) {
  const allow = buildCorsAllowList(opts);
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


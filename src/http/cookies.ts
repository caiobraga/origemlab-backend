import cookie from "cookie";
import type { Request, Response } from "express";

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const parsed = cookie.parse(header);
  const v = parsed[name];
  return v ? String(v) : null;
}

export function setHttpOnlyCookie(res: Response, opts: {
  name: string;
  value: string;
  secure: boolean;
  maxAgeSeconds: number;
}) {
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(opts.name, opts.value, {
      httpOnly: true,
      // If secure (HTTPS), allow cross-site (CloudFront/AppRunner different domains).
      sameSite: opts.secure ? "none" : "lax",
      path: "/",
      secure: opts.secure,
      maxAge: opts.maxAgeSeconds,
    }),
  );
}

export function clearCookie(res: Response, opts: { name: string; secure: boolean }) {
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(opts.name, "", {
      httpOnly: true,
      sameSite: opts.secure ? "none" : "lax",
      path: "/",
      secure: opts.secure,
      expires: new Date(0),
    }),
  );
}


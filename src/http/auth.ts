import type { Request } from "express";
import type { User } from "@supabase/supabase-js";
import { HttpError } from "./errors.js";

export function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7).trim() || null;
}

export type SupabaseAuthPort = {
  getUserFromAccessToken(token: string): Promise<User | null>;
};

export async function requireUser(
  authPort: SupabaseAuthPort,
  req: Request,
): Promise<User> {
  const token = getBearerToken(req);
  if (!token) throw new HttpError(401, "Faça login.");
  const user = await authPort.getUserFromAccessToken(token);
  if (!user) throw new HttpError(401, "Sessão inválida.");
  return user;
}


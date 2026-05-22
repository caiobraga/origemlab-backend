import { Agent, fetch as undiciFetch } from "undici";

/** Undici default connect timeout is 10s — too short for Docker/VPN to Supabase (Cloudflare). */
const dispatcher = new Agent({
  connectTimeout: 25_000,
  headersTimeout: 60_000,
  bodyTimeout: 120_000,
});

export function supabaseFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return undiciFetch(input as string, {
    ...init,
    dispatcher,
  } as Parameters<typeof undiciFetch>[1]);
}

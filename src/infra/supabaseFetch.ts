import { Agent, fetch as undiciFetch } from "undici";

/** Undici default connect timeout is 10s — too short for Docker/VPN to Supabase (Cloudflare). */
const dispatcher = new Agent({
  connectTimeout: 25_000,
  headersTimeout: 60_000,
  bodyTimeout: 120_000,
});

function isCloudflareWorker(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.userAgent === "string" &&
    navigator.userAgent.includes("Cloudflare-Workers")
  );
}

/**
 * Node (local/ECS): Undici with longer timeouts.
 * Cloudflare Workers: native fetch — Undici Agent throws "fetch failed" on Workers.
 */
export function supabaseFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  if (isCloudflareWorker()) {
    return globalThis.fetch(input as RequestInfo, init);
  }
  return undiciFetch(input as string, {
    ...init,
    dispatcher,
  } as Parameters<typeof undiciFetch>[1]);
}

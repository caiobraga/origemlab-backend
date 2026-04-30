export type AppConfig = {
  port: number;
  /** Comma-separated origins or '*' */
  corsAllowOrigin: string;
  /** Base URL do app (front) para redirects do Stripe */
  appBaseUrl: string;
  ollama: {
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
  supabase: {
    url: string | null;
    serviceRoleKey: string | null;
  };
  stripe: {
    secretKey: string | null;
    webhookSecret: string | null;
  };
};

function readString(name: string): string | null {
  const v = process.env[name];
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
}

function readNumber(name: string, fallback: number): number {
  const raw = readString(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

export function loadConfig(): AppConfig {
  const port = readNumber("PORT", 8080);

  const corsAllowOrigin = readString("CORS_ALLOW_ORIGIN") ?? "*";

  // If empty, the HTTP layer may fall back to request Origin.
  const appBaseUrl = normalizeBaseUrl(readString("APP_BASE_URL") ?? "");

  const ollamaBaseUrl = normalizeBaseUrl(readString("OLLAMA_BASE_URL") ?? "http://3.81.132.92:11434");
  const ollamaModel = readString("OLLAMA_MODEL") ?? "qwen2.5:14b";
  const ollamaTimeoutMs = readNumber("OLLAMA_TIMEOUT_MS", 180000);

  const supabaseUrl = readString("SUPABASE_URL") ?? readString("VITE_SUPABASE_URL");
  const supabaseServiceRoleKey =
    readString("SUPABASE_SERVICE_ROLE_KEY") ?? readString("VITE_SUPABASE_SERVICE_ROLE_KEY");

  const stripeSecretKey =
    readString("AISELFIE_STRIPE_SECRET_KEY") ?? readString("STRIPE_SECRET_KEY");
  const stripeWebhookSecret =
    readString("AISELFIE_STRIPE_WEBHOOK_SECRET") ?? readString("STRIPE_WEBHOOK_SECRET");

  return {
    port,
    corsAllowOrigin,
    appBaseUrl,
    ollama: {
      baseUrl: ollamaBaseUrl,
      model: ollamaModel,
      timeoutMs: ollamaTimeoutMs,
    },
    supabase: {
      url: supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
    },
    stripe: {
      secretKey: stripeSecretKey,
      webhookSecret: stripeWebhookSecret,
    },
  };
}


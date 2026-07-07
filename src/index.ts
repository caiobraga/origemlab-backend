import { bootstrapEnv } from "./env.js";
import express from "express";
import { loadConfig } from "./config.js";
import { initOllamaFromConfig } from "./infra/ollamaResolve.js";
import { probeOllama } from "./infra/ollamaHealth.js";
import { corsMiddleware } from "./http/cors.js";
import { errorHandler } from "./http/errors.js";
import { buildRouter } from "./http/router.js";
import { installSwagger } from "./http/swagger.js";
import { buildGateways } from "./infra/gateways.js";
import { buildUseCases } from "./infra/usecases.js";

await bootstrapEnv();

let config = loadConfig();
try {
  config = await initOllamaFromConfig(config);
} catch (e) {
  console.error(`[origemlab-backend] ${e instanceof Error ? e.message : e}`);
}
const gateways = buildGateways(config);
const usecases = buildUseCases({ config, gateways });

const app = express();
// CloudFront / ALB / nginx definem X-Forwarded-* — necessário para cookies Secure e URLs corretas.
if (process.env.TRUST_PROXY !== "false") {
  app.set("trust proxy", true);
}
app.use(
  corsMiddleware({
    allowOrigin: config.corsAllowOrigin,
    appBaseUrl: config.appBaseUrl,
    frontOrigins: config.frontOrigins,
  }),
);

app.use(buildRouter({ config, ...usecases }));
installSwagger(app, config);
app.use(errorHandler);

const port = config.port;
void probeOllama(config).then((ollama) => {
  if (ollama.ok) {
    console.log(
      `[origemlab-backend] Ollama OK ${ollama.baseUrl} (${ollama.modelsInstalled ?? "?"} models, ${ollama.latencyMs}ms)`,
    );
  } else {
    console.error(`[origemlab-backend] Ollama indisponível: ${ollama.error}`);
  }
});
app.listen(port, "0.0.0.0", () => {
  console.log(`[origemlab-backend] listening on :${port} ollama=${config.ollama.baseUrl}`);
});

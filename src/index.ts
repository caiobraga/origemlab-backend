import { bootstrapEnv } from "./env.js";
import express from "express";
import { loadConfig } from "./config.js";
import { corsMiddleware } from "./http/cors.js";
import { errorHandler } from "./http/errors.js";
import { buildRouter } from "./http/router.js";
import { buildGateways } from "./infra/gateways.js";
import { buildUseCases } from "./infra/usecases.js";

await bootstrapEnv();

const config = loadConfig();
const gateways = buildGateways(config);
const usecases = buildUseCases({ config, gateways });

const app = express();
// CloudFront / ALB / nginx definem X-Forwarded-* — necessário para cookies Secure e URLs corretas.
if (process.env.TRUST_PROXY !== "false") {
  app.set("trust proxy", true);
}
app.use(corsMiddleware({ allowOrigin: config.corsAllowOrigin }));

app.use(buildRouter({ config, ...usecases }));
app.use(errorHandler);

const port = config.port;
app.listen(port, "0.0.0.0", () => {
  console.log(`[origemlab-backend] listening on :${port}`);
});
